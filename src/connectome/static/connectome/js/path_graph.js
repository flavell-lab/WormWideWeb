import { getNeuronClassProperty } from './connectome_selector.js';
import { NodeManager} from './connectome_node.js'

const pathRequestURL = "/connectome/api/find-paths/"

export class PathGraph {
    constructor(graphId) {
        this.element = document.getElementById(graphId);
        this.initGraph();

        // node
        this.nodeManager = new NodeManager(this)

        this.errorElement = document.getElementById("resultAlert")
        this.pathList = document.getElementById("path-list")

        this.initSelection()

        this.hideError()
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
                    const edgeCount = edgeData.count;
                    const edgeLabel = `${edgeData.type=="c" ? "Chemical" : "Electrical"}, n=${edgeCount}`
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
                    return Math.log(ele.data('count') + 1) * 1.5; // Logarithmic scaling
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
                'width': function (node) {
                    return ['b','u'].includes(node.data('cell_type')) ? 70 : 35
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
                'shape': function (node) {
                    return ['b','u'].includes(node.data('cell_type')) ? "round-rectangle" : "ellipse"
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
                    return Math.log(ele.data('count') + 1) * 1.5; // Logarithmic scaling
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
            minZoom: 0.25,
            maxZoom: 3.0,
        });
    }

    setError(message) {
        this.errorElement.style.display = "block";
        this.errorElement.innerHTML = message;
    }

    hideError() {
        this.errorElement.style.display = "none";
    }

    searchPath(dataset_name, startNeuron, endNeuron, weighted, useClass, useGapJunction, callback=null) {
        this.graph.elements().remove();
        this.pathList.innerHTML = "";
        this.hideError();

        if (startNeuron == "" || endNeuron == "") {
            this.setError("Please select start and end neurons.");
            return
        } else if (startNeuron == endNeuron) {
            this.setError("Start and end neurons cannot be the same.");
            return
        }

        const params = new URLSearchParams({ dataset: dataset_name, start: startNeuron, end: endNeuron,
            weighted: weighted, class: useClass, gap_junction: useGapJunction });
        const fullUrl = `${pathRequestURL}?${params.toString()}`;

        fetch(fullUrl)
            .then((response) => {
                if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                return response.json();
            })
            .then((data) => {
                
                // update graph
                this.drawGraph(data)

                // Execute the callback if provided
                if (callback) callback(data);
            })
            .catch((error) => console.error("Error fetching data:", error));
    }

    // actual graph drawing
    drawGraph(data) {   
        // console.log(data)
        const paths = data.paths
        if (paths.length == 0) {
            this.setError("No paths found.");
            return
        }
        const neurons = data.nodes
        neurons.forEach(neuron => {
            // Check if the node already exists in the Cytoscape instance
            if (!this.graph.getElementById(neuron).length) {
                this.graph.add({
                    group: 'nodes',
                    data: getNeuronClassProperty(neuron, "connectome_path_neuron_data")
                });
            }
        });

        paths.forEach(path => {
            const synapses = path.edges
            synapses.forEach(synapse => {
                // {pre: 'ADAL', post: 'ADFL', type: 'e', count: 1}
                if (!this.graph.getElementById(`${synapse.pre}-${synapse.post}-${synapse.type}`).length) {
                    this.graph.add({
                        group: 'edges',
                        data: {
                            id: `${synapse.pre}-${synapse.post}-${synapse.type}`,
                            source: synapse.pre,
                            target: synapse.post,
                            count: synapse.count,
                            type: synapse.type,
                        }
                    })
                }
            })
        })
        
        const startNodeId = data.start_neuron
        const endNodeId = data.end_neuron
        this.customLayout(data.start_neuron, data.end_neuron)
        this.nodeManager.updateNodeColorSet()
        this.nodeManager.adjustNodeLabelWrap()
        this.nodeManager.highlightNode([startNodeId,endNodeId], 5, "black")
        
        this.renderPathList(data.paths)
    }

    customLayout(startNodeId, endNodeId) {
        const layout = this.graph.layout({
            name: 'dagre',
            rankDir: 'LR',  // Left to Right layout
            rankSep: 75,   // Distance between ranks (columns)
            nodeSep: 50,   // Distance between nodes in the same rank
            edgeWeight: (edge) => {
              // Give less weight to 'e' type edges so they don't affect layout as much
              return edge.data('id').endsWith('-e') ? 0.1 : 1;
            },
            // Force start node to leftmost rank
            ranker: 'longest-path',
            roots: [startNodeId],
            // Align end node to rightmost rank
            align: 'DR', // Down-Right alignment
          });
          

        layout.on('layoutstop', () => {
            const nodes = this.graph.nodes();
            const centroidY = nodes.reduce((sum, node) => sum + node.position('y'), 0) / nodes.length;
            
            this.graph.$id(startNodeId).position('y', centroidY);
            this.graph.$id(endNodeId).position('y', centroidY);
        });
          
        layout.run();

        if (this.graph.nodes().length < 8) {
            this.graph.fit(this.graph.nodes(), 200); // Add extra padding
            this.graph.zoom(0.8); // Set a custom zoom level for small graphs
            this.graph.center(); // Re-center the graph
          } else {
            this.graph.fit(this.graph.nodes(), 100); // Normal fit for larger graphs
          }    
    }

    renderPathList(paths) {
        this.pathList.innerHTML = ""; // Clear the list
        
        paths.forEach((path, index) => {
            const pathItem = document.createElement('li');
            pathItem.classList.add('path-item'); 
            // pathItem.addEventListener('click', () => {
            //   // Handle path click event here (e.g., display details, navigate to another page)
            //   console.log(`Path ${index + 1} clicked!`); 
            // });
            const pathName = document.createElement('span');
            pathName.textContent = `Path ${index + 1}`;
            pathName.classList.add('path-name');
          
            const pathSteps = document.createElement('p');
            const edges = path.edges
            let edgeText = "";
            const edgeCount = edges.length;
            edges.forEach((edge,i) => {
                const separator = edge.type === 'c' ? ' → ' : ' — ';
                if (i == 0) {
                    edgeText += `${edge.pre}${separator}${edge.post}`;
                } else if (i == edgeCount - 1) {
                    edgeText += `${separator}${edge.post}`;
                } else {
                    edgeText += `${separator}${edge.post}`;
                }
            })

            pathSteps.textContent = edgeText
            pathSteps.classList.add('path-steps');

            pathItem.appendChild(pathName);
            pathItem.appendChild(pathSteps);

            this.pathList.appendChild(pathItem);
        });
    }
}