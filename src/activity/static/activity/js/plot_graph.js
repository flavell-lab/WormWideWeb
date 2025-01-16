import { getNeuronClassProperty } from './plot_dataset_selector.js'
import { NodeManager } from '/static/connectome/js/connectome_node.js'
import { GraphLayoutManager, NodePositionManager } from '/static/connectome/js/connectome_layout.js'
import { sumArray, isNodeRectangle, initSwitch, debounce, getCSRFToken, initSlider, setLocalInt, getLocalInt, getLocalBool } from '/static/core/js/utility.js'
import { InfoPanel } from '/static/core/js/info_panel.js'

const edgeRequestURL = "/connectome/api/get-edges/"

export class PlotGraph {
    constructor(graphId, data) {
        this.element = document.getElementById(graphId);
        
        this.corNeuron = data.cor.neuron // neuron-pair correlation

        this.neuronToIdxNeuron = {}
        this.availableNeurons = []
        const datasetNeuronData = data.neuron
        Object.keys(datasetNeuronData).forEach(idx_neuron => {
            const label = datasetNeuronData[idx_neuron].label
            if (label != "") {
                this.neuronToIdxNeuron[label] = parseInt(idx_neuron)
                if (!label.includes("?")) this.availableNeurons.push(label)
            }
        })

        this.initGraph();

        // manifest to plot
        this.manifest = {};

        // dataset
        this.listDataset = [];
        this.datsetNameFormatted = {
            "white_1986_jse": "White 1986 JSE",
            "white_1986_jsh": "White 1986 JSH",
            "white_1986_n2u": "White 1986 N2U",
            "white_1986_whole": "White 1986 Whole",
            "witvliet_2020_1": "Witvliet 2020 1",
            "witvliet_2020_2": "Witvliet 2020 2",
            "witvliet_2020_3": "Witvliet 2020 3",
            "witvliet_2020_4": "Witvliet 2020 4",
            "witvliet_2020_5": "Witvliet 2020 5",
            "witvliet_2020_6": "Witvliet 2020 6",
            "witvliet_2020_7": "Witvliet 2020 7",
            "witvliet_2020_8": "Witvliet 2020 8",
        };

        // download
        this.jsonData = null;

        // info panel
        this.infoPanel = new InfoPanel();

        // node
        this.nodeManager = new NodeManager(this, "gcamp", "activity", this.availableNeurons)

        // layout
        this.nodePositiobManager = new NodePositionManager(this.graph, "node-position-list", "updateCustomLayout", "updateCustomColor");
        this.nodePositiobManager.init();
        this.layoutManager = new GraphLayoutManager(this.graph, "activity", "dropdownLayout", this.nodePositiobManager, "concentric");
        this.edgeWidthScalingFactor = 1.5
        this.initLayoutSlider();

        // set up edge count threshold
        this.thresholdE = getLocalInt("activity_connectome_threshold_e", 1);
        this.thresholdC = getLocalInt("activity_connectome_threshold_c", 1);
        this.initEdgeCountFilter();

        // set up switches
        // this.switchShowIndividual = {value: getLocalBool("connectome_show_individual_neuron", false)}
        this.switchShowConnected = {value: getLocalBool("activity_connectome_show_connected_neuron", true)}
        // initSwitch("switchIndividual",
        //     () => this.debouncedUpdateGraph(),
        //     () => this.debouncedUpdateGraph(),
        //     this.switchShowIndividual, "connectome_show_individual_neuron",
        //     this.switchShowIndividual.value);    

        initSwitch("switchConnected",
            () => this.debouncedUpdateGraph(),
            () => this.debouncedUpdateGraph(),
            this.switchShowConnected, "activity_connectome_show_connected_neuron",
            this.switchShowConnected.value);

        // highlight style when a node or an edge is selected
        this.initSelection()

        // update graph function
        this.element.updateGraph = this.debouncedUpdateGraph;
    }

    initGraph() {
        this.graph = cytoscape({
            container: this.element,
            elements: [],
            style: [
                this.getStyleNode(),
                this.getStyleEdge(),
                this.getStyleEdgeElectrical()
            ],
            zoomingEnabled: true,
            minZoom: 0.1,
            maxZoom: 3.0,
        });
    }

