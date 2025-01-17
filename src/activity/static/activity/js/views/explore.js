import Shepherd from 'https://cdn.jsdelivr.net/npm/shepherd.js@13.0.0/dist/esm/shepherd.mjs';
import { NeuronSelector } from "../plot_neuron_selector.js"
import { BehaviorSelector } from "../plot_behavior_selector.js"
import { DatasetSelector } from "../plot_dataset_selector.js"
import { NeuronBehaviorPlot } from "../plot_manager.js"
import { initSlider, setLocalBool, getLocalBool } from "/static/core/js/utility.js"
import { EncodingTable } from "../encoding_table.js"
import { adjustWidth } from "../plot_data.js"
import { PlotGraph } from "../plot_graph.js"

function copyURL() {
    const currentUrl = window.location.href;
    navigator.clipboard.writeText(currentUrl);
    alert("URL copied to clipboard");
}

function initPlotManager(data) {
    return new Promise((resolve, reject) => {
        // 1. Create the PlotManager
        const plotManager = new NeuronBehaviorPlot("plot_main", data);

        // 2. Optional: populate with initial traces
        const initNeuronData = data.trace_init;
        if (initNeuronData) {
            Object.keys(initNeuronData).forEach((idxNeuron) => {
                plotManager.trace[idxNeuron] = initNeuronData[idxNeuron]["trace"];
            });
        }

        // 3. Wait for the behaviorInitPromise
        plotManager.behaviorInitPromise
            .then(() => {
                // 4. Once done, resolve the promise with the fully initialized plotManager
                resolve(plotManager);
            })
            .catch((error) => {
                reject(error);
            });
    });
}

