import { isNodeRectangle, initDropdown, getLocalStr, setLocalStr, parseRGB, calculateLuminance } from '/static/core/js/utility.js';
import { ConnectomeLegend } from './connectome_legend.js';

/**
 * Manages the nodes in a connectome graph, including their colors, labels, and outlines.
 * 
 * @class
 * @param {Object} graphParent - The parent object containing the Cytoscape graph instance.
 * @param {string} [defaultColor="nt"] - The default color scheme for the nodes.
 * @param {string} [localKeyPrefix=null] - The prefix for the local storage key used to save the color scheme.
 * @param {Array} [availableNeurons=null] - An array of available neuron IDs, for NeuroPAL GCaMP dataset.
 * @param {string} [dropdownIdColor="dropdownColor"] - The ID of the dropdown element for selecting the color scheme.
 * @param {string} [containerId="node-position-list"] - The ID of the container element for the node position list.
 * @param {string} [buttonId="updateCustomColor"] - The ID of the button element for updating custom colors.
 * @param {string} [otherButtonId="updateCustomLayout"] - The ID of the other button element for updating the custom layout.
 */
export class NodeManager {
    constructor(graphParent, defaultColor="nt", localKeyPrefix=null, availableNeurons=null, dropdownIdColor="dropdownColor", containerId="node-position-list", buttonId="updateCustomColor", otherButtonId="updateCustomLayout") {
        this.availableNeurons = availableNeurons
        this.colorScheme = [
            'rgb(221,221,221)', // 0 Light Gray
            'rgb(46,37,133)',   // 1 Dark Blue
            'rgb(51,117,56)',   // 2 Green
            'rgb(93,168,153)',  // 3 Teal
            'rgb(148,203,236)', // 4 Light Blue
            'rgb(220,205,125)', // 5 Yellow
            'rgb(194,106,119)', // 6 Red
            'rgb(159,74,150)',  // 7 Purple
            'rgb(126,41,84)'    // 8 Dark Maroon
        ];
        this.localKey = `${localKeyPrefix ? localKeyPrefix + "_" : ""}connectome_colorset`;
        this.colorsetUI = getLocalStr(this.localKey, defaultColor);
        this.graph = graphParent.graph; // Cytoscape graph instance
        this.graphParent = graphParent;

        this.connectomeLegend = new ConnectomeLegend(this.graph);
        this.updateLegend();

        this.containerId = containerId;
        this.buttonId = buttonId;
        this.otherButtonId = otherButtonId;

        this.changeColorUI = (colorsetUI) => {
            if (colorsetUI === "custom") {
                this.renderNodeColorInput();
            } else {
                this.colorsetUI = colorsetUI;
                setLocalStr(this.localKey, colorsetUI);
                this.updateLegend();
                this.updateNodeColorSet();
            }
        };

        initDropdown(dropdownIdColor, this.changeColorUI, false, this.colorsetUI);
        this.initUpdateButton();
    }

    updateLegend() {
        const legendData = this.connectomeLegend.getLegendData(this.colorsetUI);
        this.connectomeLegend.renderLegend(legendData);
    }

    updateNodeColorSet() {
        const [colorPie, colorBackground] = this.getNodeColorSet(this.colorsetUI);
        this.setNodePieChartColors(colorPie);
        this.setNodeColors(colorBackground);
        this.adjustNodeLabelColor(colorPie, colorBackground);
    }

    getColorDataset(type, cellType) {
        const colorDict = {
            'plot': [this.colorScheme[4]],
            'available': [this.colorScheme[5]],
            'notavailable': [this.colorScheme[0]],
        };

        if (["u","b"].includes(cellType)) { // unknown, not piechart
            return [false, colorDict[type][0]]
        } else {
            return [true, colorDict[type]]
        }
    }

    getColorCellType(type) {
        const colorDict = {
            'u': "rgb(210,210,210)",
            'b': "rgb(75,75,75)",
            's': this.colorScheme[2],
            'i': this.colorScheme[4],
            'm': this.colorScheme[8],
            'n': this.colorScheme[5]
        };

        if (["u","b"].includes(type)) { // unknown, not piechart
            return [false, colorDict[type]]
        } else {
            return [true, type.split('').map((x) => colorDict[x])]
        }
    }

    getColorNeuroTransmitterType(nt) {
        const colorDict = {
            'a': this.colorScheme[5],
            'g': this.colorScheme[1],
            'l': this.colorScheme[2],
            'd': this.colorScheme[4],
            'o': this.colorScheme[3],
            's': this.colorScheme[7],
            't': this.colorScheme[8],
            'u': "rgb(210,210,210)",
            'n': "rgb(75,75,75)"
        };

        if (["n"].includes(nt)) { // unknown or non-neuronal, not piechart
            return [false, colorDict[nt]]
        } else {
            return [true, nt.split('').map((x) => colorDict[x])]
        }
    }

