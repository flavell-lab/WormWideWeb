const APPROX_DATASET_SIZE_MB = 10;
export const MAX_SELECTED_ZIP_DOWNLOADS = 10;
const JSZIP_ESM_URL = "https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm";

let jsZipCtorPromise = null;

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
    return `${paperId}_${datasetIdPart}.json`;
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

function setButtonBusy(buttonElement, isBusy, statusText = "Preparing ZIP...") {
    if (!buttonElement) return;
    if (isBusy) {
        if (buttonElement.dataset.originalHtml === undefined) {
            buttonElement.dataset.originalHtml = buttonElement.innerHTML;
        }
        buttonElement.disabled = true;
        buttonElement.innerHTML = `<span class="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span>${statusText}`;
        return;
    }

    buttonElement.disabled = false;
    if (buttonElement.dataset.originalHtml !== undefined) {
        buttonElement.innerHTML = buttonElement.dataset.originalHtml;
        delete buttonElement.dataset.originalHtml;
    }
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

    setButtonBusy(buttonElement, true, `Preparing ZIP (0/${selected.length})...`);

    try {
        const JSZip = await getJSZipConstructor();
        const zip = new JSZip();
        const usedFileNames = new Set();
        const failedDatasetIds = [];
        let successCount = 0;

        for (let idx = 0; idx < selected.length; idx += 1) {
            const option = selected[idx];
            const datasetId = String(option?.id ?? option?.dataset_id ?? "").trim();
            if (!datasetId) {
                failedDatasetIds.push("unknown");
                continue;
            }

            setButtonBusy(buttonElement, true, `Preparing ZIP (${idx + 1}/${selected.length})...`);

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
        }

        if (successCount === 0) {
            alert("Failed to download selected datasets.");
            return;
        }

        setButtonBusy(buttonElement, true, "Generating ZIP...");
        const blob = await zip.generateAsync({
            type: "blob",
            compression: "DEFLATE",
            compressionOptions: { level: 5 },
        });
        downloadBlob(blob, buildZipFileName(zipPrefix));

        if (failedDatasetIds.length > 0) {
            const preview = failedDatasetIds.slice(0, 5).join(", ");
            const suffix = failedDatasetIds.length > 5 ? ", ..." : "";
            alert(`Downloaded ${successCount} dataset(s). Failed: ${preview}${suffix}`);
        }
    } catch (error) {
        console.error("Failed to create ZIP download:", error);
        alert("Could not create a ZIP download. Please try again.");
    } finally {
        setButtonBusy(buttonElement, false);
    }
}
