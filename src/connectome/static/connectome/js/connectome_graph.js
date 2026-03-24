import { isNodeRectangle, sumArray, initSwitch, setLocalInt, getLocalInt, getLocalBool, initSlider, debounce, getCSRFToken } from '/static/core/js/utility.js'
import { GraphLayoutManager, NodePositionManager } from './connectome_layout.js'
import { NodeManager} from './connectome_node.js'
import { getNeuronClassProperty } from './connectome_selector.js';
import { InfoPanel } from '/static/core/js/info_panel.js'
import { CONNECTOME_DATASET_ID_TO_DATASET_NAME, URL_CONNECTOME_EDGE, cellTypeDict, ntTypeDict } from '/static/core/js/constants.js';

const DEFAULT_GRAPH_OPTIONS = {
    switchIndividualId: "switchIndividual",
    switchConnectedId: "switchConnected",
    spinnerId: "spinnerStatus",
    downloadButtonId: "downloadEdgeJSON",
    downloadPNGButtonId: "downloadPlotPNG",
    downloadSVGButtonId: "downloadPlotSVG",
    layoutDropdownId: "dropdownLayout",
    colorDropdownId: "dropdownColor",
    sliderSpacingId: "sliderSpacing",
    sliderEdgeScaleId: "sliderEdgeScale",
    nodePositionListId: "node-position-list",
    updateCustomLayoutId: "updateCustomLayout",
    updateCustomColorId: "updateCustomColor",
    legendId: "connectome-legend",
    legendItemsId: "connectome-legend-items",
    infoPanelId: "info-panel",
    infoPanelContainerId: "connectome-container",
    infoPanelEnabled: true,
    thresholdIds: {
        e: { plus: "plus-e", minus: "minus-e", input: "threshold-e" },
        c: { plus: "plus-c", minus: "minus-c", input: "threshold-c" },
    },
    neuronDataLocalKey: null,
};

export class ConnectomeGraph {
    constructor(graphId, keyPrefix=null, options={}) {
        this.options = { ...DEFAULT_GRAPH_OPTIONS, ...options };
        this.options.thresholdIds = {
            ...DEFAULT_GRAPH_OPTIONS.thresholdIds,
            ...(options.thresholdIds || {}),
        };
        this.keyPrefix = keyPrefix
        this.storagePrefix = this.keyPrefix ? `${this.keyPrefix}_` : "";
        this.neuronDataLocalKey = this.options.neuronDataLocalKey || `${this.storagePrefix}neuron_data`;
        this.element = document.getElementById(graphId);
        this.initGraph();

        this.drawGraphCallback = null;

        this.manifest = {};
        this.listDataset = [];

        // download
        this.jsonData = null;

        // node
        this.nodeManager = new NodeManager(
            this,
            "type",
            this.keyPrefix,
            null,
            this.options.colorDropdownId,
            this.options.nodePositionListId,
            this.options.updateCustomColorId,
            this.options.updateCustomLayoutId,
            this.options.legendId,
            this.options.legendItemsId
        )
        this.updateNodeColorUponDraw = true

        // info panel
        this.infoPanel = null;
        if (this.options.infoPanelEnabled) {
            this.infoPanel = new InfoPanel();
            this.infoPanel.injectInfoPanelHTML(this.options.infoPanelId);
        }

        // layout
        this.nodePositiobManager = new NodePositionManager(
            this.graph,
            this.options.nodePositionListId,
            this.options.updateCustomLayoutId,
            this.options.updateCustomColorId
        );
        this.nodePositiobManager.init();
        this.layoutManager = new GraphLayoutManager(
            this.graph,
            keyPrefix,
            this.options.layoutDropdownId,
            this.nodePositiobManager,
            "concentric"
        );
        this.edgeWidthScalingFactor = 1.5
        this.initLayoutSlider();

        // set up edge count threshold
        this.thresholdE = getLocalInt(this.getStorageKey("connectome_threshold_e"), 1);
        this.thresholdC = getLocalInt(this.getStorageKey("connectome_threshold_c"), 1);
        this.initEdgeCountFilter();

        // set up switches
        this.switchShowIndividual = {value: getLocalBool(this.getStorageKey("connectome_show_individual_neuron"), false)}
        this.switchShowConnected = {value: getLocalBool(this.getStorageKey("connectome_show_connected_neuron"), true)}
        initSwitch(this.options.switchIndividualId,
            () => this.debouncedUpdateGraph(),
            () => this.debouncedUpdateGraph(),
            this.switchShowIndividual,
            this.getStorageKey("connectome_show_individual_neuron"),
            this.switchShowIndividual.value);    

        initSwitch(this.options.switchConnectedId,
            () => this.debouncedUpdateGraph(),
            () => this.debouncedUpdateGraph(),
            this.switchShowConnected,
            this.getStorageKey("connectome_show_connected_neuron"),
            this.switchShowConnected.value);

        // setup download
        const downloadJSONBtn = document.getElementById(this.options.downloadButtonId);
        if (downloadJSONBtn) {
            downloadJSONBtn.addEventListener('click', () => {
                if (this.jsonData !== null) {
                    this.downloadEdgeJSON(this.jsonData, 'wormwideweb connectome data.json');
                } else {
                    alert('Cannot download data');
                }
            });
        }

        const downloadPNGBtn = document.getElementById(this.options.downloadPNGButtonId);
        if (downloadPNGBtn) {
            downloadPNGBtn.addEventListener('click', () => {
                this.downloadGraphPNG('wormwideweb connectome plot.png');
            });
        }

        const downloadSVGBtn = document.getElementById(this.options.downloadSVGButtonId);
        if (downloadSVGBtn) {
            downloadSVGBtn.addEventListener('click', () => {
                this.downloadGraphSVG('wormwideweb connectome plot.svg');
            });
        }

        // event trigger for cytoscape graph selection
        this.initSelection();

        // update graph function
        if (this.element) {
            this.element.updateGraph = this.debouncedUpdateGraph;
        }
    }