    /*
        Select
    */
        initSelection() {
            //
            // node
            //
            this.graph.on('select', 'node', (event) => {
                const selectedNode = event.target; // The selected node
                const connectedEdges = selectedNode.connectedEdges(); // Get edges connected to the selected node
                const connectedNodes = connectedEdges.connectedNodes(); // Get nodes connected via these edges
            
                // Reduce opacity and z-index of all elements
                this.graph.elements().style({
                    'opacity': 0.1,
                    'z-index': 1,
                });
            
                // Highlight the selected node, connected nodes, and connected edges
                selectedNode.style({
                    'opacity': 1,
                    'z-index': 10, // Bring selected node forward
                });
                connectedEdges.style({
                    'opacity': 1,
                    'z-index': 5, // Bring connected edges forward
                });
                connectedNodes.style({
                    'opacity': 1,
                    'z-index': 5, // Bring connected nodes forward
                });
            });
            
            // Reset styles on unselect
            this.graph.on('unselect', 'node', () => {
                // Reset opacity and z-index for all nodes and edges
                this.graph.elements().style({
                    'opacity': 1,
                    'z-index': 1, // Reset z-index to default
                });
            });            
    
            //
            // edge
            //
            this.graph.on('select', 'edge', event => {
                const selectedEdge = event.target;
            
                // Highlight the selected edge
                this.graph.edges().forEach(edge => {
                    if (edge.id() === selectedEdge.id()) {
                        edge.style({
                            'opacity': 1,                 // Full opacity for the selected edge
                            'text-background-color': 'rgb(240,240,240)',       // Background color for the label
                            'text-background-opacity': 0.9,           // Slight transparency for the background
                            'text-background-padding': '3px',         // Padding around the label
                            'text-background-shape': 'roundrectangle', // Shape of the background (rounded rectangle)
                            'color': '#000',                          // Label text color
                            'font-size': '12px',                      // Font size of the label
                            'z-index': 15,
                            'text-wrap': 'wrap'
                        });
            
                        const edgeData = selectedEdge.data();
                        const edgeCount = edgeData.list_count;
                        const countText = this.listDataset
                            .map((str, index) => `${this.datsetNameFormatted[str]}: ${edgeCount[index]}`)
                            .join('\n');
                        const edgeLabel = `${edgeData.type=="c" ? "Chemical" : "Electrical"}, n=${sumArray(edgeCount)}\n${countText}`
                        edge.style('label', edgeLabel || ''); // Show edge label from data
                    } else {
                        edge.style({
                            'opacity': 0.1               // Dim non-selected edges
                        });
                    }
                });
            
                // Highlight connected nodes
                const connectedNodes = selectedEdge.connectedNodes();
                this.graph.nodes().forEach(node => {
                    if (connectedNodes.includes(node)) {
                        node.style({
                            'opacity': 1, // Full opacity for connected nodes
                        });
                    } else {
                        node.style({
                            'opacity': 0.1, // Dim non-connected nodes
                        });
                    }
                });
            });
            
            // Reset the graph when an edge is unselected
            this.graph.on('unselect', 'edge', () => {
                // Reset all edges
                this.graph.edges().forEach(edge => {
                    edge.style({
                        'opacity': 1,       // Reset opacity
                        'label': '',        // Remove label
                        'text-background-opacity': 0, // Remove text background
                    });
                });
            
                // Reset all nodes
                this.graph.nodes().forEach(node => {
                    node.style({
                        'opacity': 1        // Reset opacity
                    });
                });
            });
    
            // node select info panel
            this.graph.on('tap', 'node', (evt) => {
                const node = evt.target;
                this.renderInfoPanel(node);
                this.infoPanel.showPanel();
            });
            this.graph.on('tap', (evt) => {
                if (evt.target === this.graph) {
                    this.infoPanel.hidePanel();
                }
            });
        }
    
