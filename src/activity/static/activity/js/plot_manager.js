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

const behaviorDescriptions = {
    v: "Velocity",
    hc: "Head Curvature",
    f: "Pumping",
    av: "Angular Velocity"
    // bc: "Body Curvature",
};

/**
 * Class representing a Neuron and Behavior Plot Manager.
 */
export class NeuronBehaviorPlot {
    constructor(plotElementId, data) {
        this.plotElementId = plotElementId;
        this.plot = document.getElementById(plotElementId);
        if (!this.plot) {
            throw new Error(`Element with ID "${plotElementId}" not found.`);
        }

        this.data = data;
        console.log(data)
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
        this.styleEvent = {
            "heat": {
                "color": 'rgba(255,0,0,1)',
                "width": 2
            }
        };

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

                initEvent(this.plot, this.plotElementId, this.events, this.styleEvent, this.avgTimestep)
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

            this.data["behavior"] = remoteBehavior["behavior"];

            // Then proceed just as before
            const behavior = this.data["behavior"];
            if (!behavior) {
                console.warn('Behavior data is missing.');
                return;
            }

            const velocityRaw = behavior["velocity"] || [];
            const velocity = velocityRaw.map(x => x * 10);
            const headCurvature = behavior["head_curvature"] || [];
            const pumping = behavior["pumping"] || [];
            const angularVelocity = behavior["angular_velocity"] || [];
            // const bodyCurvature = behavior["body_curvature"] || [];

            // store it internally
            this.behavior = {
                "v": { i: 0, data: velocity },
                "hc": { i: 1, data: headCurvature },
                "f": { i: 2, data: pumping },
                "av": { i: 3, data: angularVelocity },
                // "bc": { i: 4, data: bodyCurvature }
            };

            // Reversals
            this.reversals = behavior["reversal_events"] || [];
            this.events = behavior["events"] || {};

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
     * Updates the URL with the current list of plotted neurons
     */
    updateURLNeuron(listIdxPlotStr) {
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
        this.renderCorNeuron();
        this.renderCorBehavior();
        this.renderCorOthers();
    }

    renderCorBehavior() {
        let txtBehaviorSections = "";
        const corBehaviorElement = document.getElementById("cor_behavior");
        const behaviors = Object.keys(behaviorDescriptions);
        const nBehaviors = behaviors.length;

        behaviors.forEach((behaviorCode, indexBehavior) => {
            const behaviorName = behaviorDescriptions[behaviorCode];
            const behaviorPairs = [];

            // Extract correlation values for each plotted neuron
            this.listIdxPlot.forEach((idxNeuron, iNeuron) => {
                if (data.cor.behavior[idxNeuron] && typeof data.cor.behavior[idxNeuron][behaviorCode] === 'number') {
                    const corValue = data.cor.behavior[idxNeuron][behaviorCode];
                    const neuronName = data.neuron[idxNeuron] ? data.neuron[idxNeuron].name : `Neuron ${idxNeuron}`;

                    behaviorPairs.push({
                        name: neuronName,
                        correlation: corValue,
                        color: getCycleColor(iNeuron)
                    });
                }
            });

            // Sort by descending absolute correlation values
            behaviorPairs.sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation));

            // Split into two columns
            const totalLength = behaviorPairs.length;

            // Calculate indices for dividing into three parts
            const firstSplitIndex = Math.ceil(totalLength / 3);
            const secondSplitIndex = Math.ceil((2 * totalLength) / 3);

            // Divide the array into three distinct columns
            const behaviorColumn1 = behaviorPairs.slice(0, firstSplitIndex);
            const behaviorColumn2 = behaviorPairs.slice(firstSplitIndex, secondSplitIndex);
            const behaviorColumn3 = behaviorPairs.slice(secondSplitIndex);

            // Function to generate HTML for a behavior column
            const generateBehaviorColumnHTML = (pairs) => {
                return pairs.map(pair => `
                    <div class="mb-2">
                        <span class="badge text-bg-dark" style="background-color: ${pair.color} !important">${pair.name}</span>
                        <span class="cor-value">${pair.correlation.toFixed(3)}</span>
                    </div>
                `).join('');
            };

            // Generate HTML for behavioral columns
            const txtBehaviorColumn1 = generateBehaviorColumnHTML(behaviorColumn1);
            const txtBehaviorColumn2 = generateBehaviorColumnHTML(behaviorColumn2);
            const txtBehaviorColumn3 = generateBehaviorColumnHTML(behaviorColumn3);

            // Combine behavioral columns into a Bootstrap row with a header
            txtBehaviorSections += `
                <div class="behavior-section">
                    <h6>${behaviorName}</h6>
                    <div class="row">
                        <div class="col-md-4">
                            ${txtBehaviorColumn1}
                        </div>
                        <div class="col-md-4">
                            ${txtBehaviorColumn2}
                        </div>
                        <div class="col-md-4">
                            ${txtBehaviorColumn3}
                        </div>
                    </div>
                </div>
                ${nBehaviors - 1 === indexBehavior ? "" : "<hr>"}
            `;
        });

