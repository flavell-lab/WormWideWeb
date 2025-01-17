import Shepherd from 'https://cdn.jsdelivr.net/npm/shepherd.js@13.0.0/dist/esm/shepherd.mjs';
import { DatasetNeuronSelector } from '../find_neuron_selector.js';
import { DatasetTable } from '../find_neuron_table.js';
import { setLocalBool, getLocalBool } from "/static/core/js/utility.js"

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

    // tooltips
    const tooltipTriggerList = document.querySelectorAll('[data-bs-toggle="tooltip"]')
    const tooltipList = [...tooltipTriggerList].map(tooltipTriggerEl => new bootstrap.Tooltip(tooltipTriggerEl))

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