        // this.corNeuron
        renderInfoPanel(node) {
            const nodeData = node.data();
            const nodeId = nodeData.id;
            const cellClass = nodeData.neuron_class;
            const cellType = nodeData.cell_type;
            const ntType = nodeData.neurotransmitter_type
    
            const cellTypeDict = {
                "s": "Sensory neuron", "i": "Interneuron", "m": "Motor neuron",
                "n": "Neuromodulative neuron", "b": "Muscle", "": "Others", "u": "Others"
            }
    
            const ntTypeDict = {
                "a": "Acetylcholine", "d": "Dopamine", "g": "GABA", "l": "Glutamate",
                "o": "Octopamine", "s": "Serotonin", "t": "Tyramine", "u": "Unknown", "n": "N/A"
            }
    
            const cellTypeFullStr = cellType.split("").map((str, index) => cellTypeDict[str]).join(', ')
            const ntTypeFullStr = ntType.split("").map((str, index) => ntTypeDict[str]).join(', ')
            
            const urlWWW = `/activity/find-neuron/?n=${nodeId}`
            const urlWormAtlas = `https://www.wormatlas.org/search_results.html?q=${cellClass}`
            const urlWormBase = `https://www.wormbase.org/species/all/anatomy_term/${cellClass}`
            const url3DViewer = `https://zhen-tools.com/#/3d-viewer?neurons=${cellClass}`

            // set the html to id=panel-content
            document.getElementById("info-panel-content").innerHTML = `<div class="p-2">
            <!-- Cell Information Section -->
            <h5 class="info-section-title">Cell Information</h5>
                <div class="mb-4">
                    <div class="info-row">
                        <span class="fw-medium">Cell</span>
                        <span class="text-muted" id="node-id">${cellClass}</span>
                    </div>
                    <div class="info-row">
                        <span class="fw-medium">Type</span>
                        <span class="text-muted" id="cell-type">${cellTypeFullStr}</span>
                    </div>
                    <div class="info-row">
                        <span class="fw-medium">Neurotransmitter</span>
                        <span class="text-muted" id="nt-type">${ntTypeFullStr}</span>
                    </div>
                </div>
            
                <!-- this plot -->
                <div id="sectionPlotActivityButton">
                    <h5 class="info-section-title">Activity</h5>
                    <div class="mb-4">
                        <p>Plot this neuron's activity</p>
                        <button id="activityButton" class="btn btn-secondary w-100 external-link d-flex align-items-center justify-content-between mb-2">
                            <span id="activityButtonLabel">Plot Activity</span>
                            <i class="bi bi-activity"></i>
                        </button>
                    </div>
                </div>

                <!-- WormWideWeb Section -->
                <h5 class="info-section-title">WormWideWeb</h5>
                <div class="mb-4">
                    <p>Find the neural activity of this neuron in other datasets</p>
                    <a href="${urlWWW}" class="btn btn-light w-100 external-link d-flex align-items-center justify-content-between mb-2">
                        <span>Find Neural Activity</span>
                        <i class="bi bi-search"></i>
                    </a>
                </div>
                
                <!-- External Resources Section -->
                <h5 class="info-section-title">External Resources</h5>
                <div class="d-grid gap-2">
                    <a href="${urlWormAtlas}" target="_blank" rel="noopener noreferrer" class="btn btn-light d-flex align-items-center justify-content-between">
                        <span>WormAtlas</span>
                        <i class="bi bi-box-arrow-up-right"></i>
                    </a>
                    <a href="${urlWormBase}" target="_blank" rel="noopener noreferrer" class="btn btn-light d-flex align-items-center justify-content-between">
                        <span>WormBase</span>
                        <i class="bi bi-box-arrow-up-right"></i>
                    </a>
                    <a href="${url3DViewer}" target="_blank" rel="noopener noreferrer" class="btn btn-light d-flex align-items-center justify-content-between">
                        <span>3D View (Zhen Lab)</span>
                        <i class="bi bi-box-arrow-up-right"></i>
                    </a>
                </div>
            </div>`
        const activityButton = document.getElementById("activityButton")
        if (nodeId in this.neuronToIdxNeuron) { // neuron is labeled
            const activityButtonText = document.getElementById("activityButtonLabel")
            if (nodeId in this.manifest) {
                activityButtonText.textContent = "Remove Activity"
            } else {
                activityButtonText.textContent = "Plot Activity"
            }

            activityButton.addEventListener('click', () => {
                if (nodeId in this.manifest) {
                    this.removeNeuronActivity(this.neuronToIdxNeuron[nodeId])
                    this.infoPanel.hidePanel()
                } else {
                    this.addNeuronActivity(this.neuronToIdxNeuron[nodeId])
                    this.infoPanel.hidePanel()
                }
            });
        } else {
            // hide the add/remove neuron activity section
            document.getElementById("sectionPlotActivityButton").classList.add("d-none")
        }
    }
    
