function getPaperArchiveDownloadURL(paperId) {
    return `/activity/api/data/download/paper/${encodeURIComponent(paperId)}/`;
}

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function toPaperEntries(papersInput) {
    const entries = [];
    if (Array.isArray(papersInput)) {
        papersInput.forEach((paper) => {
            const paperId = String(paper?.paper_id ?? "").trim();
            if (!paperId) return;
            const titleShort = String(
                paper?.title_short ?? paper?.title ?? paperId
            ).trim();
            entries.push({ paperId, titleShort: titleShort || paperId });
        });
    } else if (papersInput && typeof papersInput === "object") {
        Object.keys(papersInput).forEach((paperIdRaw) => {
            const paperId = String(paperIdRaw ?? "").trim();
            if (!paperId) return;
            const paper = papersInput[paperId] || {};
            const titleShort = String(
                paper?.title_short ?? paper?.title ?? paperId
            ).trim();
            entries.push({ paperId, titleShort: titleShort || paperId });
        });
    }

    const seen = new Set();
    const deduped = [];
    entries.forEach((entry) => {
        if (seen.has(entry.paperId)) return;
        seen.add(entry.paperId);
        deduped.push(entry);
    });

    deduped.sort((left, right) =>
        left.titleShort.localeCompare(right.titleShort, undefined, {
            sensitivity: "base",
        })
    );
    return deduped;
}

export function renderPaperArchiveDownloadButtons(containerId, papersInput) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const paperEntries = toPaperEntries(papersInput);
    if (!paperEntries.length) {
        container.innerHTML =
            '<p class="text-muted mb-0">No paper archive downloads available.</p>';
        return;
    }

    const itemsHtml = paperEntries
        .map(
            ({ paperId, titleShort }) =>
                `<div class="d-flex flex-column flex-sm-row align-items-sm-center justify-content-between gap-2 py-1">
                    <span>${escapeHtml(titleShort)}</span>
                    <a href="${getPaperArchiveDownloadURL(paperId)}" class="btn btn-sm btn-primary align-self-start align-self-sm-auto" title="Download ${escapeHtml(paperId)}.tar.bz2">
                        <i class="bi bi-download"></i> Download
                    </a>
                </div>`
        )
        .join("");

    container.innerHTML = `<div class="d-grid gap-1">${itemsHtml}</div>`;
}
