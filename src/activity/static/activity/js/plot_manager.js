import {
    getColorIdx, getCycleColor, findTrace, initPlot,
    plotNeuron as plotNeuronFunction,
    plotBehavior as plotBehaviorFunction,
    initEvent,
    toggleEvent,
    initReversal,
    toggleReversal
} from './plot_data.js';

import { removeFromList, minArray, maxArray, initSwitch, getLocalBool } from '/static/core/js/utility.js';
import { PLOTLY_COLOR_SCALES, getNodeColor, updateColorBar } from '/static/core/js/colorscale.js';

/*
    Neuron and Behavior Plot Manager.
 */
export class NeuronBehaviorPlot {
    constructor(plotElementId, data) {
        this.plotElementId = plotElementId;
        this.plot = document.getElementById(plotElementId);
        if (!this.plot) {
            throw new Error(`Element with ID "${plotElementId}" not found.`);
        }

        this.data = data;
        
        // collapse for cor
        this.collapseCorElement = document.getElementById('collapseCor');
        this.collapseCorElement.addEventListener('shown.bs.collapse', () => {
            this.renderCor();
        });

        // Initialize counters and data structures
        this.nBehavior = 0;
        this.nNeuron = 0;
        this.dictIdxCNeuron = {};
        this.listIdxPlot = [];
        this.listBehaviorShort = [];

        // Neuron trace cache
        this.trace = {};

        // Style configurations
        this.colorReversal = 'rgba(255, 0, 0, 0.15)';
        this.styleEvent = {};

        // Initialize switches
        this.switchShowReversal = {
            value: getLocalBool("activity_show_reversal", true)
        };
        initSwitch(
            "switchShowReversal",
            () => toggleReversal(this, true),
            () => toggleReversal(this, false),
            this.switchShowReversal,
            "activity_show_reversal",
            this.switchShowReversal.value
        );

        this.switchShowEvent = {
            value: getLocalBool("activity_show_event", false)
        };
        initSwitch(
            "switchShowEvent",
            () => toggleEvent(this, true),
            () => toggleEvent(this, false),
            this.switchShowEvent,
            "activity_show_event",
            this.switchShowEvent.value
        );

        // Spinner element
        this.spinner = document.getElementById("spinnerStatus");
        if (!this.spinner) {
            console.warn('Spinner element with ID "spinnerStatus" not found.');
        }

        // Initialize time data
        this.initTime();

        // Instead of calling initBehaviorData() directly, store the promise and then do subsequent logic in a .then() chain.
        this.behaviorInitPromise = this.initBehaviorData();

        // Once the behavior data is fetched, continue with initializations
        this.behaviorInitPromise
            .then(() => {
                // Now the data is guaranteed to be present
                this.initPlot();
                initReversal(this.plot, this.plotElementId, this.reversals, this.colorReversal, this.avgTimestep)
                toggleReversal(this, this.switchShowReversal.value);

                initEvent(
                    this.plot,
                    this.plotElementId,
                    this.events,
                    this.styleEvent,
                    this.avgTimestep
                )
                toggleEvent(this, this.switchShowEvent.value);
                if (Object.keys(this.events).length == 0) {
                    const switchShowEvent = document.getElementById("switchShowEvent");
                    switchShowEvent.setAttribute("disabled", "true");
                    switchShowEvent.checked = false;
                }
            })
            .catch(error => {
                console.error('Error initializing behavior data:', error);
            });

        // Initialize the plot promise chain
        this.lastPlotPromise = Promise.resolve();

        // URL synchronization controls (used to avoid noisy updates during bulk hydration)
        this.isURLSyncPaused = false;
        this.pendingNeuronURLSync = false;
        this.pendingBehaviorURLSync = false;

        this.corNeuronMaxCellSize = 32;

        this.corBehaviorMaxCellSize = 32;
    }

    /**
     * Initializes time-related data for plotting.
     */
    initTime() {
        this.avgTimestep = this.data["avg_timestep"];
        this.listIdxT = Array.from({ length: this.data["max_t"] }, (_, i) => i);
        this.listTMinute = this.listIdxT.map(n => n * this.avgTimestep);
    }

    /**
     * Asynchronously fetches and initializes behavior data from your API endpoint.
     * Ensure it's a *blocking* (i.e., promise-based) call so that subsequent code
     * only runs once data is fully fetched.
     */
    async initBehaviorData() {
        // If you store your dataset_id in this.data["dataset_id"],
        // construct the new endpoint URL:
        const datasetId = this.data["dataset_id"];
        const fullUrl = `/activity/api/data/${datasetId}/behavior/`;

        try {
            const response = await fetch(fullUrl);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const remoteBehavior = await response.json();

            this.data.behavior = remoteBehavior.data.behavior;
            const behavior = this.data.behavior;
            if (!behavior) {
                console.warn('Behavior data is missing.');
                return;
            }

            this.behavior = this.data.behavior.traces
            this.styleEvent = remoteBehavior?.data?.event_style || {};

            // Reversals
            this.reversals = behavior["reversal_events"] || [];
            this.events = remoteBehavior?.data?.events || {};

            // Return so that .then() can know we completed successfully
            return true;
        } catch (error) {
            console.error("Error fetching or parsing behavior data:", error);
            throw error; // re-throw for the .catch in the constructor
        }
    }