    getStorageKey(key) {
        return `${this.storagePrefix}${key}`;
    }

    toggleSpinner(show) {
        const spinner = document.getElementById(this.options.spinnerId);
        if (!spinner) {
            return;
        }
        spinner.style.display = show ? "block" : "none";
    }

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
                        .map((str, index) => `${CONNECTOME_DATASET_ID_TO_DATASET_NAME[str]}: ${edgeCount[index]}`)
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
        if (this.options.infoPanelEnabled && this.infoPanel) {
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
    }

    renderInfoPanel(node) {
        if (!this.infoPanel) {
            return;
        }

        const infoPanelId = this.options.infoPanelId;
        if (document.fullscreenElement) {
            const infoPanelElement = document.getElementById(infoPanelId);
            if (infoPanelElement) {
                infoPanelElement.remove();
            }
            const connectomeContainer = document.getElementById(this.options.infoPanelContainerId)
            this.infoPanel.injectInfoPanelHTML(infoPanelId, connectomeContainer)
        } else {
            this.infoPanel.injectInfoPanelHTML(infoPanelId)
        }

        const nodeData = node.data();
        const cellClass = nodeData.neuron_class;
        const cellType = nodeData.cell_type;
        const cellTypeDesc =  nodeData.cell_type_desc;
        // const ntType = nodeData.neurotransmitter_type

        const cellTypeFullStr = cellType.split("").map((str, index) => cellTypeDict[str]).join(', ')
        // const ntTypeFullStr = ntType.split("").map((str, index) => ntTypeDict[str]).join(', ')
        
        const urlWWW = `/activity/find-neuron/?n=${cellClass}`
        const urlWormAtlas = `https://www.wormatlas.org/search_results.html?q=${cellClass}`
        const urlWormBase = `https://www.wormbase.org/species/all/anatomy_term/${cellClass}`
        const url3DViewer = `https://zhen-tools.com/#/3d-viewer?neurons=${cellClass}`
        const urlFunctional = `https://funconn.princeton.edu/?in=${cellClass}`

        // set the html to id=panel-content
        const infoPanelContent = document.getElementById("info-panel-content");
        if (!infoPanelContent) {
            return;
        }

        infoPanelContent.innerHTML = `<div class="p-2">
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
            <span class="fw-medium">Description</span>
            <span class="text-muted" id="cell-type">${cellTypeDesc}</span>
        </div>
    </div>
    
    <!-- WormWideWeb Section -->
    <h5 class="info-section-title">WormWideWeb</h5>
    <div class="mb-4" id="buttonFindActivity">
        <a href="${urlWWW}" class="btn btn-light w-100 external-link d-flex align-items-center justify-content-between mb-2">
            <span>Plot neural activity</span>
            <i class="bi bi-activity"></i>
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
        <a href="${urlFunctional}" target="_blank" rel="noopener noreferrer" class="btn btn-light d-flex align-items-center justify-content-between">
            <span>Functional Connectivity (Leifer Lab)</span>
            <i class="bi bi-box-arrow-up-right"></i>
        </a>
    </div>
</div>
`
    }

    //
    // style
    //
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

    //
    // graph
    //
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
        // spinner
        this.toggleSpinner(true);

        // reset graph
        this.graph.elements().remove();
        this.jsonData = null;