        corBehaviorElement.innerHTML = txtBehaviorSections;

    }

    renderCorNeuron() {
        const corNeuronElement = document.getElementById("cor_neuron");

        // Initialize HTML content for both columns
        let txtNeuralColumn1 = "";
        let txtNeuralColumn2 = "";

        // Check if there are at least two neurons selected
        if (this.listIdxPlot.length > 1) {
            const correlationPairs = [];

            // Iterate through the list of neuron indices to extract unique pairs
            for (let i = 0; i < this.listIdxPlot.length; i++) {
                for (let j = 0; j < i; j++) { // j < i ensures unique pairs and skips self-correlation
                    const idxNeuron1 = this.listIdxPlot[j];
                    const idxNeuron2 = this.listIdxPlot[i];
                    const corNeuralKey = `${idxNeuron1},${idxNeuron2}`;
                    let cor_;

                    // Attempt to retrieve the correlation using the original key
                    if (corNeuralKey in this.data.cor.neuron) {
                        cor_ = this.data.cor.neuron[corNeuralKey];
                    } else {
                        // If not found, try the reversed key
                        const reverseKey = `${idxNeuron2},${idxNeuron1}`;
                        cor_ = this.data.cor.neuron[reverseKey] !== undefined ? this.data.cor.neuron[reverseKey] : null;
                    }

                    // Proceed only if a valid correlation coefficient is found
                    if (cor_ !== null && !isNaN(cor_)) {
                        const neuron1 = this.data.neuron[idxNeuron1];
                        const neuron2 = this.data.neuron[idxNeuron2];

                        // Ensure that both neuron objects exist
                        if (neuron1 && neuron2) {
                            correlationPairs.push({
                                name1: neuron1.name,
                                name2: neuron2.name,
                                color1: getCycleColor(j),
                                color2: getCycleColor(i),
                                correlation: cor_ // Keep the original precision for accurate sorting
                            });
                        }
                    }
                }
            }

            // Check if any valid correlation pairs were found
            if (correlationPairs.length > 0) {
                // Sort the correlation pairs by descending order of absolute correlation values
                correlationPairs.sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation));

                // Split the sorted correlation pairs into two roughly equal halves for two columns
                const midIndex = Math.ceil(correlationPairs.length / 2);
                const column1 = correlationPairs.slice(0, midIndex);
                const column2 = correlationPairs.slice(midIndex);

                // Function to generate HTML for a column
                const generateColumnHTML = (pairs) => {
                    return pairs.map(pair => `
                <div class="mb-2">
                    <span class="badge text-bg-dark" style="background-color:${pair.color1} !important">${pair.name1}</span>,
                    <span class="badge text-bg-dark" style="background-color:${pair.color2} !important">${pair.name2}</span>
                    <span class="cor-value">${pair.correlation.toFixed(3)}</span>
                </div>
            `).join('');
                };

                // Generate HTML for both columns
                txtNeuralColumn1 = generateColumnHTML(column1);
                txtNeuralColumn2 = generateColumnHTML(column2);
            } else {
                // No valid correlation pairs found
                txtNeuralColumn1 = `<div class="alert alert-warning" role="alert">
                                No valid correlation pairs found.
                             </div>`;
                txtNeuralColumn2 = "";
            }
        } else {
            // Fewer than two neurons selected
            corNeuronElement.innerHTML = `<div class="alert alert-warning" role="alert">
                            2 or more neurons need to be selected.
                         </div>`;
            return;
        }

        // Combine the two columns within a Bootstrap row
        const combinedHTML = `
            <div class="row">
                <div class="col-lg-6">
                    ${txtNeuralColumn1}
                </div>
                <div class="col-lg-6">
                    ${txtNeuralColumn2}
                </div>
            </div>`;

        // Inject the combined HTML into the target element
        corNeuronElement.innerHTML = combinedHTML;
    }

    renderCorOthers() {
        // get top 5 absolute correlated neurons for each plotted neurons
        const corOthersElement = document.getElementById("cor_others");
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
                const idxOtherStr = `${pair.idx_neuron_other}`;
                const colorOtherNeuron = getCycleColor(this.listIdxPlot.indexOf(idxOtherStr))
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