document.addEventListener('DOMContentLoaded', async () => {
    // 1. Initialize PlotManager
    const plotManager = await initPlotManager(data);

    // 2. Init others
    /*
        Connectome
    */
    const isNeuroPAL = data.dataset_type.includes("neuropal");
    const plotGraph = isNeuroPAL ? new PlotGraph("connectome-graph", data) : null;
    const datasetSelector = isNeuroPAL ? new DatasetSelector("select-dataset", plotGraph) : null;

    /*
        Selectors
    */
    const neuronSelector = new NeuronSelector("select-neuron", plotManager, plotGraph)
    const behaviorSelector = new BehaviorSelector("select-behavior", plotManager)

    /*
        Buttons
    */
    const buttonClear = document.getElementById("clearSelectors")
    buttonClear.addEventListener('click', () => {
        neuronSelector.clearSelector();
        behaviorSelector.clearSelector();
        plotManager.renderCor();
    });

    const buttonResetScale = document.getElementById("button_reset_scale")
    buttonResetScale.addEventListener('click', () => {
        plotManager.resetXYAxes();
    });

    const buttonCopyURL = document.getElementById("button_copy_url")
    buttonCopyURL.addEventListener('click', () => {
        copyURL();
    });

    const buttonCSVExport = document.getElementById("button_csv_export")
    buttonCSVExport.addEventListener('click', () => {
        plotManager.exportCSV()
    });

    // connectome toggle
    const buttonToggleConnectome = document.getElementById("button_connectome_visibility");
    const colPlot = document.getElementById("col-plot");
    const colConnectome = document.getElementById("col-connectome");

    if (isNeuroPAL) {
        // enable the button
        buttonToggleConnectome.classList.remove("disabled");
        buttonToggleConnectome.style.display = "block";

        // show/hide connectome nutton
        buttonToggleConnectome.addEventListener('click', () => {
            if (colConnectome.classList.contains("hidden-forced")) {
                // Show Column 2 and revert Column 1 to its original width
                colPlot.classList.remove("col-lg-12");
                colPlot.classList.add("col-lg-6");

                colConnectome.classList.remove("hidden-forced");
                colConnectome.classList.remove("d-none");
            } else {
                // Hide Column 2 and make Column 1 full width
                colPlot.classList.remove("col-lg-6");
                colPlot.classList.add("col-lg-12");

                colConnectome.classList.add("hidden-forced");
                colConnectome.classList.add("d-none");
            }

            document.getElementById("col-plot").offsetWidth;
            // requestAnimationFrame(() => adjustWidth("col-plot", plotManager.plotElementId));
            setTimeout(() => adjustWidth("col-plot", plotManager.plotElementId), 325);
        });
    } else {
        colPlot.classList.remove("col-lg-6");
        colPlot.classList.add("col-lg-12");
    }

    /*
        Collapse
    */
    // correlation collapse, fires when the collapse is fully expanded
    const corCollapse = document.getElementById("collapseCor");
    corCollapse.addEventListener("shown.bs.collapse", function () {
        // Smoothly scroll this element into view
        corCollapse.scrollIntoView({ behavior: "smooth" });
    });

    /*
        Sliders
    */
    const sliderPlotHeight = document.getElementById("plotHeightSlider");
    const updatePlotHeight = (height) => {
        Plotly.relayout(plotManager.plot, { height: height });
    }
    initSlider("plotHeightSlider", null, "activity_plot_height", 800, () => { })
    updatePlotHeight(sliderPlotHeight.value)
    const buttonUpdatePlotHeight = document.getElementById("updatePlotHeight")
    buttonUpdatePlotHeight.addEventListener('click', () => {
        updatePlotHeight(sliderPlotHeight.value)
    });

    /*
        init plot with url
    */
    const currentUrl = new URL(window.location.href);
    const urlParams = new URLSearchParams(currentUrl.search);

    // behaviors
    const behaviorsUrl = urlParams.get("b")
    if (behaviorsUrl != null) {
        const behaviors = behaviorsUrl.split("-");
        const manifestBehavior = []
        behaviors.forEach((b, i) => {
            try {
                if (b in behaviorSelector.behaviorMeta) manifestBehavior.push(b)
            } catch (error) {
                console.error("incorrect url parameter for behavior")
            }
        })
        behaviorSelector.selector.addItems(manifestBehavior)
    }

    // neurons
    const neuronsUrl = urlParams.get("n")
    if (neuronsUrl) {
        const neurons = decodeURIComponent(neuronsUrl).split("-").map(n => n.trim()).filter(n => n !== "");
        const manifestNeurons = neurons.filter(n => n in neuronSelector.selector.options);
        if (manifestNeurons.length > 0) {
            neuronSelector.selector.addItems(manifestNeurons, true);
        } else {
            console.warn('No valid neurons found in URL parameter "n"');
        }
    }

    /*
        Encoding table
    */
    const encodingTable = new EncodingTable("dataset", data, "individual")

    /*
        Tours
    */
    const tourActivity = getLocalBool("tour-activity-explore", true)
    const tourConnectome = getLocalBool("tour-activity-explore-connectome", true) && isNeuroPAL
    const tour = new Shepherd.Tour({
        useModalOverlay: true,
        defaultStepOptions: {
            classes: 'shadow-md bg-white',
            scrollTo: true,
            cancelIcon: {
                enabled: true
            },
        },
    });

    if (tourActivity) {        
        tour.addStep({
            id: 'step-1-select-neuron',
            text: 'Search and select neurons to plot.',
            attachTo: {
                element: '#select-neuron-container',
                on: 'top'
            },
            buttons: [
                { text: 'Next', action: tour.next }
            ],
        });

        tour.addStep({
            id: 'step-2-select-behavior',
            text: 'Select which behavior data to plot.',
            attachTo: {
                element: '#select-behavior-container',
                on: 'top'
            },
            buttons: [
                { text: 'Back', action: tour.back },
                { text: 'Next', action: tour.next }
            ],
        });


        tour.addStep({
            id: 'step-2.5-subplot-neuron',
            text: 'This section of the plot shows the neural activity traces (GCaMP) of the selected neurons.',
            attachTo: {
                element: '.xy',
                on: 'right'
            },
            buttons: [
                { text: 'Back', action: tour.back },
                { text: 'Next', action: tour.next }
            ],
        });

        tour.addStep({
            id: 'step-2.5-subplot-behavior',
            text: 'This section of the plot shows the selected behavioral data.',
            attachTo: {
                element: '.xy2',
                on: 'right'
            },
            buttons: [
                { text: 'Back', action: tour.back },
                { text: 'Next', action: tour.next }
            ],
        });

        tour.addStep({
            id: 'step-3-toggle',
            text: 'Toggle traces on/off by clicking a trace.',
            attachTo: {
                element: '.bg',
                on: 'right'
            },
            buttons: [
                { text: 'Back', action: tour.back },
                { text: 'Next', action: tour.next }
            ],
        });

        tour.addStep({
            id: 'step-4-cor-button',
            text: 'Examine the Pearson correlation among the neurons and hehaviors.',
            attachTo: {
                element: '#button_cor',
                on: 'right'
            },
            buttons: [
                { text: 'Back', action: tour.back },
                { text: 'Next', action: tour.next }
            ],
        });

        tour.addStep({
            id: 'step-67-encoding-table',
            text: 'This table shows the encoding parameters determined by the CePNEM models.',
            attachTo: {
                element: '#encodingTableCard',
                on: 'top'
            },
            buttons: [
                { text: 'Back', action: tour.back },
                tourConnectome ? { text: 'Next', action: tour.next } : { text: 'Complete', action: tour.complete } 
            ],
        });
    }

    if (tourConnectome) {
        tour.addStep({
            id: 'step-5-connectome-column',
            text: "Here you can see the connectivity of the plotted neural traces. Note that only the NeuroPAL-identified neurons can be displayed here.<br><br>\
                Scroll to zoom in/out and click and move to pan.",
            attachTo: {
                element: '#col-connectome',
                on: 'right'
            },
            buttons: [
                { text: 'Back', action: tour.back },
                { text: 'Next', action: tour.next }
            ],
        });

        tour.addStep({
            id: 'step-5-connectome-layout',
            text: 'Change the connectome diagram layout.',
            attachTo: {
                element: '#dropdownLayoutContainer',
                on: 'right'
            },
            buttons: [
                { text: 'Back', action: tour.back },
                { text: 'Next', action: tour.next }
            ],
            beforeShowPromise: () => {          
                const layoutGrid = document.querySelector('.dropdown-item[data-value="grid"]');
                layoutGrid.click();
                return Promise.resolve();
            },
        });

        tour.addStep({
            id: 'step-6-connectome-color',
            text: 'Change the connectome node coloring to display different info such as neuron types.',
            attachTo: {
                element: '#dropdownColorContainer',
                on: 'right'
            },
            buttons: [
                { text: 'Back', action: tour.back },
                { text: 'Next', action: tour.next }
            ],
            beforeShowPromise: () => {          
                const colorType = document.querySelector('.dropdown-item[data-value="type"]');
                colorType.click();
                return Promise.resolve();
            },
        });
    }

    // const tourActivity = getLocalBool("tour-activity-explore", true)
    // const tourConnectome = getLocalBool("tour-activity-explore-connectome", true)

    if (tourActivity || tourConnectome) {
        tour.on('complete', () => {
            if (tourConnectome) {
                const layoutConcentric = document.querySelector('.dropdown-item[data-value="concentric"]');
                const colorType = document.querySelector('.dropdown-item[data-value="gcamp"]');
                layoutConcentric.click();
                colorType.click();
            }

            window.scrollTo(0, 0);

            if (tourActivity) setLocalBool("tour-activity-explore", false)
            if (tourConnectome) setLocalBool("tour-activity-explore-connectome", false)
        });

        tour.on('cancel', () => {
            if (tourConnectome) {
                const layoutConcentric = document.querySelector('.dropdown-item[data-value="concentric"]');
                const colorType = document.querySelector('.dropdown-item[data-value="gcamp"]');
                layoutConcentric.click();
                colorType.click();
            }

            window.scrollTo(0, 0);
            
            if (tourActivity) setLocalBool("tour-activity-explore", false)
            if (tourConnectome) setLocalBool("tour-activity-explore-connectome", false)
        });

        tour.start()
    }
})