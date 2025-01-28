import Shepherd from 'https://cdn.jsdelivr.net/npm/shepherd.js@13.0.0/dist/esm/shepherd.mjs';
import { DatasetNeuronSelector } from '../find_neuron_selector.js';
import { DatasetTable } from '../find_neuron_table.js';
import { setLocalBool, getLocalBool, getDatasetTypePill } from "/static/core/js/utility.js"

async function initData(data) {
    const url = "/activity/api/data/find_neuron/";
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Error loading find_neuron data. Response status: ${response.status}`);
        }
    
        return await response.json();
    } catch (error) {
        console.error(error.message);
    }
}

document.addEventListener('DOMContentLoaded', async() => {
    const data = await initData();

    /*
        Selectors
    */
    const neuronTable = new DatasetTable("datasetTable", data)
    const neuronSelector = new DatasetNeuronSelector("select-neuron", "select-paper", neuronTable)

    // select all papers
    const allPapers = neuronSelector.selectorPaper.options
    const paperTargetValue = Object.keys(allPapers).map(function(key) {
        return allPapers[key].value;
    });
    neuronSelector.selectorPaper.setValue(paperTargetValue); // select all papers

    /*
        Init from URL
    */
    const currentUrl = new URL(window.location.href);
    const urlParams = new URLSearchParams(currentUrl.search);
    const manifestNeuronClassInit = [];
    const neuronClassUrl = urlParams.get("n");
    if (neuronClassUrl != null) {
        const neurons = neuronClassUrl.split("-");

        neurons.forEach(neuron => {
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
        Tooltips
    */
    const tooltipTriggerList = document.querySelectorAll('[data-bs-toggle="tooltip"]')
    const tooltipList = [...tooltipTriggerList].map(tooltipTriggerEl => new bootstrap.Tooltip(tooltipTriggerEl))

    /*
        Dataset type info
    */
    const typeLegend = document.getElementById("datasetTypeLegend")
    const badgesHTML = Object.keys(data.neuropal_dataset_type).map(typeId=>
        `<div class="col-12">
            <div class="row justify-content-start">
                <div class="col-sm-3">${getDatasetTypePill(typeId, data.neuropal_dataset_type)}</div>
                <div class="col-sm-8">${data.neuropal_dataset_type[typeId].description}</div>
            </div>
        </div>`
    ).join("")
    typeLegend.innerHTML = `<div class="row gy-1 mb-3">${badgesHTML}</div>`

    /*
        Tour
    */
    if (getLocalBool("tour-activity-find", true)) {
        const tour = new Shepherd.Tour({
            useModalOverlay: true,
            defaultStepOptions: {
                classes: 'shadow-md bg-white',
                scrollTo: false
            }
        });

        tour.addStep({
            id: 'step-1-search',
            text: 'Select one or more neurons or neuron classes',
            attachTo: {
                element: '.tom-select-container',
                on: 'right'
            },
            // classes: 'example-step-extra-class',
            buttons: [
                { text: 'Next', action: tour.next }
            ],
        });

        tour.addStep({
            id: 'step-2-sort-table',
            text: 'Sort by selecting a column header',
            attachTo: { element: 'th[data-field="id"]', on: 'top' },
            beforeShowPromise: () => {
                neuronSelector.selector.addItems(["AVAL", "AVEL"])
                return Promise.resolve();
            },
            buttons: [
                { text: 'Back', action: tour.back },
                { text: 'Next', action: tour.next }
            ]
        });

        tour.addStep({
            id: 'step-3-table-action',
            text: 'Plot the found neurons in this dataset or download the whole dataset.',
            attachTo: { element: '.actions-column', on: 'left' },
            buttons: [
                { text: 'Back', action: tour.back },
                { text: 'Next', action: tour.next }
            ]
        });

        tour.addStep({
            id: 'step-4-multiple-plot-button',
            text: 'Select multiple datasets and plot the selected datasets to conveniently browse through multiple datasets at once.',
            attachTo: { element: '#plotSelected', on: 'left' },
            buttons: [
                { text: 'Back', action: tour.back },
                { text: 'Complete', action: tour.complete }
            ]
        });

        tour.on('complete', () => {
            neuronSelector.clearSelector()

            setLocalBool("tour-activity-find", false)
        });

        tour.start();
    }
})