import { DatasetNeuronSelector } from '../find_neuron_selector.js';
import { DatasetTable } from '../find_neuron_table.js';
import { setLocalBool, getLocalBool, getDatasetTypePill } from "/static/core/js/utility.js"

async function initData() {
    const url = "/activity/api/data/find_neuron/";
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Error loading find_neuron data. Response status: ${response.status}`);
        }
    
        return await response.json();
    } catch (error) {
        console.error(error.message);
        return null;
    }
}

function showLoadError() {
    const container = document.querySelector(".container-lg");
    if (container) {
        const alertElement = document.createElement("div");
        alertElement.className = "alert alert-warning";
        alertElement.setAttribute("role", "alert");
        alertElement.textContent = "Could not load neuron match data. Please refresh and try again.";
        container.prepend(alertElement);
    }

    [
        "select-paper",
        "select-neuron",
        "customSearch",
        "clearSelector",
        "plotSelected",
        "downloadSelected",
    ].forEach((elementId) => {
        const element = document.getElementById(elementId);
        if (element) {
            element.disabled = true;
        }
    });
}

document.addEventListener('DOMContentLoaded', async() => {
    const data = await initData();
    if (!data) {
        showLoadError();
        return;
    }

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
        neuronSelector.selector.clear();
    });

    const buttonPlotSelected = document.getElementById("plotSelected")
    buttonPlotSelected.addEventListener('click', () => {
        neuronTable.plotSelected();
    });

    const buttonDownloadSelected = document.getElementById("downloadSelected")
    buttonDownloadSelected.addEventListener('click', async () => {
        await neuronTable.downloadSelected(buttonDownloadSelected);
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
    const datasetTypes = data.neuropal_dataset_type || {}
    const papers = Array.isArray(data.papers) ? data.papers : []
    const paperTitleById = {}
    papers.forEach((paper) => {
        if (!paper?.paper_id) return
        paperTitleById[paper.paper_id] = paper.title || paper.paper_id
    })

    const commonTypeIds = []
    const paperTypeIds = {}
    Object.keys(datasetTypes).forEach((typeId) => {
        const typeMeta = datasetTypes[typeId] || {}
        const explicitPaper = typeMeta.paper || typeMeta.paper_id
        const inferredPaper = typeId.includes("-") ? typeId.split("-")[0] : "common"
        const paperId = explicitPaper || inferredPaper

        if (paperId === "common") {
            commonTypeIds.push(typeId)
            return
        }

        if (!paperTypeIds[paperId]) {
            paperTypeIds[paperId] = []
        }
        paperTypeIds[paperId].push(typeId)
    })

    let typeLegendHTML = ""
    if (commonTypeIds.length > 0) {
        const htmlCommonBadges = commonTypeIds.map((typeId) =>
            `<div class="col-12">
                <div class="row justify-content-start">
                    <div class="col-md-1">${getDatasetTypePill(typeId, datasetTypes)}</div>
                    <div class="col-md-6">${datasetTypes[typeId].description}</div>
                </div>
            </div>`
        ).join("")
        typeLegendHTML += `<h6 class="mb-0">Common</h6><div class="row gy-1 mb-3">${htmlCommonBadges}</div>`
    }

    Object.keys(paperTypeIds).sort().forEach((paperId) => {
        const htmlPaperBadges = paperTypeIds[paperId].map((typeId) =>
            `<div class="col-12">
                <div class="row justify-content-start">
                    <div class="col-md-1">${getDatasetTypePill(typeId, datasetTypes)}</div>
                    <div class="col-md-6">${datasetTypes[typeId].description}</div>
                </div>
            </div>`
        ).join("")
        const paperTitle = paperTitleById[paperId] || paperId
        typeLegendHTML += `<h6 class="mb-0">${paperTitle}</h6><div class="row gy-1 mb-3">${htmlPaperBadges}</div>`
    })

    typeLegend.innerHTML = typeLegendHTML || '<p class="text-muted mb-0">No dataset type info available.</p>'

    /*
        Tour
    */
    if (getLocalBool("tour-activity-find", true)) {
        const tour = new Shepherd.Tour({
            useModalOverlay: true,
            defaultStepOptions: {
                classes: 'shadow-md bg-white',
                scrollTo: false,
                cancelIcon: {
                    enabled: true
                }    
            },
        });
        tour.addStep({
            id: "init",
            text: '<strong>Tutorial</strong><br>Click the "X" button on the top right of this modal to skip',
            buttons: [
                { text: 'Next', action: tour.next }
            ],
        })

        tour.addStep({
            id: 'step-1-search',
            text: 'Select one or more neurons or neuron classes',
            attachTo: {
                element: '#ts-select-neuron',
                on: 'right'
            },
            buttons: [
                { text: 'Next', action: tour.next }
            ],
        });

        tour.addStep({
            id: 'step-2-sort-table',
            text: 'Sort by selecting a column header',
            attachTo: { element: 'th[data-field="label"]', on: 'top' },
            beforeShowPromise: () => {
                neuronSelector.selector.addItems(["AVAL", "AVEL"])
                return Promise.resolve();
            },
            buttons: [
                { text: 'Next', action: tour.next }
            ]
        });

        tour.addStep({
            id: 'step-3-table-action',
            text: 'Plot the found neurons in this dataset or download the whole dataset.',
            attachTo: { element: '.actions-column', on: 'left' },
            buttons: [
                { text: 'Next', action: tour.next }
            ]
        });

        tour.addStep({
            id: 'step-4-multiple-plot-button',
            text: 'Select multiple datasets and plot the selected datasets to conveniently browse through multiple datasets at once.',
            attachTo: { element: '#plotSelected', on: 'left' },
            buttons: [
                { text: 'Complete', action: tour.complete }
            ]
        });

        tour.on('complete', () => {
            neuronSelector.selector.clear()

            setLocalBool("tour-activity-find", false)
        });

        tour.on('cancel', () => {
            neuronSelector.clearSelector()

            setLocalBool("tour-activity-find", false)
        });

        tour.start();
    }
})
