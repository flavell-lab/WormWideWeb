import { DatasetTable } from '../find_dataset_table.js';
import { DatasetSelector } from '../find_dataset_selector.js';

document.addEventListener('DOMContentLoaded', () => {    
    /*
        Selectors
    */
    const datasetTable = new DatasetTable("datasetTable", data)
    const datasetSelector = new DatasetSelector("datasetSelector", datasetTable, datasetTypes)

    /*
        Buttons
    */
    const buttonClear = document.getElementById("clearSelector")
    buttonClear.addEventListener('click', () => {
        datasetSelector.clearSelector();
    });
    const buttonDownloadSelected = document.getElementById("downloadSelected")
    buttonDownloadSelected.addEventListener('click', () => {
        datasetTable.downloadSelected();
    });
    
    // tooltips
    const tooltipTriggerList = document.querySelectorAll('[data-bs-toggle="tooltip"]')
    const tooltipList = [...tooltipTriggerList].map(tooltipTriggerEl => new bootstrap.Tooltip(tooltipTriggerEl))
})