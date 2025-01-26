import { DatasetTable } from '../find_dataset_table.js';
import { PaperDatasetSelector } from '../find_dataset_selector.js';

document.addEventListener('DOMContentLoaded', () => {    
    /*
        Selectors
    */
    const datasetTable = new DatasetTable("datasetTable", data, datasetTypes)
    const selectors = new PaperDatasetSelector("datasetSelector", "paperSelector", datasetTable, datasetTypes, papers)
    
    // select all papers
    const allPapers = selectors.selectorPaper.options
    const paperTargetValue = Object.keys(allPapers).map(function(key) {
        return allPapers[key].value;
    });
    selectors.selectorPaper.setValue(paperTargetValue); // select all papers

    /*
        Buttons
    */
    const buttonClear = document.getElementById("clearSelector")
    buttonClear.addEventListener('click', () => {
        selectors.clearSelector();
    });
    const buttonDownloadSelected = document.getElementById("downloadSelected")
    buttonDownloadSelected.addEventListener('click', () => {
        datasetTable.downloadSelected();
    });
    
    // tooltips
    const tooltipTriggerList = document.querySelectorAll('[data-bs-toggle="tooltip"]')
    const tooltipList = [...tooltipTriggerList].map(tooltipTriggerEl => new bootstrap.Tooltip(tooltipTriggerEl))
})