    /**
     * Retrieves the trace data for a given neuron index.
     * @param {number|string} idxNeuron - The index of the neuron.
     * @returns {Promise<Array>} A promise that resolves to the trace data.
     */
    async getTrace(idxNeuron) {
        if (idxNeuron in this.trace) {
            // Loading from cache
            return this.trace[idxNeuron];
        } else {
            const fullUrl = `/activity/api/data/${this.data["dataset_id"]}/${idxNeuron}/`;
            try {
                const response = await fetch(fullUrl);
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                const data = await response.json();
                this.trace[idxNeuron] = data["trace"];
                return data["trace"];
            } catch (error) {
                console.error("Error fetching data:", error);
                throw error;
            }
        }
    }

    /**
     * Plots a neuron on the graph, ensuring sequential execution.
     * @param {number|string} idxNeuron - The index of the neuron to plot.
     * @param {string} label - The label for the neuron trace.
     * @returns {Promise<void>}
     */
    plotNeuronSequential(idxNeuron, label) {
        // Chain the plotNeuron calls to ensure sequential execution
        this.lastPlotPromise = this.lastPlotPromise
            .then(() => this.plotNeuron(idxNeuron, label))
            .catch(error => {
                // Handle individual plot errors without stopping the chain
                console.error(`Error plotting neuron ${idxNeuron}:`, error);
            });
        return this.lastPlotPromise;
    }

    /**
     * Internal method to handle the actual plotting logic.
     * @private
     * @param {number|string} idxNeuron - The index of the neuron to plot.
     * @param {string} label - The label for the neuron trace.
     * @returns {Promise<void>}
     */
    async plotNeuron(idxNeuron, label) {
        try {
            // Show spinner if available
            if (this.spinner) {
                this.spinner.style.display = "block";
            }

            const trace = await this.getTrace(idxNeuron);
            const traceId = `n_${idxNeuron}`;

            // Get color index and assign color
            const colorIndex = getColorIdx(this.dictIdxCNeuron);
            this.dictIdxCNeuron[traceId] = colorIndex;
            const color = getCycleColor(colorIndex);

            // Plot the neuron using the imported plotNeuron function
            plotNeuronFunction(
                this.plotElementId,
                this.listTMinute,
                trace,
                label,
                traceId,
                color
            );
            this.resetYAxis();

            // update counters and lists
            this.nNeuron += 1;
            this.listIdxPlot.push(idxNeuron);

            // sort the legend to keep it organized
            this.sortLegend();

            // update the URL with the new neuron list
            this.updateURLNeuron(this.listIdxPlot.join('-'));

            // If correlation panel is open, re-render
            if (this.collapseCorElement.classList.contains("show")) {
                this.renderCor();
            }
        } catch (error) {
            console.error(`Failed to plot neuron ${idxNeuron}:`, error);

            const errorDisplay = document.getElementById("error_plot");
            if (errorDisplay) {
                errorDisplay.innerHTML = `Failed to plot neuron ${idxNeuron}`;
                errorDisplay.style.display = "block";
            }
        } finally {
            // Hide spinner if available
            if (this.spinner) {
                this.spinner.style.display = "none";
            }
        }
    }

    /**
     * Removes a neuron from the plot.
     */
    removeNeuron(idxNeuron) {
        const traceId = `n_${idxNeuron}`;
        const traceIndex = findTrace(this.plot, traceId);

        if (traceIndex === -1) {
            console.warn(`Trace ID "${traceId}" not found.`);
            return;
        }

        // Remove from the color index dictionary
        delete this.dictIdxCNeuron[traceId];

        // Remove from the list of plotted neurons and update the URL
        removeFromList(this.listIdxPlot, idxNeuron);
        this.updateURLNeuron(this.listIdxPlot.join('-'));

        // Remove the trace from the plot
        Plotly.deleteTraces(this.plotElementId, traceIndex);
        this.resetXYAxes();

        this.nNeuron -= 1;

        this.renderCor();
    }

    /**
     * Plots a behavior trace on the graph.
     * @param {string} nameShort - The short name identifier for the behavior.
     * @param {string} label - The label for the behavior trace.
     */
    plotBehavior(nameShort, label) {
        // If some code calls `plotBehavior()` before initBehaviorData() is done,
        // we can be defensive by waiting on `this.behaviorInitPromise`.
        // But if your usage ensures you only call it later, it may not be needed.
        // E.g.:
        // await this.behaviorInitPromise;

        const behavior = this.behavior[nameShort];
        if (!behavior) {
            console.warn(`Behavior "${nameShort}" not found.`);
            return;
        }

        const color = getCycleColor(behavior.i);
        plotBehaviorFunction(
            this.plotElementId,
            this.listTMinute,
            behavior.data,
            label,
            `b_${nameShort}`,
            color
        );

        this.nBehavior += 1;
        this.listBehaviorShort.push(nameShort);
        this.updateURLBehavior(this.listBehaviorShort.join('-'));
        this.sortLegend();
    }

    /**
     * Removes a behavior trace from the plot.
     */
    removeBehavior(nameShort) {
        const traceId = `b_${nameShort}`;
        const traceIndex = findTrace(this.plot, traceId);

        if (traceIndex === -1) {
            console.warn(`Trace ID "${traceId}" not found.`);
            return;
        }

        Plotly.deleteTraces(this.plotElementId, traceIndex);
        removeFromList(this.listBehaviorShort, nameShort)
        this.nBehavior -= 1;

        this.updateURLBehavior(this.listBehaviorShort.join('-'))
    }