        if (Object.keys(this.manifest).length > 0 && this.listDataset.length > 0) {
            // construct query payload
            const nodeDict = {datasets: this.listDataset, classes: [], neurons: [],
                show_individual_neuron: this.switchShowIndividual.value,
                show_connected_neuron: this.switchShowConnected.value}
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
            fetch(URL_CONNECTOME_EDGE, {
                method: 'POST', // HTTP method
                credentials: 'same-origin',
                headers: {
                    'Content-Type': 'application/json', // Tell the server it's JSON
                    'X-CSRFToken': getCSRFToken(), // Include CSRF token for security if needed
                    'X-Requested-With': 'XMLHttpRequest',
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
                this.toggleSpinner(false);
            })
            .catch(error => {
                console.error('Error:', error);
                this.toggleSpinner(false);
            });
        } else {
            this.toggleSpinner(false);
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
                    data: getNeuronClassProperty(neuron, this.neuronDataLocalKey)
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
    
        if (this.updateNodeColorUponDraw) {
            this.nodeManager.updateNodeColorSet()
        }
            this.nodeManager.adjustNodeLabelWrap()
            this.nodeManager.highlightNode(manifest.classes.concat(manifest.neurons), 5, "black")
        this.filterEdge()

        if (this.drawGraphCallback) this.drawGraphCallback()
    }
    
    //
    // edge count filter
    //
    initEdgeCountFilter() {
        // Generic handler for increment, decrement, and input
        const setupEdgeFilter = (type) => {
            const thresholdIds = this.options.thresholdIds[type];
            const plusButton = document.getElementById(thresholdIds?.plus || `plus-${type}`);
            const minusButton = document.getElementById(thresholdIds?.minus || `minus-${type}`);
            const inputField = document.getElementById(thresholdIds?.input || `threshold-${type}`);

            if (!plusButton || !minusButton || !inputField) {
                return;
            }

            inputField.value = this[`threshold${type.toUpperCase()}`];

            plusButton.addEventListener('click', () => {
                this[`threshold${type.toUpperCase()}`]++;
                inputField.value = this[`threshold${type.toUpperCase()}`];
                setLocalInt(this.getStorageKey(`connectome_threshold_${type}`), inputField.value)
                this.filterEdge();
            });
    
            minusButton.addEventListener('click', () => {
                if (this[`threshold${type.toUpperCase()}`] > 1) {
                    this[`threshold${type.toUpperCase()}`]--;
                    inputField.value = this[`threshold${type.toUpperCase()}`];
                    setLocalInt(this.getStorageKey(`connectome_threshold_${type}`), inputField.value)
                    this.filterEdge();
                }
            });
    
            inputField.addEventListener('input', (e) => {
                const newValue = Math.max(1, parseInt(e.target.value, 10) || 1);
                this[`threshold${type.toUpperCase()}`] = newValue;
                inputField.value = newValue; // Reflect the corrected value
                setLocalInt(this.getStorageKey(`connectome_threshold_${type}`), inputField.value)
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

    //
    // layout
    //
    initLayoutSlider() {
        const updateSpacing = (value) => {
            this.layoutManager.updateSpacingFactor(value)
            this.layoutManager.updateLayout()
        };
        const savedSpacing = initSlider(
            this.options.sliderSpacingId,
            null,
            this.getStorageKey("connectome_spacing"),
            1.0,
            updateSpacing
        )
        this.layoutManager.updateSpacingFactor(savedSpacing)

        const updateEdgeScalingFactor = (value) => {
            this.edgeWidthScalingFactor = value; // Update the factor
            this.graph.style().update(); // Force Cytoscape to reapply styles
        };
        const savedEdgeScale = initSlider(
            this.options.sliderEdgeScaleId,
            null,
            this.getStorageKey("connectome_edge_scale"),
            1.5,
            updateEdgeScalingFactor
        )
        this.edgeWidthScalingFactor = savedEdgeScale
    }
    
    //
    // download
    //
    downloadEdgeJSON(jsonData, fileName='wormwideweb connectome data.json') {
        // Convert your data to a string if it's not already
        let jsonString;
        if (typeof jsonData === 'string') {
          jsonString = jsonData; // if it's already a JSON string
        } else {
          jsonString = JSON.stringify(jsonData, null, 2);
        }
    
        // Create a blob (file-like object) from the string
        const blob = new Blob([jsonString], { type: 'application/json' });
        // Create a temporary object URL
        const url = URL.createObjectURL(blob);
        // Create a temporary <a> to trigger download
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        // Clean up
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    downloadGraphPNG(fileName='wormwideweb connectome plot.png') {
        if (!this.graph) {
            alert('Cannot download plot');
            return;
        }

        const pngData = this.graph.png({
            full: true,
            scale: 2,
            bg: '#ffffff',
        });

        const a = document.createElement('a');
        a.href = pngData;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }

    downloadGraphSVG(fileName='wormwideweb connectome plot.svg') {
        if (!this.graph || typeof this.graph.svg !== 'function') {
            alert('Cannot download SVG plot');
            return;
        }

        const svgData = this.graph.svg({
            full: true,
            bg: '#ffffff',
            scale: 1,
        });

        const blob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
}
