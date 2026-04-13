import { DatasetTable } from '../find_dataset_table.js';
import { PaperDatasetSelector } from '../find_dataset_selector.js';
import { getDatasetTypePill } from '/static/core/js/utility.js';

const PAPER_SELECTOR_PARAM = "p";
const PAPER_SELECTOR_SEPARATOR = ",";

function normalizeSelectorValues(rawValue) {
    if (Array.isArray(rawValue)) return rawValue.map(String);
    if (rawValue === null || rawValue === undefined) return [];
    if (typeof rawValue === "string") {
        return rawValue
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean);
    }
    return [String(rawValue)];
}

function encodePaperSelection(values, allPaperIds) {
    const normalized = normalizeSelectorValues(values);
    const allowed = new Set(allPaperIds);
    const selected = normalized.filter((value) => allowed.has(value));

    const uniqueSorted = [...new Set(selected)].sort((left, right) =>
        left.localeCompare(right)
    );
    return uniqueSorted.join(PAPER_SELECTOR_SEPARATOR);
}

function decodePaperSelection(paramValue, allPaperIds) {
    if (!paramValue) return [];
    const allowed = new Set(allPaperIds);

    const decoded = String(paramValue)
        .split(PAPER_SELECTOR_SEPARATOR)
        .map((token) => token.trim())
        .filter(Boolean)
        .filter((paperId) => allowed.has(paperId));

    return [...new Set(decoded)];
}

function hasSameMembers(leftValues, rightValues) {
    if (leftValues.length !== rightValues.length) return false;
    const rightSet = new Set(rightValues);
    return leftValues.every((value) => rightSet.has(value));
}

function syncPaperSelectionToUrl(values, allPaperIds) {
    const params = new URLSearchParams(window.location.search);
    const encoded = encodePaperSelection(values, allPaperIds);
    const selected = encoded ? encoded.split(PAPER_SELECTOR_SEPARATOR) : [];

    // Keep URL compact: omit param when all papers are selected.
    if (selected.length === 0 || hasSameMembers(selected, allPaperIds)) {
        params.delete(PAPER_SELECTOR_PARAM);
    } else {
        params.set(PAPER_SELECTOR_PARAM, encoded);
    }

    const query = params.toString();
    const nextUrl = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash || ""}`;
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash || ""}`;
    if (nextUrl !== currentUrl) {
        window.history.replaceState({}, "", nextUrl);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    /*
        Selectors
    */
    const datasetTable = new DatasetTable("datasetTable", data, datasetTypes)
    const selectors = new PaperDatasetSelector("datasetSelector", "paperSelector", datasetTable, datasetTypes, papers)
    const allPaperIds = Object.keys(papers).sort((left, right) => left.localeCompare(right));

    // Init paper selector from URL. Fallback: select all papers.
    const urlParams = new URLSearchParams(window.location.search);
    const selectedPaperIds = decodePaperSelection(
        urlParams.get(PAPER_SELECTOR_PARAM),
        allPaperIds
    );
    if (selectedPaperIds.length > 0) {
        selectors.selectorPaper.setValue(selectedPaperIds);
    } else {
        selectors.selectorPaper.setValue(allPaperIds);
    }

    // normalize/sync URL to current paper selection.
    syncPaperSelectionToUrl(selectors.selectorPaper.getValue(), allPaperIds);

    // keep URL in sync with paper selector state
    selectors.selectorPaper.on("change", () => {
        syncPaperSelectionToUrl(selectors.selectorPaper.getValue(), allPaperIds);
    });

    /*
        Buttons
    */
    const buttonClear = document.getElementById("clearSelector")
    buttonClear.addEventListener('click', () => {
        selectors.selectorDataset.clear();
    });
    const buttonDownloadSelected = document.getElementById("downloadSelected")
    buttonDownloadSelected.addEventListener('click', async () => {
        await datasetTable.downloadSelected(buttonDownloadSelected);
    });

    /*
        Dataset type info
    */
    const typeLegend = document.getElementById("datasetTypeLegend")
    let typeLegendHTML = ""
    
    // common
    const htmlCommonBadges = paperDatasetTypes.common.map(typeId =>
        `<div class="col-12">
            <div class="row justify-content-start">
                <div class="col-md-1">${getDatasetTypePill(typeId, datasetTypes)}</div>
                <div class="col-md-6">${datasetTypes[typeId].description}</div>
            </div>
        </div>`).join("");
    typeLegendHTML += `<h6 class="mb-0">Common</h6><div class="row gy-1 mb-3">${htmlCommonBadges}</div>`
        
    // papers
    Object.keys(paperDatasetTypes.papers).forEach(paperId => {
        let paperBadges = paperDatasetTypes.papers[paperId].map(typeId =>
            `<div class="col-12">
            <div class="row justify-content-start">
                <div class="col-md-1">${getDatasetTypePill(typeId, datasetTypes)}</div>
                <div class="col-md-6">${datasetTypes[typeId].description}</div>
            </div>
        </div>`).join("");

        typeLegendHTML += `<h6 class="mb-0">${papers[paperId].title_short}</h6><div class="row gy-1 mb-3">${paperBadges}</div>`
    });
    typeLegend.innerHTML = typeLegendHTML
    
    // tooltips
    const tooltipTriggerList = document.querySelectorAll('[data-bs-toggle="tooltip"]')
    const tooltipList = [...tooltipTriggerList].map(tooltipTriggerEl => new bootstrap.Tooltip(tooltipTriggerEl))
})