    /**
     * Initializes the Plotly plot.
     */
    initPlot() {
        initPlot(this.plotElementId);
        this.plot.on('plotly_doubleclick', () => this.resetYAxis());
    }

    /**
     * Sorts the legend entries alphabetically by trace name.
     */
    sortLegend() {
        if (!this.plot || !this.plot.data) return;

        // Clone the current data to avoid mutating the original array
        let sortedData = [...this.plot.data];

        // Sort the data array by trace name alphabetically
        sortedData.sort((a, b) => {
            // Get the first part of the name (before the space)
            const aNamePart = a.name.split(" ")[0];
            const bNamePart = b.name.split(" ")[0];

            // Check if the first part starts with a number (using isNaN)
            const isANumberA = !isNaN(aNamePart);
            const isANumberB = !isNaN(bNamePart);

            // If both are numbers, sort numerically
            if (isANumberA && isANumberB) {
                return parseInt(aNamePart) - parseInt(bNamePart);
            } else if (isANumberA) {
                // If only a starts with a number, sort numbers before alphabets
                return -1;
            } else if (isANumberB) {
                // If only b starts with a number, sort numbers before alphabets
                return 1;
            } else {
                // If none are numbers, sort alphabetically
                return aNamePart.localeCompare(bNamePart);
            }
        });

        // Update the plot with the sorted data
        Plotly.react(this.plot, sortedData, this.plot.layout);
    }

    /**
     * Resets both X and Y axes based on the current data.
     */
    resetXYAxes() {
        let margin = 0.05;
        let y_max = -Infinity;
        let y_min = Infinity;
        let qchange = false;

        // Iterate over traces to find Y-axis limits
        this.plot.data.forEach(trace => {
            if (trace.id && trace.id.startsWith("n_")) {
                const currentMax = maxArray(trace.y);
                const currentMin = minArray(trace.y);
                if (currentMax > y_max) y_max = currentMax;
                if (currentMin < y_min) y_min = currentMin;
                qchange = true;
            }
        });

        if (!qchange) return;

        // Apply margin
        y_max += margin * Math.abs(y_max);
        y_min -= margin * Math.abs(y_min);

        const xRange = [this.listTMinute[0], this.listTMinute[this.listTMinute.length - 1]];
        const yRange = [y_min, y_max];

        const range = {
            "yaxis.range": yRange,
            "xaxis.range": xRange
        };

        Plotly.relayout(this.plot, range).catch(error => {
            console.error("Error resetting axes:", error);
        });
    }

    /**
     * Resets only the Y-axis based on the current data
     */
    resetYAxis() {
        let margin = 0.05;
        let y_max = -Infinity;
        let y_min = Infinity;
        let qchange = false;

        // Iterate over traces to find Y-axis limits
        this.plot.data.forEach(trace => {
            if (trace.id && trace.id.startsWith("n_")) {
                const currentMax = maxArray(trace.y);
                const currentMin = minArray(trace.y);
                if (currentMax > y_max) y_max = currentMax;
                if (currentMin < y_min) y_min = currentMin;
                qchange = true;
            }
        });

        if (!qchange) return;

        // Apply margin
        y_max += margin * Math.abs(y_max);
        y_min -= margin * Math.abs(y_min);

        const xRange = [this.listTMinute[0], this.listTMinute[this.listTMinute.length - 1]];
        const yRange = [y_min, y_max];

        const range = {
            "yaxis.range": yRange,
            "xaxis.range": xRange
        };

        Plotly.relayout(this.plot, range).catch(error => {
            console.error("Error resetting axes:", error);
        });
    }

    /**
     * Pauses or resumes URL synchronization.
     */
    setURLSyncPaused(isPaused) {
        this.isURLSyncPaused = Boolean(isPaused);
    }

    /**
     * Flushes any deferred URL update.
     */
    flushURLSync() {
        if (!this.pendingNeuronURLSync && !this.pendingBehaviorURLSync) return;
        try {
            const url = new URL(window.location.href);
            if (this.pendingNeuronURLSync) {
                url.searchParams.set("n", encodeURIComponent(this.listIdxPlot.join('-')));
            }
            if (this.pendingBehaviorURLSync) {
                url.searchParams.set("b", encodeURIComponent(this.listBehaviorShort.join('-')));
            }
            window.history.replaceState(null, "", url);
        } catch (error) {
            console.error("Error updating URL:", error);
        } finally {
            this.pendingNeuronURLSync = false;
            this.pendingBehaviorURLSync = false;
        }
    }

    /**
     * Updates the URL with the current list of plotted neurons
     */
    updateURLNeuron(listIdxPlotStr) {
        if (this.isURLSyncPaused) {
            this.pendingNeuronURLSync = true;
            return;
        }

        try {
            const url = new URL(window.location.href);
            url.searchParams.set("n", encodeURIComponent(listIdxPlotStr));
            window.history.replaceState(null, "", url);
        } catch (error) {
            console.error("Error updating URL:", error);
        }
    }

