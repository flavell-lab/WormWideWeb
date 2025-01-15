const colorMap = {
    // Original colors (C0-C9)
    'C0': '#1f77b4',  // Blue
    'C1': '#ff7f0e',  // Orange
    'C2': '#2ca02c',  // Green
    'C3': '#d62728',  // Red
    'C4': '#9467bd',  // Purple
    'C5': '#8c564b',  // Brown
    'C6': '#e377c2',  // Pink
    'C7': '#7f7f7f',  // Gray
    'C8': '#bcbd22',  // Olive
    'C9': '#17becf',  // Cyan
  
    // Additional colors (C10-C19)
    'C10': '#4c72b0',  // Deep Blue
    'C11': '#dd8452',  // Coral
    'C12': '#55a868',  // Sea Green
    'C13': '#c44e52',  // Indian Red
    'C14': '#8172b3',  // Blue Violet
    'C15': '#937860',  // Taupe
    'C16': '#da8bc3',  // Orchid
    'C17': '#8c8c8c',  // Dark Gray
    'C18': '#ccb974',  // Dark Khaki
    'C19': '#64b5cd',  // Sky Blue
  
    // Pastel variants (P0-P9)
    'P0': '#aec7e8',   // Pastel Blue
    'P1': '#ffbb78',   // Pastel Orange
    'P2': '#98df8a',   // Pastel Green
    'P3': '#ff9896',   // Pastel Red
    'P4': '#c5b0d5',   // Pastel Purple
    'P5': '#c49c94',   // Pastel Brown
    'P6': '#f7b6d2',   // Pastel Pink
    'P7': '#c7c7c7',   // Pastel Gray
    'P8': '#dbdb8d',   // Pastel Olive
    'P9': '#9edae5',   // Pastel Cyan
  
    // Dark variants (D0-D9)
    'D0': '#0f3c5c',   // Dark Blue
    'D1': '#b35607',   // Dark Orange
    'D2': '#1a501a',   // Dark Green
    'D3': '#8b1a1a',   // Dark Red
    'D4': '#543c70',   // Dark Purple
    'D5': '#5c3a31',   // Dark Brown
    'D6': '#a94c86',   // Dark Pink
    'D7': '#4c4c4c',   // Dark Gray
    'D8': '#7d7e16',   // Dark Olive
    'D9': '#0f7f8c',   // Dark Cyan
  
    // Bright variants (B0-B9)
    'B0': '#3c9dde',   // Bright Blue
    'B1': '#ffa040',   // Bright Orange
    'B2': '#40c040',   // Bright Green
    'B3': '#ff4040',   // Bright Red
    'B4': '#b080ff',   // Bright Purple
    'B5': '#bf7060',   // Bright Brown
    'B6': '#ff90d4',   // Bright Pink
    'B7': '#a0a0a0',   // Bright Gray
    'B8': '#e8e834',   // Bright Olive
    'B9': '#20e8ff'    // Bright Cyan
};
export default colorMap;  

/**
 * Returns a color from the colorMap based on the index, cycling through available colors
 * @param {number} i - The index to get a color for
 * @param {string[]} [prefixes=['C']] - Array of prefixes to use (e.g., ['C', 'P', 'D', 'B'])
 * @returns {string} A hex color code
 */
export function getCycleColor(i, prefixes = ['C']) {
    // Get all keys that start with any of the specified prefixes
    const availableColors = Object.keys(colorMap).filter(key => 
      prefixes.some(prefix => key.startsWith(prefix))
    );
  
    // Sort the keys numerically within each prefix group
    availableColors.sort((a, b) => {
      // Extract the prefix and number from each key
      const [aPrefix, aNum] = [a.charAt(0), parseInt(a.slice(1))];
      const [bPrefix, bNum] = [b.charAt(0), parseInt(b.slice(1))];
      
      // First sort by prefix
      if (aPrefix !== bPrefix) {
        return aPrefix.localeCompare(bPrefix);
      }
      // Then sort by number
      return aNum - bNum;
    });
  
    // Use modulo to cycle through the available colors
    const colorKey = availableColors[i % availableColors.length];
    return colorMap[colorKey];
};

export function removeIntFromList(list, number) {
    // Check if the target exists in the array
    if (!list.includes(number)) {
        console.warn(`Integer ${number} not found in the list.`);
        return false;
    }

    // Iterate backwards to safely remove elements while iterating
    for (let i = list.length - 1; i >= 0; i--) {
        if (list[i] === number) {
            list.splice(i, 1); // Remove the element at index i
        }
    }

    return true
}

export function getColorIdx(dictIdx, maxIter=200) {
    const values = Object.values(dictIdx);
    values.slice().sort((a, b) => a - b); 
    for (let i = 0; i < maxIter; i++) {
        if (!values.includes(i)) {
            return i
        }
    }

    return null
}

