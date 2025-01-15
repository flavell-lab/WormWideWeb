import { NeuronSelector } from "../plot_neuron_selector.js"
import { BehaviorSelector } from "../plot_behavior_selector.js"
import { DatasetSelector } from "../plot_dataset_selector.js"
import { NeuronBehaviorPlot } from "../plot_manager.js"
import { initSlider } from "/static/core/js/utility.js"
import { EncodingTable } from "../encoding_table.js"
import { adjustWidth } from "../plot_data.js"
import { PlotGraph } from "../plot_graph.js"

function copyURL() {
    const currentUrl = window.location.href;
    navigator.clipboard.writeText(currentUrl);
    alert("URL copied to clipboard");
}

document.addEventListener('DOMContentLoaded', () => {
    initPage();
})

async function initPage() {
    // tooltips
    const tooltipTriggerList = document.querySelectorAll('[data-bs-toggle="tooltip"]')
    const tooltipList = [...tooltipTriggerList].map(tooltipTriggerEl => new bootstrap.Tooltip(tooltipTriggerEl))
    
    /*
        Plot
    */
    const plotManager = new NeuronBehaviorPlot("plot_main", data);

    // populate the requested trace
    const initNeuronData = data.trace_init
        if (initNeuronData) {
        Object.keys(initNeuronData).forEach((idxNeuron) => {
            plotManager.trace[idxNeuron] = initNeuronData[idxNeuron]["trace"]
        });
    }

    await plotManager.behaviorInitPromise;
    
    /*
        Connectome
    */
    const isNeuroPAL = data.dataset_type.includes("neuropal");
    const plotGraph  = isNeuroPAL ? new PlotGraph("connectome-graph", data.neuron) : null;
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
    initSlider("plotHeightSlider", null, "activity_plot_height", 800, ()=>{})
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
        behaviors.forEach((b,i) => {
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
    *   encoding table
    */
    const encodingTable = new EncodingTable("dataset", data, "individual")    
}