    /*
        Style
    */
    getStyleEdge() {
        return {
            selector: 'edge',
            style: {
                'opacity': 1, // Default opacity
                'z-index': 1, // Default z-index
                'source-distance-from-node': 5,
                'target-distance-from-node': 5,
                'width': (ele) => {
                    // Apply a logarithmic scale to edge width based on count
                    return Math.log(ele.data('count') + 1) * this.edgeWidthScalingFactor; // Logarithmic scaling
                },
                'target-arrow-color': "#000000",
                'line-color': function (ele) {
                    // Set color to gray for synapse type 'e', otherwise black
                    return ele.data('type') == 'e' ? '#808080' : '#000000'; 
                },
                'source-arrow-shape': 'none',
                'target-arrow-shape': function (ele) {
                    // Remove arrows for 'e' type synapse
                    return ele.data('type') == 'e' ? 'none' : 'triangle';
                },
                'curve-style': 'bezier'
            }
        }    
    }

    getStyleNode() {
        return {
            selector: 'node',
            style: {
                'opacity': 1, // Default opacity
                'z-index': 1, // Default z-index
                'height':35,
                'width': (node) => {
                    return isNodeRectangle(node) ? 70 : 35
                },
                'text-halign': 'center',
                'text-valign': 'center',
                'text-wrap': 'wrap',
                'font-size': 12,
                'background-color': function (node) {
                    const cellType = node.data('cell_type')
                    if (cellType == 'b') {
                        return "rgb(75,75,75)"
                    } else if (cellType == 'u') {
                        return "rgb(250,250,250)"
                    } else {
                        return "#66ccff"
                    }
                },
                'label': 'data(id)',
                'shape': (node) => {
                    return isNodeRectangle(node) ? "round-rectangle" : "ellipse"
                }
            }
        }
    }

    getStyleEdgeElectrical() {
        return {
            selector: 'edge[type="e"]', // Style specifically for edges of type 'e'
            style: {
                'width': (ele) => {
                    // Apply a logarithmic scale to edge width based on count
                    return Math.log(ele.data('count') + 1) * this.edgeWidthScalingFactor; // Logarithmic scaling
                },
                'line-color': '#808080',  // Set the color to gray for 'e' type
                'mid-source-arrow-color': '#808080',
                'source-arrow-shape': 'none',  // No arrows on 'e' type edges
                'target-arrow-shape': 'none',  // No arrows on 'e' type edges
                'mid-source-arrow-shape': 'tee',
            }
        }    
    }

    initEdgeCountFilter() {
        // Generic handler for increment, decrement, and input
        const setupEdgeFilter = (type) => {
            const plusButton = document.getElementById(`plus-${type}`);
            const minusButton = document.getElementById(`minus-${type}`);
            const inputField = document.getElementById(`threshold-${type}`);
    
            inputField.value = this[`threshold${type.toUpperCase()}`];

            plusButton.addEventListener('click', () => {
                this[`threshold${type.toUpperCase()}`]++;
                inputField.value = this[`threshold${type.toUpperCase()}`];
                setLocalInt(`activity_connectome_threshold_${type}`, inputField.value)
                this.filterEdge();
            });
    
            minusButton.addEventListener('click', () => {
                if (this[`threshold${type.toUpperCase()}`] > 1) {
                    this[`threshold${type.toUpperCase()}`]--;
                    inputField.value = this[`threshold${type.toUpperCase()}`];
                    setLocalInt(`activity_connectome_threshold_${type}`, inputField.value)
                    this.filterEdge();
                }
            });
    
            inputField.addEventListener('input', (e) => {
                const newValue = Math.max(1, parseInt(e.target.value, 10) || 1);
                this[`threshold${type.toUpperCase()}`] = newValue;
                inputField.value = newValue; // Reflect the corrected value
                setLocalInt(`activity_connectome_threshold_${type}`, inputField.value)
                this.filterEdge();
            });
        };
    
        // Initialize filters for both edge types "e" and "c"
        setupEdgeFilter('e');
        setupEdgeFilter('c');
        
        this.filterEdge();
    }