    /**
     * Updates the URL with the current list of plotted behaviors
     */
    updateURLBehavior(listBehaviorSelected) {
        if (this.isURLSyncPaused) {
            this.pendingBehaviorURLSync = true;
            return;
        }

        try {
            const url = new URL(window.location.href);
            url.searchParams.set("b", encodeURIComponent(listBehaviorSelected));
            window.history.replaceState(null, "", url);
        } catch (error) {
            console.error("Error updating URL:", error);
        }
    }

    exportCSV() {
        const traceManifest = this.listIdxPlot
        const traceManifestLabel = traceManifest.map(idx => this.data.neuron[idx] ? this.data.neuron[idx].name : `Neuron ${idx}`)
        const behaviorManifest = this.listBehaviorShort
        if (traceManifest.length > 0 || behaviorManifest.length > 0) {
            // Step 1: Combine neuron and behavior keys for CSV columns
            const headers = ["t (minute)", ...traceManifestLabel, ...this.listBehaviorShort];

            // Step 2: Determine how many rows (e.g., time points) you have
            // Here we assume all data arrays have the same length:
            const numRows = this.trace[traceManifest[0]].length;

            // (Alternatively, you could find the min or max length if they differ)

            // Step 3: Build each row of CSV data
            const dataRows = [];
            for (let i = 0; i < numRows; i++) {
                const timeRow = this.listTMinute[i]
                // Gather neuron data at index i
                const neuronRow = traceManifest.map(neuronKey => this.trace[neuronKey][i]);
                // Gather behavior data at index i
                const behaviorRow = this.listBehaviorShort.map(behavKey => this.behavior[behavKey].data[i]);
                // Combine into one row
                dataRows.push([timeRow, ...neuronRow, ...behaviorRow]);
            }

            // Step 4: Build the CSV string
            // First line: the column headers joined by commas
            // Subsequent lines: each data row joined by commas
            const csvStr =
                [headers.join(","), ...dataRows.map(row => row.join(","))].join("\n");


            // Create a link element
            const link = document.createElement("a");

            // Set the link's href to a data URI containing the CSV string
            link.href = "data:text/csv;charset=utf-8," + encodeURI(csvStr);

            // Set the link's download attribute to the desired file name
            link.download = "wormwideweb-data.csv";

            // Append the link to the DOM
            document.body.appendChild(link);

            // Simulate a click on the link to trigger the download
            link.click();

            // Remove the link from the DOM
            document.body.removeChild(link);
        } else {
            alert("Need at least 1 neuron or 1 behavior selected to export data.")
        }
    }

    renderCor() {
        this.renderCorColorBars();
        this.renderCorNeuron();
        this.renderCorBehavior();
        this.renderCorNeuronTop3();
        this.renderCorBehaviorTop3();
    }

    getMainPlotLegendFontSize() {
        const legendTextElement = this.plot?.querySelector(".legend .legendtext");
        if (legendTextElement) {
            const legendSize = Number.parseFloat(window.getComputedStyle(legendTextElement).fontSize);
            if (Number.isFinite(legendSize)) return legendSize;
        }
        return 12;
    }

    renderCorColorBars() {
        const colormapName = "PiYG";
        const colorMin = getNodeColor(-1, -1, 1, colormapName);
        const colorMid = getNodeColor(0, -1, 1, colormapName);
        const colorMax = getNodeColor(1, -1, 1, colormapName);
        updateColorBar(colorMin, colorMid, colorMax, "cor_neuron_colorbar");
        updateColorBar(colorMin, colorMid, colorMax, "cor_behavior_colorbar");

        const legendFontSize = this.getMainPlotLegendFontSize();
        document.querySelectorAll(".cor-static-cbar-label, .cor-static-cbar-ticks").forEach((el) => {
            el.style.fontSize = `${legendFontSize}px`;
        });
    }

    getCorNeuronIndexList() {
        const idxList = [];
        const seen = new Set();
        this.listIdxPlot.forEach((idxNeuron) => {
            const idx = Number.parseInt(idxNeuron, 10);
            if (!Number.isInteger(idx) || seen.has(idx)) return;
            seen.add(idx);
            idxList.push(idx);
        });
        return idxList;
    }

    getCorNeuronName(idxNeuron) {
        return this.data.neuron[idxNeuron]?.name || `Neuron ${idxNeuron}`;
    }

    getNeuronCorrelation(idxNeuron1, idxNeuron2) {
        if (idxNeuron1 === idxNeuron2) return 1.0;
        const key = `${idxNeuron1},${idxNeuron2}`;
        const reverseKey = `${idxNeuron2},${idxNeuron1}`;
        const direct = this.data.cor.neuron[key];
        const reverse = this.data.cor.neuron[reverseKey];
        const value = typeof direct === "number" ? direct : reverse;
        return typeof value === "number" && !Number.isNaN(value) ? value : null;
    }

    setCorNeuronDetail(detailElement, { pairData = null, locked = false, message = "", warning = false } = {}) {
        if (!detailElement) return;
        detailElement.classList.toggle("is-warning", warning);
        if (message) {
            detailElement.innerHTML = message;
            return;
        }
        if (!pairData) {
            detailElement.innerHTML = "<strong>Tip:</strong> Hover over any matrix cell to inspect a pair.";
            return;
        }

        const pairLabel = locked ? "Locked pair" : "Hovered pair";
        const isMissing = pairData.value === null;
        const valueText = isMissing ? "Unavailable" : pairData.value.toFixed(3);
        const extraLine = isMissing
            ? "<div>Missing correlation value for this neuron pair.</div>"
            : "";
        detailElement.innerHTML = `
            <div><strong>${pairLabel}</strong></div>
            <div><span>${pairData.nameRow}</span> × <span>${pairData.nameCol}</span></div>
            <div>Pearson r: <strong>${valueText}</strong></div>
            ${extraLine}
        `;
    }

