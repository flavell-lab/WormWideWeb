const APPROX_DATASET_SIZE_MB = 10;
export const MAX_SELECTED_ZIP_DOWNLOADS = 20;
const JSZIP_ESM_URL = "https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm";

let jsZipCtorPromise = null;
let downloadHUD = null;
let downloadHUDHideTimer = null;

function getDatasetDownloadURL(datasetId) {
    return `/activity/api/data/download/${encodeURIComponent(datasetId)}/`;
}

function sanitizeFileNamePart(value) {
    return String(value ?? "")
        .trim()
        .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
        .replace(/\s+/g, "_");
}

function getUniqueFileName(baseName, usedNames) {
    if (!usedNames.has(baseName)) {
        usedNames.add(baseName);
        return baseName;
    }

    const dotIdx = baseName.lastIndexOf(".");
    const stem = dotIdx > 0 ? baseName.slice(0, dotIdx) : baseName;
    const ext = dotIdx > 0 ? baseName.slice(dotIdx) : "";
    let suffix = 2;
    let candidate = `${stem}_${suffix}${ext}`;
    while (usedNames.has(candidate)) {
        suffix += 1;
        candidate = `${stem}_${suffix}${ext}`;
    }
    usedNames.add(candidate);
    return candidate;
}

function buildDatasetFileName(option, datasetId) {
    const paperId = sanitizeFileNamePart(option?.paper_id) || "paper";
    const datasetIdPart = sanitizeFileNamePart(datasetId) || "dataset";
    return `${paperId}_${datasetIdPart}.json.bz2`;
}

function buildZipFileName(zipPrefix) {
    const safePrefix = sanitizeFileNamePart(zipPrefix) || "wormwideweb-datasets";
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    return `${safePrefix}-${timestamp}.zip`;
}