    filterEdge() {
        const thresholdC = this.thresholdC;
        const thresholdE = this.thresholdE;

        // Show/hide edges based on thresholds
        this.graph.edges().forEach((edge) => {
            const { type, count } = edge.data();
            if ((type === 'e' && count >= thresholdE) || (type === 'c' && count >= thresholdC)) {
            edge.show();
            } else {
            edge.hide();
            }
        });
    
        // Show all nodes first to ensure connectedEdges() works
        this.graph.nodes().show();
    
        // Hide nodes if they have no visible connected edges
        this.graph.nodes().forEach((node) => {
            const connectedEdges = node.connectedEdges().filter((edge) => edge.visible());
            if (connectedEdges.length === 0) {
            node.hide(); // Hide the node if no edges are visible
            }
        });
        
        // Apply layout only to visible elements
        this.layoutManager.updateLayout()
    }

    /*
        Layout
    */
    initLayoutSlider() {
        const updateSpacing = (value) => {
            this.layoutManager.updateSpacingFactor(value)
            this.layoutManager.updateLayout()
        };
        const savedSpacing = initSlider("sliderSpacing", null, "activity_connectome_spacing", 1.0, updateSpacing)
        this.layoutManager.updateSpacingFactor(savedSpacing)

        const updateEdgeScalingFactor = (value) => {
            this.edgeWidthScalingFactor = value; // Update the factor
            this.graph.style().update(); // Force Cytoscape to reapply styles
        };
        const savedEdgeScale = initSlider("sliderEdgeScale", null,
            "activity_connectome_edge_scale", 1.5, updateEdgeScalingFactor)
        this.edgeWidthScalingFactor = savedEdgeScale
    }

    /*
        Graph data and plot
    */
    addManifest(neuron, type) {
        if (!(neuron in this.manifest)) {
            this.manifest[neuron] = type
            this.debouncedUpdateGraph()
        }
    }
    
    removeManifest(neuron) {
        if (neuron in this.manifest) {
            delete this.manifest[neuron]
            this.debouncedUpdateGraph()
        }
    }
    
    debouncedUpdateGraph = debounce(this.updateGraph, 500); // 500ms delay
    updateGraph() {
        // reset graph
        this.graph.elements().remove();
        this.jsonData = null;

        if (Object.keys(this.manifest).length > 0) {
            // construct query payload
            const nodeDict = {
                datasets: this.listDataset, classes: [], neurons: [],
                // show_individual_neuron: this.switchShowIndividual.value,
                show_individual_neuron: true,
                show_connected_neuron: this.switchShowConnected.value
            }
            for (const [neuron, type] of Object.entries(this.manifest)) {
                if (type == "class") {
                    nodeDict.classes.push(neuron)
                } else {
                    nodeDict.neurons.push(neuron)
                }
            }

            nodeDict.classes.sort()
            nodeDict.neurons.sort()

            // request edges
            fetch(edgeRequestURL, {
                method: 'POST', // HTTP method
                headers: {
                    'Content-Type': 'application/json', // Tell the server it's JSON
                    'X-CSRFToken': getCSRFToken() // Include CSRF token for security if needed
                },
                body: JSON.stringify(nodeDict) // Convert the JavaScript object to JSON
            })
                .then(response => {
                    if (!response.ok) {
                        throw new Error(`HTTP error! status: ${response.status}`);
                    }
                    
                    return response.json(); // Parse the JSON response
                })
                .then(data => {
                    this.jsonData = data;
                    this.drawGraph(data, nodeDict);
                })
                .catch(error => console.error('Error:', error));
        }
    }

    // actual graph drawing
    drawGraph(edgesData, manifest) {
        const synapses = edgesData.synapses
        const neurons = edgesData.neurons
        neurons.forEach(neuron => {
            // Check if the node already exists in the Cytoscape instance
            if (!this.graph.getElementById(neuron).length) {
                this.graph.add({
                    group: 'nodes',
                    data: getNeuronClassProperty(neuron)
                });
            }
        });

        // {pre: 'ADAL', post: 'ADFL', type: 'e', count: 1, list_count: Array(2)}
        synapses.forEach(synapse => {
            this.graph.add({
                group: 'edges',
                data: {
                    id: `${synapse.pre}-${synapse.post}-${synapse.type}`,
                    source: synapse.pre,
                    target: synapse.post,
                    count: synapse.count,
                    type: synapse.type,
                    list_count: synapse.list_count
                }
            });
        });

        this.nodeManager.updateNodeColorSet()
        this.nodeManager.adjustNodeLabelWrap()
        this.nodeManager.highlightNode(manifest.classes.concat(manifest.neurons), 5, "black")
        this.filterEdge()
    }
}