    getNodeColorSet(colorsetUI) {
        const colorPie = {};
        const colorBackground = {};
        this.graph.nodes().forEach((node) => {
            const neuronData = node.data();
            const cellType = neuronData.cell_type;
            const nt = neuronData.neurotransmitter_type;

            let available = null
            if (colorsetUI == "gcamp") {
                available = (neuronData.id in this.graphParent.manifest) ? "plot"
                    : this.availableNeurons.includes(neuronData.id) ? "available"
                    : "notavailable"
            }

            const [isPie, colors] = (colorsetUI == "type") ? this.getColorCellType(cellType)
                : (colorsetUI == "nt") ? this.getColorNeuroTransmitterType(nt)
                : (colorsetUI == "gcamp") ? this.getColorDataset(available, cellType)
                : [null, null];

            if (isPie) {
                colorPie[neuronData.id] = colors
            } else {
                colorBackground[neuronData.id] = colors
            }
        });

        return [colorPie, colorBackground];
    }

    setNodeColors(colorDict) {
        Object.entries(colorDict).forEach(([nodeId, rgbStr]) => {
            const node = this.graph.getElementById(nodeId);
            if (node) {
                node.style('background-color', rgbStr);
            } else {
                console.warn(`Node with ID '${nodeId}' not found.`);
            }
        });
    }

    setNodePieChartColors(nodeColors) {
        Object.entries(nodeColors).forEach(([nodeId, colors]) => {
            const node = this.graph.getElementById(nodeId);
            if (!node) {
                console.warn(`Node with ID '${nodeId}' not found.`);
                return;
            }

            const styleProps = {};
            const slicePercentage = 1 / colors.length;
            colors.forEach((color, index) => {
                styleProps[`pie-${index + 1}-background-color`] = color;
                styleProps[`pie-${index + 1}-background-size`] = `${slicePercentage * 100}%`;
            });

            node.style(styleProps);
        });
    }

    adjustNodeLabelWrap() {
        this.graph.nodes().forEach((node) => {
            const currentLabel = node.data('id');
            if (currentLabel.length > 3) {
                const newLabel = currentLabel.slice(0,3) + '\n' + currentLabel.slice(3,);
                node.style('label', newLabel);
            }
        })
    }

    adjustNodeLabelColorPie(colorPie) {
        Object.entries(colorPie).forEach(([nodeId, colors]) => {
            const node = this.graph.getElementById(nodeId);
    
            if (!node) {
                console.warn(`Node with ID '${nodeId}' not found.`);
                return;
            }

            const minLuminance = Math.min.apply(null, colors.map(x => {
                const color_ = parseRGB(x)
                return calculateLuminance(color_.r, color_.g, color_.b)
            }))

            const labelColor = minLuminance < 0.25 ? '#FFFFFF' : '#000000'; // White for dark backgrounds, black for light
            node.style('color', labelColor); // Update label color    
        });
    }

    adjustNodeLabelColorBackground(colorBackground) {
        Object.entries(colorBackground).forEach(([nodeId, colors]) => {
            const node = this.graph.getElementById(nodeId);
    
            if (!node) {
                console.warn(`Node with ID '${nodeId}' not found.`);
                return;
            }

            const color_ = parseRGB(colors)
            const luminance = calculateLuminance(color_.r, color_.g, color_.b)

            const labelColor = luminance < 0.25 ? '#FFFFFF' : '#000000'; // White for dark backgrounds, black for light
            node.style('color', labelColor); // Update label color    
        });
    }

    adjustNodeLabelColor(colorPie, colorBackground) {
        this.adjustNodeLabelColorPie(colorPie);
        this.adjustNodeLabelColorBackground(colorBackground);
    }