function downloadBlob(blob, fileName) {
    const link = document.createElement("a");
    const objectUrl = URL.createObjectURL(blob);
    link.href = objectUrl;
    link.download = fileName;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

function setButtonBusy(buttonElement, isBusy) {
    if (!buttonElement) return;
    buttonElement.disabled = Boolean(isBusy);
}

function clearDownloadHUDHideTimer() {
    if (!downloadHUDHideTimer) return;
    clearTimeout(downloadHUDHideTimer);
    downloadHUDHideTimer = null;
}

function getDownloadHUD() {
    if (downloadHUD && document.body.contains(downloadHUD)) return downloadHUD;

    downloadHUD = document.createElement("div");
    downloadHUD.className = "dataset-download-hud dataset-download-hud--hidden";
    downloadHUD.setAttribute("role", "status");
    downloadHUD.setAttribute("aria-live", "polite");
    downloadHUD.innerHTML = `
        <div class="dataset-download-hud__title">Preparing download</div>
        <div class="dataset-download-hud__message">Please wait...</div>
        <div class="dataset-download-hud__progress">
            <div class="dataset-download-hud__progress-fill"></div>
        </div>
    `;

    document.body.appendChild(downloadHUD);
    return downloadHUD;
}

function showDownloadHUD({
    title = "Preparing download",
    message = "Please wait...",
    progress = null,
    state = "working",
} = {}) {
    const hud = getDownloadHUD();
    clearDownloadHUDHideTimer();

    hud.classList.remove(
        "dataset-download-hud--hidden",
        "dataset-download-hud--working",
        "dataset-download-hud--success",
        "dataset-download-hud--warning",
        "dataset-download-hud--error"
    );
    hud.classList.add(`dataset-download-hud--${state}`);

    const titleEl = hud.querySelector(".dataset-download-hud__title");
    const messageEl = hud.querySelector(".dataset-download-hud__message");
    const progressFillEl = hud.querySelector(".dataset-download-hud__progress-fill");

    if (titleEl) titleEl.textContent = title;
    if (messageEl) messageEl.textContent = message;

    if (progressFillEl) {
        if (typeof progress === "number" && Number.isFinite(progress)) {
            const clamped = Math.max(0, Math.min(1, progress));
            progressFillEl.classList.remove(
                "dataset-download-hud__progress-fill--indeterminate"
            );
            progressFillEl.style.marginLeft = "0";
            progressFillEl.style.width = `${Math.round(clamped * 100)}%`;
        } else {
            progressFillEl.classList.add(
                "dataset-download-hud__progress-fill--indeterminate"
            );
            progressFillEl.style.marginLeft = "-35%";
            progressFillEl.style.width = "35%";
        }
    }
}

function hideDownloadHUD(delayMs = 0) {
    clearDownloadHUDHideTimer();
    if (!downloadHUD) return;

    const hideNow = () => {
        if (!downloadHUD) return;
        downloadHUD.classList.add("dataset-download-hud--hidden");
    };

    if (delayMs > 0) {
        downloadHUDHideTimer = setTimeout(hideNow, delayMs);
        return;
    }

    hideNow();
}

async function getJSZipConstructor() {
    if (window.JSZip) return window.JSZip;
    if (!jsZipCtorPromise) {
        jsZipCtorPromise = import(JSZIP_ESM_URL).then((module) => module.default || module.JSZip || module);
    }
    return jsZipCtorPromise;
}

async function fetchDatasetArrayBuffer(datasetId) {
    const response = await fetch(getDatasetDownloadURL(datasetId), {
        method: "GET",
        credentials: "same-origin",
    });
    if (!response.ok) {
        throw new Error(`HTTP error ${response.status}`);
    }
    return response.arrayBuffer();
}

export async function downloadSelectedDatasetsAsZip(
    selected,
    {
        buttonElement = null,
        zipPrefix = "wormwideweb-datasets",
    } = {}
) {
    if (!Array.isArray(selected) || selected.length === 0) {
        alert("Please select at least one dataset to download.");
        return;
    }

    if (selected.length > MAX_SELECTED_ZIP_DOWNLOADS) {
        alert(
            `You can download up to ${MAX_SELECTED_ZIP_DOWNLOADS} datasets at once (about ${MAX_SELECTED_ZIP_DOWNLOADS * APPROX_DATASET_SIZE_MB} MB before ZIP compression).`
        );
        return;
    }

    const total = selected.length;
    setButtonBusy(buttonElement, true);
    showDownloadHUD({
        title: "Preparing ZIP",
        message: `Fetching datasets (0/${total})`,
        progress: 0,
        state: "working",
    });

    try {
        const JSZip = await getJSZipConstructor();
        const zip = new JSZip();
        const usedFileNames = new Set();
        const failedDatasetIds = [];
        let successCount = 0;

        for (let idx = 0; idx < total; idx += 1) {
            const option = selected[idx];
            const datasetId = String(option?.id ?? option?.dataset_id ?? "").trim();
            if (!datasetId) {
                failedDatasetIds.push("unknown");
                showDownloadHUD({
                    title: "Preparing ZIP",
                    message: `Fetching datasets (${idx + 1}/${total})`,
                    progress: (idx + 1) / total,
                    state: "working",
                });
                continue;
            }

            try {
                const content = await fetchDatasetArrayBuffer(datasetId);
                const baseName = buildDatasetFileName(option, datasetId);
                const fileName = getUniqueFileName(baseName, usedFileNames);
                zip.file(fileName, content);
                successCount += 1;
            } catch (error) {
                console.error(`Failed to fetch dataset '${datasetId}':`, error);
                failedDatasetIds.push(datasetId);
            }

            showDownloadHUD({
                title: "Preparing ZIP",
                message: `Fetching datasets (${idx + 1}/${total})`,
                progress: (idx + 1) / total,
                state: "working",
            });
        }

        if (successCount === 0) {
            showDownloadHUD({
                title: "Download failed",
                message: "Could not fetch any selected datasets.",
                progress: 1,
                state: "error",
            });
            hideDownloadHUD(4000);
            return;
        }

        showDownloadHUD({
            title: "Generating ZIP",
            message: `Compressing ${successCount} dataset(s)...`,
            progress: null,
            state: "working",
        });
        const blob = await zip.generateAsync({
            type: "blob",
            compression: "DEFLATE",
            compressionOptions: { level: 5 },
        });
        downloadBlob(blob, buildZipFileName(zipPrefix));

        if (failedDatasetIds.length > 0) {
            showDownloadHUD({
                title: "Downloaded with issues",
                message: `Downloaded ${successCount}/${total} dataset(s). ${failedDatasetIds.length} failed.`,
                progress: 1,
                state: "warning",
            });
            hideDownloadHUD(5000);
            return;
        }

        showDownloadHUD({
            title: "Download complete",
            message: `Downloaded ${successCount} dataset(s).`,
            progress: 1,
            state: "success",
        });
        hideDownloadHUD(2000);
    } catch (error) {
        console.error("Failed to create ZIP download:", error);
        showDownloadHUD({
            title: "Download failed",
            message: "Could not create ZIP file. Please try again.",
            progress: 1,
            state: "error",
        });
        hideDownloadHUD(5000);
    } finally {
        setButtonBusy(buttonElement, false);
    }
}
