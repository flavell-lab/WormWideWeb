import Shepherd from 'https://cdn.jsdelivr.net/npm/shepherd.js@13.0.0/dist/esm/shepherd.mjs';
import { NeuronSelector } from "../plot_neuron_selector.js"
import { BehaviorSelector } from "../plot_behavior_selector.js"
import { DatasetSelector } from "../plot_dataset_selector.js"
import { NeuronBehaviorPlot } from "../plot_manager.js"
import { getDatasetTypePill, initSlider, setLocalStr, setLocalBool, getLocalBool, toggleFullscreen, handleFullscreenElement } from "/static/core/js/utility.js"
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

        // 2. Populate with initial traces
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
    /*
        Badges
    */
    document.getElementById("datasetTypeBadges").innerHTML = Object.keys(data.dataset_type).map(typeId =>
        getDatasetTypePill(typeId, data.dataset_type)
    ).join(" ")

    // init PlotManager
    const plotManager = await initPlotManager(data);

    /*
        Connectome
    */
    const connectomeLayout = localStorage.getItem("activity_connectome_layout")
    if (connectomeLayout === null) {
        setLocalStr("activity_connectome_layout", "grid")
    }      
    const isNeuroPAL = "common-neuropal" in data.dataset_type;
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

    const buttonToggleConnectome = document.getElementById("buttonToggleConnectome")

    /*
        Fullscreen logic
    */
    const colPlot = document.getElementById("col-plot");
    const colConnectome = document.getElementById("col-connectome");

    const buttonPlotFullscreen = document.getElementById("buttonPlotFullscreen");
    const plotFullscreenIcon = document.getElementById("plotFullscreenIcon");
    const plotFullscreenLabel = document.getElementById("plotFullscreenLabel");
    const buttonConnectomeFullscreen = document.getElementById("buttonConnectomeFullscreen");
    const connectomeFullscreenIcon = document.getElementById("connectomeFullscreenIcon");
    const connectomeFullscreenLabel = document.getElementById("connectomeFullscreenLabel");

    buttonPlotFullscreen.addEventListener("click", () => {
        // Toggle fullscreen on the plot column
        toggleFullscreen(colPlot);
    });

    if (isNeuroPAL) {
        // If NeuroPAL is enabled, set up fullscreen toggle for the connectome
        buttonConnectomeFullscreen.addEventListener("click", () => {
            toggleFullscreen(colConnectome);
        });
    } else {
        // If not NeuroPAL, remove the connectome column entirely, making the plot column full width
        colPlot.classList.remove("col-lg-6");
        colPlot.classList.add("col-lg-12");
    }

    const fullscreenMap = {
        "col-plot": {
            icon: plotFullscreenIcon,
            label: plotFullscreenLabel,
            // A callback for any special logic (like adjusting width)
            onToggle() {
                buttonToggleConnectome.classList.toggle("d-none")
                // Force reflow, then adjust width
                colPlot.offsetWidth;
                setTimeout(() => adjustWidth("col-plot", plotManager.plotElementId), 350);
            }
        },
        "col-connectome": {
            icon: connectomeFullscreenIcon,
            label: connectomeFullscreenLabel,
            // connectome doesn't need a special callback, so we can omit it
        }
    };

    let lastFullscreenElement = null;
    document.addEventListener("fullscreenchange", () => {
        if (document.fullscreenElement) {
            // ENTER fullscreen
            lastFullscreenElement = document.fullscreenElement;
            handleFullscreenElement(fullscreenMap, lastFullscreenElement.id);
        } else {
            // EXIT fullscreen
            if (lastFullscreenElement) {
                handleFullscreenElement(fullscreenMap, lastFullscreenElement.id);
            }
            lastFullscreenElement = null;
        }
    });

    /*
        Connectome toggle
    */
    if (isNeuroPAL) {
        buttonToggleConnectome.addEventListener("click", () => {
            if (colConnectome.classList.contains("d-none")) {
                colPlot.classList.add("col-lg-6");
                colPlot.classList.remove("col-lg-12");

                colConnectome.classList.add("col-lg-6");
                colConnectome.classList.remove("col-lg-12");
                colConnectome.classList.remove("d-none");
                setTimeout(() => adjustWidth("col-plot", plotManager.plotElementId), 375);
            } else {
                colPlot.classList.remove("col-lg-6");
                colPlot.classList.add("col-lg-12");
                
                colConnectome.classList.remove("col-lg-6");
                colConnectome.classList.add("col-lg-12");
                colConnectome.classList.add("d-none");
                setTimeout(() => adjustWidth("col-plot", plotManager.plotElementId), 375);
            }
        })
    }

    /*
        Collapse
    */
    // correlation collapse, fires when the collapse is fully expanded
    const corCollapse = document.getElementById("collapseCor");
    corCollapse.addEventListener("shown.bs.collapse", function () {
        if (document.fullscreenElement) {
            document.exitFullscreen()
        }
        // Wait a bit longer (1000ms) before scrolling to ensure the fullscreen exit is processed
        setTimeout(function () {
            // Force a reflow to ensure the layout is updated
            corCollapse.offsetWidth;

            // Smoothly scroll the collapse element into view
            corCollapse.scrollIntoView({ behavior: "smooth" });
        }, 500); // Increase delay to 1000ms or more if necessary
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
    if (data.encoding_data_exists) {
        const encodingTable = new EncodingTable("dataset", data, "individual")
    }

    /*
        Tooltips
    */
    const tooltipTriggerList = document.querySelectorAll('[data-bs-toggle="tooltip"]')
    const tooltipList = [...tooltipTriggerList].map(tooltipTriggerEl => new bootstrap.Tooltip(tooltipTriggerEl))

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
            id: 'step-select-neuron',
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
            id: 'step-select-behavior',
            text: 'Select which behavior data to plot.',
            attachTo: {
                element: '#select-behavior-container',
                on: 'top'
            },
            buttons: [
                { text: 'Next', action: tour.next }
            ],
        });

        tour.addStep({
            id: 'step-subplot-neuron',
            text: 'This section of the plot shows the neural activity traces (GCaMP) of the selected neurons.',
            attachTo: {
                element: '.xy',
                on: 'right'
            },
            buttons: [
                { text: 'Next', action: tour.next }
            ],
        });

        tour.addStep({
            id: 'step-subplot-behavior',
            text: 'This section of the plot shows the selected behavioral data.',
            attachTo: {
                element: '.xy2',
                on: 'right'
            },
            buttons: [
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
                { text: 'Next', action: tour.next }
            ],
        });

        tour.addStep({
            id: 'step-cor-button',
            text: 'Examine the Pearson correlation among the neurons and hehaviors.',
            attachTo: {
                element: '#button_cor',
                on: 'right'
            },
            buttons: [
                { text: 'Next', action: tour.next }
            ],
        });

        tour.addStep({
            id: 'step-encoding-table',
            text: 'This table shows the encoding parameters determined by the CePNEM models.',
            attachTo: {
                element: '#encodingTableCard',
                on: 'top'
            },
            buttons: [
                tourConnectome ? { text: 'Next', action: tour.next } : { text: 'Complete', action: tour.complete }
            ],
        });
    }

    if (tourConnectome) {
        tour.addStep({
            id: 'step-connectome-column',
            text: "Here you can see the connectivity of the plotted neural traces. Note that only the NeuroPAL-identified neurons can be displayed here.<br><br>\
                Scroll to zoom in/out and click and move to pan.",
            attachTo: {
                element: '#col-connectome',
                on: 'right'
            },
            buttons: [
                { text: 'Next', action: tour.next }
            ],
        });

        tour.addStep({
            id: 'step-connectome-layout',
            text: 'Change the connectome diagram layout.',
            attachTo: {
                element: '#dropdownLayoutContainer',
                on: 'right'
            },
            buttons: [
                { text: 'Next', action: tour.next }
            ],
            beforeShowPromise: () => {
                const layoutConcentric = document.querySelector('.dropdown-item[data-value="concentric"]');
                layoutConcentric.click();
                return Promise.resolve();
            },
        });

        tour.addStep({
            id: 'step-connectome-color',
            text: 'Change the connectome node coloring to display different info such as neuron types.',
            attachTo: {
                element: '#dropdownColorContainer',
                on: 'right'
            },
            buttons: [
                { text: 'Next', action: tour.next }
            ],
            beforeShowPromise: () => {
                const colorType = document.querySelector('.dropdown-item[data-value="type"]');
                colorType.click();
                return Promise.resolve();
            },
        });

        tour.addStep({
            id: 'step-node-select',
            text: "Select a neuron/node to highlght its connections.<br><br>Each available neuron's correlation coefficient with the selected neuron is displayed in color.",
            attachTo: {
                element: '#connectome-graph',
                on: 'top'
            },
            buttons: [
                { text: 'Next', action: tour.next }
            ],
            beforeShowPromise: () => {
                const nodeId = Object.keys(plotGraph.manifest)[0]
                const node = plotGraph.graph.getElementById(nodeId); // Get the node by ID
                node.trigger('select');
                return Promise.resolve();
            }
        });

        tour.addStep({
            id: 'step-node-info',
            text: 'Node info is displayed here, along with the links to select external resources.',
            attachTo: {
                element: '.info-panel',
                on: 'right'
            },
            buttons: [
                { text: 'Next', action: tour.next }
            ],
            beforeShowPromise: () => {
                const nodeId = Object.keys(plotGraph.manifest)[0]
                const node = plotGraph.graph.getElementById(nodeId); // Get the node by ID
                node.trigger('tap');
                return Promise.resolve();
            }
        });
    }

    if (tourActivity || tourConnectome) {
        tour.on('complete', () => {
            if (tourConnectome) {
                const layoutGrid = document.querySelector('.dropdown-item[data-value="grid"]');
                const colorType = document.querySelector('.dropdown-item[data-value="gcamp"]');
                layoutGrid.click();
                colorType.click();
            }

            window.scrollTo(0, 0);

            if (tourActivity) setLocalBool("tour-activity-explore", false)
            if (tourConnectome) {
                setLocalBool("tour-activity-explore-connectome", false)
                const nodeId = Object.keys(plotGraph.manifest)[0]
                const node = plotGraph.graph.getElementById(nodeId);
                node.trigger('unselect');
                plotGraph.infoPanel.hidePanel();
            }
        });

        tour.on('cancel', () => {
            if (tourConnectome) {
                const layoutGrid = document.querySelector('.dropdown-item[data-value="grid"]');
                const colorType = document.querySelector('.dropdown-item[data-value="gcamp"]');
                layoutGrid.click();
                colorType.click();
            }

            window.scrollTo(0, 0);

            if (tourActivity) setLocalBool("tour-activity-explore", false)
            if (tourConnectome) {
                setLocalBool("tour-activity-explore-connectome", false)
                const nodeId = Object.keys(plotGraph.manifest)[0]
                const node = plotGraph.graph.getElementById(nodeId);
                node.trigger('unselect');
                plotGraph.infoPanel.hidePanel();
            }
        });

        tour.start()
    }
})