    getCorNeuronPairData(row, col, idxNeurons, labels, zMatrix) {
        if (
            !Number.isInteger(row) ||
            !Number.isInteger(col) ||
            row < 0 ||
            col < 0 ||
            row >= idxNeurons.length ||
            col >= idxNeurons.length
        ) {
            return null;
        }

        return {
            idxRow: idxNeurons[row],
            idxCol: idxNeurons[col],
            nameRow: labels[row],
            nameCol: labels[col],
            value: zMatrix[row][col],
        };
    }

    getCorBehaviorCodes() {
        const behaviorDict = this.data?.behavior?.traces || {};
        return Object.keys(behaviorDict);
    }

    getCorBehaviorName(behaviorCode) {
        return this.data?.behavior?.traces?.[behaviorCode]?.name || behaviorCode;
    }

    getBehaviorCorrelation(idxNeuron, behaviorCode) {
        const value = this.data?.cor?.behavior?.[idxNeuron]?.[behaviorCode];
        return typeof value === "number" && !Number.isNaN(value) ? value : null;
    }

    setCorBehaviorDetail(detailElement, { cellData = null, locked = false, message = "", warning = false } = {}) {
        if (!detailElement) return;
        detailElement.classList.toggle("is-warning", warning);
        if (message) {
            detailElement.innerHTML = message;
            return;
        }
        if (!cellData) {
            detailElement.innerHTML = "<strong>Tip:</strong> Hover over a strip cell to inspect a behavior-neuron pair.";
            return;
        }

        const label = locked ? "Locked pair" : "Hovered pair";
        const isMissing = cellData.value === null;
        const valueText = isMissing ? "Unavailable" : cellData.value.toFixed(3);
        const extraLine = isMissing
            ? "<div>Missing correlation value for this behavior-neuron pair.</div>"
            : "";
        detailElement.innerHTML = `
            <div><strong>${label}</strong></div>
            <div>Behavior: <span>${cellData.behaviorName}</span></div>
            <div>Neuron: <span>${cellData.neuronName}</span></div>
            <div>Pearson r: <strong>${valueText}</strong></div>
            ${extraLine}
        `;
    }

    getCorBehaviorCellData(row, col, idxNeurons, behaviorCodes, neuronLabels, behaviorLabels, zMatrix) {
        if (
            !Number.isInteger(row) ||
            !Number.isInteger(col) ||
            row < 0 ||
            col < 0 ||
            row >= idxNeurons.length ||
            col >= behaviorCodes.length
        ) {
            return null;
        }

        return {
            behaviorCode: behaviorCodes[col],
            idxNeuron: idxNeurons[row],
            behaviorName: behaviorLabels[col],
            neuronName: neuronLabels[row],
            value: zMatrix[row][col],
        };
    }

