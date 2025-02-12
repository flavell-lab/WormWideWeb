import { DatasetTable } from '../find_dataset_table.js';
import { PaperDatasetSelector } from '../find_dataset_selector.js';
import { getDatasetTypePill } from '/static/core/js/utility.js';

document.addEventListener('DOMContentLoaded', () => {
    /*
        Selectors
    */
    const datasetTable = new DatasetTable("datasetTable", data, datasetTypes)
    const selectors = new PaperDatasetSelector("datasetSelector", "paperSelector", datasetTable, datasetTypes, papers)

    // select all papers
    const allPapers = selectors.selectorPaper.options
    const paperTargetValue = Object.keys(allPapers).map(function (key) {
        return allPapers[key].value;
    });
    selectors.selectorPaper.setValue(paperTargetValue); // select all papers

    /*
        Buttons
    */
    const buttonClear = document.getElementById("clearSelector")
    buttonClear.addEventListener('click', () => {
        selectors.selectorDataset.clear();
    });
    const buttonDownloadSelected = document.getElementById("downloadSelected")
    buttonDownloadSelected.addEventListener('click', () => {
        datasetTable.downloadSelected();
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
        </div>`).join();
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