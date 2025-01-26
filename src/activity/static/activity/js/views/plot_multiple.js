import {
    getCycleColor,
    initPlot,
    plotNeuron as plotNeuronFunction,
    plotBehavior as plotBehaviorFunction,
    initEvent
} from '../plot_data.js';

const styleEvent = {
    "heat": {
        "color": 'rgba(255,0,0,1)',
        "width": 2
    }
}

/**
 * Utility to hide multiple traces at once in a Plotly plot.
 * @param {HTMLElement} plotElement - The Plotly div element.
 * @param {number[]} traceIndices - Array of valid trace indices to hide.
 */
function hideTraces(plotElement, traceIndices) {
    // Filter out any invalid indices (e.g., null, -1)
    const validIndices = traceIndices.filter(idx => typeof idx === 'number' && idx >= 0);
    if (validIndices.length > 0) {
        Plotly.restyle(plotElement, { visible: 'legendonly' }, validIndices);
    }
}

/**
 * Find a Plotly trace index by an 'id' property in the data array.
 * @param {HTMLElement} plotElement - The Plotly div element.
 * @param {string} traceId - The trace ID/name to look for.
 * @returns {number|undefined} - The trace index or undefined if not found.
 */
function getTraceIndex(plotElement, traceId) {
    if (!plotElement?.data) return undefined;
    const traceIndex = plotElement.data.findIndex(trace => trace.id === traceId);
    if (traceIndex === -1) {
        console.error('Trace not found:', traceId);
        return undefined;
    }
    return traceIndex;
}

/**
 * Update the progress bar width (0-100%).
 * @param {HTMLElement} progressBar - The progress bar element.
 * @param {number} value - A number in [0, 100].
 */
function updateProgressBar(progressBar, value) {
    // Clamp value to [0, 100]
    const clampedValue = Math.max(0, Math.min(100, value));
    progressBar.style.width = `${clampedValue}%`;
    progressBar.setAttribute('aria-valuenow', clampedValue);
}

async function fetchBehavior(url) {
    try {
        const response = await fetch(url);
        
        // Check if the response status is OK (status code 200-299)
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status} ${response.statusText}`);
        }
        
        // Parse the response body as JSON
        const fetchedData = await response.json();

        return [fetchedData.data.behavior, fetchedData.data.events];
    } catch (error) {
      // Re-throw the error to be handled by the caller
      throw new Error(`Failed to fetch JSON data: ${error.message}`);
    }
}  

//---------------------------------------------------------------------
// MAIN LOGIC
//---------------------------------------------------------------------
const neuronColorIdxMap = data?.colors || {};

document.addEventListener('DOMContentLoaded', async () => {
    const progressBar = document.getElementById('plotProgressBar');
    if (!progressBar) {
        console.warn('Progress bar element not found.');
        return;
    }

    try {
        const progressContainer = document.getElementById('progressContainer');
        const nPlots = data?.data?.length || 0;

        if (!nPlots) {
            console.warn('No plots to generate (data.data is empty).');
            if (progressContainer) progressContainer.classList.add('d-none');;
            return;
        }

        // 1. Initialize all plots (empty) first
        for (let i = 0; i < nPlots; i++) {
            const plotElement = document.getElementById(`plot_${i}`);
            initPlot(plotElement, 400, false);
        }

        // 2. Plot data asynchronously, so the UI can update after each iteration
        for (let i = 0; i < nPlots; i++) {
            const plotElement = document.getElementById(`plot_${i}`);
            const dataset = data.data[i];
            if (!plotElement || !dataset) {
                console.warn(`Missing plotElement or dataset for index ${i}`);
                continue;
            }

            // 2A. Build time axis
            const avgTimestep = dataset.avg_timestep ?? 0;
            const listIdxT = Array.from({ length: dataset.max_t }, (_, idx) => idx);
            const listTMinute = listIdxT.map(n => n * avgTimestep);

            // 2B. Plot neurons
            const traceData = dataset.trace_data || [];
            const neuronIndices = [];
            for (let j = 0; j < traceData.length; j++) {
                const trace = traceData[j];
                const color = getCycleColor(neuronColorIdxMap[trace.name] ?? j);

                neuronIndices.push(trace.idx_neuron);
                plotNeuronFunction(
                    plotElement,
                    listTMinute,
                    trace.trace,
                    `${trace.idx_neuron} (${trace.name})`,
                    `n_${j}`, // trace ID
                    color
                );
            }

            // 2C. Plot behaviors
            const behaviorURL = `/activity/api/data/${dataset.dataset_id}/behavior/`
            const [behaviorData, events] = await fetchBehavior(behaviorURL);
            
            const nonVelocityTraceIndices = [];
            Object.keys(behaviorData.traces).forEach((key, idx) => {
                const b = behaviorData.traces[key];
                const color = getCycleColor(b.i);
                plotBehaviorFunction(
                    plotElement,
                    listTMinute,
                    b.data,
                    `${b.name} (${b.unit})`,
                    `b_${b.name_short}`,
                    color
                );

                // Hide all behavior traces except velocity
                if (b.name_short !== 'v') {
                    const foundIdx = getTraceIndex(plotElement, `b_${b.name_short}`);
                    if (typeof foundIdx === 'number') {
                        nonVelocityTraceIndices.push(foundIdx);
                    }
                }
            })
            hideTraces(plotElement, nonVelocityTraceIndices);

            // events
            initEvent(plotElement, `plot_${i}`, events, styleEvent, avgTimestep)

            // 2D. Set up "Explore" button link
            const buttonExplore = document.getElementById(`button_${i}`);
            if (buttonExplore) {
                buttonExplore.href = `/activity/explore/${dataset.dataset_id}/?n=${neuronIndices.join('-')}&b=v`;
            }

            // 2E. Update progress bar
            updateProgressBar(progressBar, ((i + 1) / nPlots) * 100);

            // Let the browser render before proceeding (for visible progress)
            await new Promise(res => setTimeout(res, 10));
        }

        // 3. Hide progress container upon completion
        if (progressContainer) {
            progressContainer.classList.add('d-none');
        }

    } catch (err) {
        console.error('Error generating plots:', err);
    }
});  