    getTopCorrelatedNeuronsForNeuron(idxNeuron, limit = 3) {
        const bestByNeuron = new Map();
        Object.entries(this.data?.cor?.neuron || {}).forEach(([key, value]) => {
            if (typeof value !== "number" || Number.isNaN(value)) return;
            const [idxA, idxB] = key.split(",").map((str) => Number.parseInt(str, 10));
            if (!Number.isInteger(idxA) || !Number.isInteger(idxB)) return;
            if (idxA === idxNeuron && idxB !== idxNeuron) {
                const current = bestByNeuron.get(idxB);
                if (current === undefined || Math.abs(value) > Math.abs(current)) {
                    bestByNeuron.set(idxB, value);
                }
            } else if (idxB === idxNeuron && idxA !== idxNeuron) {
                const current = bestByNeuron.get(idxA);
                if (current === undefined || Math.abs(value) > Math.abs(current)) {
                    bestByNeuron.set(idxA, value);
                }
            }
        });

        const pairs = Array.from(bestByNeuron.entries()).map(([idx, correlation]) => ({ idx, correlation }));
        pairs.sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation));
        return pairs.slice(0, limit);
    }

    getTopCorrelatedNeuronsForBehavior(behaviorCode, limit = 3) {
        const pairs = [];
        Object.entries(this.data?.cor?.behavior || {}).forEach(([idxNeuron, byBehavior]) => {
            if (!byBehavior || typeof byBehavior !== "object") return;
            const value = byBehavior[behaviorCode];
            if (typeof value !== "number" || Number.isNaN(value)) return;
            const idx = Number.parseInt(idxNeuron, 10);
            if (!Number.isInteger(idx)) return;
            pairs.push({ idx, correlation: value });
        });

        pairs.sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation));
        return pairs.slice(0, limit);
    }

    renderCorNeuronTop3() {
        const container = document.getElementById("cor_neuron_top3");
        if (!container) return;

        const idxNeurons = this.getCorNeuronIndexList();
        if (idxNeurons.length === 0) {
            container.innerHTML = '<div class="cor-summary-empty">Select neurons to view top correlated partners.</div>';
            return;
        }

        let html = '<div class="cor-summary-title">Top 3 Correlated Neurons Per Selected Neuron</div>';
        idxNeurons.forEach((idxNeuron) => {
            const sourceName = this.getCorNeuronName(idxNeuron);
            const topPairs = this.getTopCorrelatedNeuronsForNeuron(idxNeuron, 3);
            if (topPairs.length === 0) {
                html += `
                    <div class="cor-summary-item">
                        <span class="cor-summary-target">${sourceName}:</span>
                        <span class="cor-summary-empty">No correlation pairs available.</span>
                    </div>`;
                return;
            }
            const listText = topPairs
                .map((pair) => `${this.getCorNeuronName(pair.idx)} (${pair.correlation.toFixed(3)})`)
                .join(", ");
            html += `
                <div class="cor-summary-item">
                    <span class="cor-summary-target">${sourceName}:</span>
                    <span>${listText}</span>
                </div>`;
        });

        container.innerHTML = html;
    }

    renderCorBehaviorTop3() {
        const container = document.getElementById("cor_behavior_top3");
        if (!container) return;

        const behaviorCodes = this.getCorBehaviorCodes();
        if (behaviorCodes.length === 0) {
            container.innerHTML = '<div class="cor-summary-empty">No behavior traces available.</div>';
            return;
        }

        let html = '<div class="cor-summary-title">Top 3 Correlated Neurons Per Behavior</div>';
        behaviorCodes.forEach((behaviorCode) => {
            const behaviorName = this.getCorBehaviorName(behaviorCode);
            const topPairs = this.getTopCorrelatedNeuronsForBehavior(behaviorCode, 3);
            if (topPairs.length === 0) {
                html += `
                    <div class="cor-summary-item">
                        <span class="cor-summary-target">${behaviorName}:</span>
                        <span class="cor-summary-empty">No correlation values available.</span>
                    </div>`;
                return;
            }
            const listText = topPairs
                .map((pair) => `${this.getCorNeuronName(pair.idx)} (${pair.correlation.toFixed(3)})`)
                .join(", ");
            html += `
                <div class="cor-summary-item">
                    <span class="cor-summary-target">${behaviorName}:</span>
                    <span>${listText}</span>
                </div>`;
        });

        container.innerHTML = html;
    }

    renderCorBehavior() {
        const matrixWrapElement = document.getElementById("cor_behavior_matrix_wrap");
        const matrixElement = document.getElementById("cor_behavior_matrix");
        const detailElement = document.getElementById("cor_behavior_detail");

        if (!matrixElement) return;

        const idxNeurons = this.getCorNeuronIndexList();
        const behaviorCodes = this.getCorBehaviorCodes();
        const nNeurons = idxNeurons.length;
        const nBehaviors = behaviorCodes.length;

        if (nNeurons < 1) {
            Plotly.react(matrixElement, [], {
                height: 160,
                margin: { t: 8, r: 8, b: 8, l: 8 },
                xaxis: { visible: false, fixedrange: true },
                yaxis: { visible: false, fixedrange: true },
                annotations: [{
                    text: "Select at least 1 neuron to view behavioral strips.",
                    x: 0.5,
                    y: 0.5,
                    xref: "paper",
                    yref: "paper",
                    showarrow: false,
                    font: { size: 13 },
                }],
                template: "plotly_white",
            }, {
                displayModeBar: false,
                responsive: true,
            });
            this.setCorBehaviorDetail(detailElement, {
                message: "<strong>Need neurons:</strong> select at least 1 neuron to render behavior strips.",
                warning: true,
            });
            return;
        }

        if (nBehaviors < 1) {
            Plotly.react(matrixElement, [], {
                height: 160,
                margin: { t: 8, r: 8, b: 8, l: 8 },
                xaxis: { visible: false, fixedrange: true },
                yaxis: { visible: false, fixedrange: true },
                annotations: [{
                    text: "No behavior traces available.",
                    x: 0.5,
                    y: 0.5,
                    xref: "paper",
                    yref: "paper",
                    showarrow: false,
                    font: { size: 13 },
                }],
                template: "plotly_white",
            }, {
                displayModeBar: false,
                responsive: true,
            });
            this.setCorBehaviorDetail(detailElement, {
                message: "<strong>No behaviors:</strong> this dataset has no behavior traces to correlate.",
                warning: true,
            });
            return;
        }

        const neuronLabels = idxNeurons.map((idx) => this.getCorNeuronName(idx));
        const behaviorLabels = behaviorCodes.map((code) => this.getCorBehaviorName(code));
        const xAxis = Array.from({ length: nBehaviors }, (_, idx) => idx);
        const yAxis = Array.from({ length: nNeurons }, (_, idx) => idx);
        const zMatrix = Array.from({ length: nNeurons }, () => Array.from({ length: nBehaviors }, () => null));
        const customData = Array.from({ length: nNeurons }, () => Array.from({ length: nBehaviors }, () => null));

        for (let row = 0; row < nNeurons; row++) {
            for (let col = 0; col < nBehaviors; col++) {
                const value = this.getBehaviorCorrelation(idxNeurons[row], behaviorCodes[col]);
                zMatrix[row][col] = value;
                customData[row][col] = [
                    neuronLabels[row],
                    behaviorLabels[col],
                    value === null ? "Unavailable" : value.toFixed(3),
                ];
            }
        }

        const wrapWidth = matrixWrapElement?.clientWidth || 480;
        const usablePixels = Math.max(96, Math.floor(wrapWidth - 24));
        const cellSize = Math.min(this.corBehaviorMaxCellSize, Math.max(1, Math.floor(usablePixels / nNeurons)));
        const stripWidth = Math.max(nBehaviors, cellSize * nBehaviors);
        const stripHeight = Math.max(nNeurons, cellSize * nNeurons);

        const margins = { t: 20, r: 24, b: 120, l: 120 };
        const plotWidth = stripWidth + margins.l + margins.r;
        const plotHeight = stripHeight + margins.t + margins.b;
        const bodyStyles = window.getComputedStyle(document.body);
        const legendFontSize = this.getMainPlotLegendFontSize();
        const plotFont = {
            family: bodyStyles.fontFamily,
            size: Number.isFinite(legendFontSize) ? legendFontSize : 12,
            color: "#000000",
        };

        Plotly.react(
            matrixElement,
            [{
                type: "heatmap",
                x: xAxis,
                y: yAxis,
                z: zMatrix,
                customdata: customData,
                xgap: 1,
                ygap: 1,
                colorscale: PLOTLY_COLOR_SCALES.PiYG,
                showscale: false,
                zmid: 0,
                zmin: -1,
                zmax: 1,
                hoverongaps: false,
                hovertemplate: "<b>%{customdata[0]}</b><br>%{customdata[1]}<br>Pearson r: %{customdata[2]}<extra></extra>",
            }],
            {
                width: plotWidth,
                height: plotHeight,
                margin: margins,
                font: plotFont,
                xaxis: {
                    tickmode: "array",
                    tickvals: xAxis,
                    ticktext: behaviorLabels,
                    tickangle: -90,
                    range: [-0.5, nBehaviors - 0.5],
                    fixedrange: true,
                    scaleanchor: "y",
                    scaleratio: 1,
                    constrain: "domain",
                    tickfont: { size: plotFont.size },
                },
                yaxis: {
                    tickmode: "array",
                    tickvals: yAxis,
                    ticktext: neuronLabels,
                    range: [nNeurons - 0.5, -0.5],
                    fixedrange: true,
                    constrain: "domain",
                    tickfont: { size: plotFont.size },
                },
                template: "plotly_white",
            },
            {
                displayModeBar: false,
                responsive: true,
            }
        );

        if (typeof matrixElement.removeAllListeners === "function") {
            matrixElement.removeAllListeners("plotly_hover");
            matrixElement.removeAllListeners("plotly_unhover");
        }

        matrixElement.on("plotly_hover", (eventData) => {
            const point = eventData?.points?.[0];
            if (!point) return;
            const row = Number.parseInt(point.y, 10);
            const col = Number.parseInt(point.x, 10);
            const cellData = this.getCorBehaviorCellData(
                row,
                col,
                idxNeurons,
                behaviorCodes,
                neuronLabels,
                behaviorLabels,
                zMatrix
            );
            this.setCorBehaviorDetail(detailElement, { cellData, locked: false, warning: false });
        });

        matrixElement.on("plotly_unhover", () => {
            this.setCorBehaviorDetail(detailElement, { warning: false });
        });

        this.setCorBehaviorDetail(detailElement, { warning: false });
    }

    renderCorNeuron() {
        const matrixWrapElement = document.getElementById("cor_neuron_matrix_wrap");
        const matrixElement = document.getElementById("cor_neuron_matrix");
        const detailElement = document.getElementById("cor_neuron_detail");

        if (!matrixElement) return;

        const idxNeurons = this.getCorNeuronIndexList();
        const nNeurons = idxNeurons.length;

        if (nNeurons < 2) {
            Plotly.react(matrixElement, [], {
                height: 160,
                margin: { t: 8, r: 8, b: 8, l: 8 },
                xaxis: { visible: false, fixedrange: true },
                yaxis: { visible: false, fixedrange: true },
                annotations: [{
                    text: "2 or more neurons need to be selected.",
                    x: 0.5,
                    y: 0.5,
                    xref: "paper",
                    yref: "paper",
                    showarrow: false,
                    font: { size: 13 },
                }],
                template: "plotly_white",
            }, {
                displayModeBar: false,
                responsive: true,
            });
            this.setCorNeuronDetail(detailElement, {
                message: "<strong>Need more neurons:</strong> select at least 2 neurons to render the matrix.",
                warning: true,
            });
            return;
        }

        const labels = idxNeurons.map((idx) => this.getCorNeuronName(idx));
        const axis = Array.from({ length: nNeurons }, (_, idx) => idx);
        const zMatrix = Array.from({ length: nNeurons }, () => Array.from({ length: nNeurons }, () => null));
        const customData = Array.from({ length: nNeurons }, () => Array.from({ length: nNeurons }, () => null));

        for (let row = 0; row < nNeurons; row++) {
            for (let col = 0; col < nNeurons; col++) {
                zMatrix[row][col] = this.getNeuronCorrelation(idxNeurons[row], idxNeurons[col]);
                customData[row][col] = [labels[row], labels[col]];
            }
        }

        const wrapWidth = matrixWrapElement?.clientWidth || 480;
        const usableMatrixPixels = Math.max(96, Math.floor(wrapWidth - 24));
        const cellSize = Math.min(this.corNeuronMaxCellSize, Math.max(1, Math.floor(usableMatrixPixels / nNeurons)));
        const matrixSide = Math.max(nNeurons, cellSize * nNeurons);

        const margins = { t: 24, r: 24, b: 120, l: 120 };
        const plotWidth = matrixSide + margins.l + margins.r;
        const plotHeight = matrixSide + margins.t + margins.b;
        const bodyStyles = window.getComputedStyle(document.body);
        const legendFontSize = this.getMainPlotLegendFontSize();
        const plotFont = {
            family: bodyStyles.fontFamily,
            size: Number.isFinite(legendFontSize) ? legendFontSize : 12,
            color: "#000000",
        };

        Plotly.react(
            matrixElement,
            [{
                type: "heatmap",
                x: axis,
                y: axis,
                z: zMatrix,
                customdata: customData,
                xgap: 1,
                ygap: 1,
                colorscale: PLOTLY_COLOR_SCALES.PiYG,
                showscale: false,
                zmid: 0,
                zmin: -1,
                zmax: 1,
                hoverongaps: false,
                hovertemplate: "<b>%{customdata[0]}</b> vs <b>%{customdata[1]}</b><br>Pearson r: %{z:.3f}<extra></extra>",
            }],
            {
                width: plotWidth,
                height: plotHeight,
                margin: margins,
                font: plotFont,
                xaxis: {
                    tickmode: "array",
                    tickvals: axis,
                    ticktext: labels,
                    tickangle: -90,
                    range: [-0.5, nNeurons - 0.5],
                    fixedrange: true,
                    scaleanchor: "y",
                    scaleratio: 1,
                    constrain: "domain",
                    tickfont: { size: plotFont.size },
                },
                yaxis: {
                    tickmode: "array",
                    tickvals: axis,
                    ticktext: labels,
                    range: [nNeurons - 0.5, -0.5],
                    fixedrange: true,
                    constrain: "domain",
                    tickfont: { size: plotFont.size },
                },
                template: "plotly_white",
            },
            {
                displayModeBar: false,
                responsive: true,
            }
        );

        if (typeof matrixElement.removeAllListeners === "function") {
            matrixElement.removeAllListeners("plotly_hover");
            matrixElement.removeAllListeners("plotly_unhover");
        }

        matrixElement.on("plotly_hover", (eventData) => {
            const point = eventData?.points?.[0];
            if (!point) return;
            const row = Number.parseInt(point.y, 10);
            const col = Number.parseInt(point.x, 10);
            const pairData = this.getCorNeuronPairData(row, col, idxNeurons, labels, zMatrix);
            this.setCorNeuronDetail(detailElement, { pairData, locked: false, warning: false });
        });

        matrixElement.on("plotly_unhover", () => {
            this.setCorNeuronDetail(detailElement, { warning: false });
        });

        this.setCorNeuronDetail(detailElement, { warning: false });
    }

    renderCorOthers() {
        // get top 5 absolute correlated neurons for each plotted neurons
        const corOthersElement = document.getElementById("cor_others");
        if (!corOthersElement) return;
        let txtCorOthers = "";
        this.listIdxPlot.forEach((idxNeuron, iNeuron) => {
            const neuronName = this.data.neuron[idxNeuron].name
            const neuronColor = getCycleColor(iNeuron);
            const listCorPair = [];

            // Extract correlation values for each neuron
            Object.keys(this.data.cor.neuron).forEach(key => {
                const [neuron1, neuron2] = key.split(',').map(str => parseInt(str));
                if (neuron1 == idxNeuron || neuron2 == idxNeuron) {
                    const otherNeuron = neuron1 == idxNeuron ? neuron2 : neuron1;
                    const corValue = this.data.cor.neuron[key];
                    listCorPair.push({
                        idx_neuron_other: otherNeuron,
                        correlation: corValue,
                    });
                }
            });

            // Sort by descending absolute correlation values and take top 3
            listCorPair.sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation));
            const top5Pairs = listCorPair.slice(0, 3);

            // Generate HTML for top 5 correlated neurons
            let txtTop5 = ""
            top5Pairs.forEach((pair) => {
                const idxOtherInSelection = this.listIdxPlot.findIndex(
                    (idxSelected) => Number.parseInt(idxSelected, 10) === pair.idx_neuron_other
                );
                const colorOtherNeuron = idxOtherInSelection >= 0
                    ? getCycleColor(idxOtherInSelection)
                    : null;
                const styleColor = colorOtherNeuron ? `background-color:${colorOtherNeuron} !important` : '';
                txtTop5 += `<span class="badge me-1 ${colorOtherNeuron ? "text-bg-dark" : "text-bg-light"}" style="${styleColor}">${this.data.neuron[pair.idx_neuron_other].name}</span><span class="cor-value me-3">${pair.correlation.toFixed(3)}</span>`
            })
            // Combine into a section
            txtCorOthers += `
            <div class="others-section">
                <h6>Neurons for <span class="badge text-bg-dark" style="background-color:${neuronColor} !important">${neuronName}</span></h6>
                ${txtTop5}
            </div>
            ${this.listIdxPlot.length - 1 == iNeuron ? "" : "<hr>"}
            `;
        });

        corOthersElement.innerHTML = txtCorOthers;
    }
}