    renderNodeColorInput() {
        const customExplanation = document.getElementById("customExplanation");
        customExplanation.innerHTML = "<b>Enter neuron color in CSV format</b><br>neuron,r,g,b<br>RGB values: [0,255]";
        const updateButton = document.getElementById(this.buttonId);
        const otherButton = document.getElementById(this.otherButtonId);

        updateButton.style.display = "block";
        otherButton.style.display = "none";

        const container = document.getElementById(this.containerId);
        if (!container) {
            console.error(`Container with ID '${this.containerId}' not found.`);
            return;
        }

        container.innerHTML = ""; // Clear previous content

        const textArea = document.createElement('textarea');
        textArea.id = 'node-position-input';
        textArea.className = 'form-control';
        textArea.rows = 10;
        textArea.placeholder = `Enter neuron colors in CSV format:\nneuron1,r,g,b\nneuron2,r,g,b\nRGB values: [0,255]`;

        container.appendChild(textArea);
        
        const currentColors = this.graph.nodes(':visible').map((node) => {
            const { id } = node.data();
            const pieColors = [];
            for (let i = 1; i <= 9; i++) {
                const pieColor = node.style(`pie-${i}-background-color`);
                if (pieColor) {
                    pieColors.push(parseRGB(pieColor));
                } else {
                    break;
                }
            }

            let r, g, b;
            if (pieColors.length > 0) {
                const largestPieColor = pieColors[0]; // Assuming the largest pie is the first one
                r = largestPieColor.r;
                g = largestPieColor.g;
                b = largestPieColor.b;
            } else {
                ({ r, g, b } = parseRGB(node.style('background-color')));
            }

            return `${id},${r},${g},${b}`;
        }).join('\n');
        textArea.value = currentColors;

        const alertContainer = document.createElement('div');
        alertContainer.id = 'alert-container';
        alertContainer.className = 'mt-3';
        container.appendChild(alertContainer);
    }

    applyNodeColorsCustom() {
        const textArea = document.getElementById('node-position-input');
        if (!textArea) {
            console.error('Text area for node positions not found.');
            return;
        }

        const inputText = textArea.value.trim();
        const errors = [];

        const colorPie = {};
        const colorBackground = {};

        inputText.split('\n').forEach((line, index) => {
            const [id, r, g, b] = line.split(',').map(s => s.trim());
            const rgbStr = `rgb(${r},${g},${b})`;

            if (!this.graph.getElementById(id)) {
                errors.push(`Line ${index + 1}: Node '${id}' not found.`);
            } else {
                const node = this.graph.getElementById(id);
                const cellType = node.data("cell_type");
                if (["u", "b"].includes(cellType)) {
                    colorBackground[id] = rgbStr;
                } else {
                    colorPie[id] = [rgbStr];
                }
            }
        });

        if (errors.length > 0) {
            this.showErrorAlert(errors);
            return;
        }

        this.setNodePieChartColors(colorPie);
        this.setNodeColors(colorBackground);
        this.adjustNodeLabelColor(colorPie, colorBackground)
    }

    /**
     * Apply outlines to a set of nodes in Cytoscape.
     * @param {Array} nodeIds - Array of node IDs to apply the outline.
     * @param {string} borderWidth - The width of the border (e.g., '4px').
     * @param {string} borderColor - The color of the border (e.g., 'red').
     */
    highlightNode(nodeIds, borderWidth=4, borderColor="red", size=45) {
        nodeIds.forEach(nodeId => {
            const node = this.graph.getElementById(nodeId);
            if (node) {
                node.style({
                    'border-width': (node) =>{
                        return isNodeRectangle(node) ? `${borderWidth-2}px` : `${borderWidth}`
                    },
                    'font-size': '15px',
                    'border-color': borderColor,
                    'border-style': 'solid',
                    'height': size,
                    'width': (node) => {
                        return isNodeRectangle(node) ? size * 2 : size
                    }
                });
            } else {
                console.warn(`Node with ID '${nodeId}' not found.`);
            }
        });
    }

    addNodeOutline(nodeIds, borderWidth=4, borderColor="red") {
        nodeIds.forEach(nodeId => {
            const node = this.graph.getElementById(nodeId);
            if (node) {
                node.style({
                    'border-width': (node) =>{
                        return isNodeRectangle(node) ? `${borderWidth-2}px` : `${borderWidth}`
                    },
                    'border-color': borderColor,
                    'border-style': 'solid',
                });
            } else {
                console.warn(`Node with ID '${nodeId}' not found.`);
            }
        });
    }

    /**
     * Remove all borders from nodes in Cytoscape.
     */
    removeAllNodeOutline() {
        this.graph.nodes().forEach(node => {
            // Read the current style values
            const currentBorderWidth = node.style('border-width');
            const currentBorderColor = node.style('border-color');
          
            // Check if those style properties are actually defined
            if (currentBorderWidth !== undefined && currentBorderColor !== undefined) {
              node.style({
                'border-width': '0px',
                'border-color': 'transparent'
              });
            }
        });          
    }

    initUpdateButton() {
        const updateButton = document.getElementById(this.buttonId);
        if (!updateButton) {
            console.error(`Button with ID '${this.buttonId}' not found.`);
            return;
        }

        updateButton.addEventListener('click', () => {
            this.connectomeLegend.legendContainer.style.display = "none";
            this.applyNodeColorsCustom();
        });
    }
}