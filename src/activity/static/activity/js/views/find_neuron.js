import { DatasetNeuronSelector } from '../find_neuron_selector.js';
import { DatasetTable } from '../find_neuron_table.js';

document.addEventListener('DOMContentLoaded', () => {    
    /*
        Selectors
    */
    const neuronTable = new DatasetTable("datasetTable", data)
    const neuronSelector = new DatasetNeuronSelector("select-neuron", neuronTable)
    
    /*
        Init from URL
    */
    const currentUrl = new URL(window.location.href);
    const urlParams = new URLSearchParams(currentUrl.search);
    const manifestNeuronClassInit = [];
    const neuronClassUrl = urlParams.get("n");
    if (neuronClassUrl != null) {
        const neurons = neuronClassUrl.split("-");
        
        neurons.forEach(neuron=> {
            if (neuron in neuronSelector.selector.options) {
                manifestNeuronClassInit.push(neuron)
            } else if (neuron in data.class) {
                if (data.class[neuron].length > 1) {
                    manifestNeuronClassInit.push(`${neuron}*`)
                } else {
                    // class with single neuron instance
                    const option = neuronSelector.generateNeuronOptions(neuron, data.class[neuron])
                    manifestNeuronClassInit.push(option[0].value)
                }
            }
        })

        neuronSelector.selector.addItems(manifestNeuronClassInit)
    }

    /*
        Buttons
    */
    const buttonClear = document.getElementById("clearSelector")
    buttonClear.addEventListener('click', () => {
        neuronSelector.clearSelector();
    });

    const buttonPlotSelected = document.getElementById("plotSelected")
    buttonPlotSelected.addEventListener('click', () => {
        neuronTable.plotSelected();
    });

    const buttonDownloadSelected = document.getElementById("downloadSelected")
    buttonDownloadSelected.addEventListener('click', () => {
        neuronTable.downloadSelected();
    });

    /*
        Toasts
    */
    const toastHelpElement = document.getElementById("toastHelp")
    const toastHelp = new bootstrap.Toast(toastHelpElement)
    const toastShown = localStorage.getItem("activity_find_neuron_toastHelp");
    if (!toastShown) {
        toastHelp.show()
        localStorage.setItem("activity_find_neuron_toastHelp", 'true'); // Set the flag
    }


    // tooltips
    const tooltipTriggerList = document.querySelectorAll('[data-bs-toggle="tooltip"]')
    const tooltipList = [...tooltipTriggerList].map(tooltipTriggerEl => new bootstrap.Tooltip(tooltipTriggerEl))
})