export function initPlot(plotElement, initHeight=800, responsive=false, staticPlot=false, displayModeBar=true) {
    // Set the plot layout
    const layout = {
        xaxis: {
            title: {
                text: "Time (min)"
            },
            color: "#000000"
        },
        yaxis: {
            title: {
                text: "Neuron GCaMP (z-scored)"
            },
            color: "#000000",
            autorange: true
        },
        yaxis2: {
            title: {
                text: "Behavior"
            },
            color: "#000000"
        },
        showlegend: true,
        height: initHeight,
        plot_bgcolor: "#FFF",
        paper_bgcolor: "#FFF",
        font: { color: "#000000" },
        grid: {
            ygap: 0.1,
            rows: 2,
            columns: 1,
            subplots: [["xy"], ["xy2"]]
        },
        shapes: [],
        margin: {
            t: 40,
            r: 50,
            b: 40,
            l: 50
        },
    };

    const config = {
        responsive: responsive,
        displaylogo: false,
        displayModeBar: displayModeBar,
        staticPlot: staticPlot,
        modeBarButtonsToRemove: ['toImage', 'select2d', 'lasso2d', 'autoScale2d', 'resetScale2d']
    };

    // Render the plot
    Plotly.newPlot(plotElement, [], layout, config);
}

export function plotData(plotElement, x, y, traceLabel, subplot, traceId, color=null) {
    const yaxis = 'y' + subplot;
    const trace = {
        x: x,
        y: y,
        type: 'line',
        mode: 'line',
        name: traceLabel,
        xaxis: 'x',
        yaxis: yaxis,
        id: traceId
    };

    if (color) {
        trace.line = {"color": color}
    }

    Plotly.addTraces(plotElement, [trace,]);
}

export function plotNeuron(plotElement, listT, data, label, traceId, color=null) {
    plotData(plotElement, listT, data, label, '', traceId, color)
}

export function plotBehavior(plotElement, listT, behavior, label, traceId, color=null) {
    plotData(plotElement, listT, behavior, label, '2', traceId, color)
}

export function findTrace(plot, traceId) {
    const plotData = plot.data
    for (var i=0; i < plotData.length; i++) {
        let traceId_ = plotData[i].id;
        if (traceId_ == traceId) {
            return i
        }
    }
    
    return -1 // -1 if not exists
}

/*
*   Events
*/
export function initEvent(plot, plotElementId, events, styleEvent, avgTimestep) {
    if (!plot.layout) {
        plot.layout = {};
    }

    if (!Array.isArray(plot.layout.shapes)) {
        plot.layout.shapes = [];
    }
    
    // Iterate over reversal events and add to shapes
    for (let eventKey in events) {
        let eventArray = events[eventKey]
        for (let i = 0; i < eventArray.length; i++) {
            let x_ = eventArray[i] * avgTimestep;

            let dict_ = {}
            dict_["type"] = "line"
            dict_["x0"] = x_
            dict_["y0"] = -10
            dict_["x1"] = x_
            dict_["y1"] = 10
            dict_["name"] = `event_${eventKey}_${i}`
            dict_["visible"] = true
            dict_["line"] =  {
                "color": styleEvent[eventKey]["color"],
                "width": styleEvent[eventKey]["width"]
            }

            // add to the plot shape
            plot.layout.shapes.push(dict_)
        }
    }    
    // Update the plot with the new shapes
    Plotly.react(plotElementId, plot.data, plot.layout);
}

export function toggleEvent(plotManager, isVisible) {
    if (!plotManager.plot.layout || !Array.isArray(plotManager.plot.layout.shapes)) return;

    const update = {};
    plotManager.plot.layout.shapes.forEach((shape, index) => {
        if (shape.name && shape.name.startsWith("event_")) {
            update[`shapes[${index}].visible`] = isVisible;
        }
    });

    Plotly.relayout(plotManager.plot, update)
        .then(() => {
            if (isVisible) {
                plotManager.resetYAxis();
            }
        })
        .catch(error => {
            console.error("Error toggling event:", error);
        });
}

/*
*   Reversals
*/
export function initReversal(plot, plotElementId, reversals, colorReversal, avgTimestep) {
    if (!plot.layout) {
        plot.layout = {};
    }

    if (!Array.isArray(plot.layout.shapes)) {
        plot.layout.shapes = [];
    }

    // Iterate over reversal events and add to shapes
    reversals.forEach((reversal, index) => {
        const [i_s, i_e] = reversal;
        const t_s = (i_s - 1) * avgTimestep;
        const t_e = (i_e - 1) * avgTimestep;

        const shape = {
            type: "rect",
            x0: t_s,
            y0: -10,
            x1: t_e,
            y1: 10,
            name: `rev_${index}`,
            visible: true,
            line: {
                color: colorReversal,
                width: 0
            },
            fillcolor: colorReversal
        };

        plot.layout.shapes.push(shape);
    });

    // Update the plot with the new shapes
    Plotly.react(plotElementId, plot.data, plot.layout);
}

export function toggleReversal(plotManager, isVisible) {
    if (!plotManager.plot.layout || !Array.isArray(plotManager.plot.layout.shapes)) return;

    const update = {};
    plotManager.plot.layout.shapes.forEach((shape, index) => {
        if (shape.name && shape.name.startsWith("rev_")) {
            update[`shapes[${index}].visible`] = isVisible;
        }
    });

    Plotly.relayout(plotManager.plot, update)
        .then(() => {
            if (isVisible) {
                plotManager.resetYAxis();
            }
        })
        .catch(error => {
            console.error("Error toggling reversals:", error);
        });
}

export function adjustWidth(containerId, plotId, targetWidth = null) {
    const containerWidth = document.getElementById(containerId).offsetWidth;
    const newWidth = targetWidth || containerWidth * 0.925;
    Plotly.relayout(plotId, { width: newWidth });
}
