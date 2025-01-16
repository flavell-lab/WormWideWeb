import {getLocalStr, setLocalStr, getLocalFloat, initDropdown} from '/static/core/js/utility.js'

export class GraphLayoutManager {
    constructor(graph, localKeyPrefix=null, dropdownId=null, nodePositionManager=null, defaultLayout="concentric") {
        this.graph = graph
        this.localKey = `${localKeyPrefix ? localKeyPrefix + "_" : ""}connectome_layout`
        this.nodePositionManager = nodePositionManager
        this.initNameUI = getLocalStr(this.localKey, defaultLayout)
        this.layoutSetting = this.getLayoutSetting(this.initNameUI)
        this.spacingFactor = getLocalFloat(`${localKeyPrefix ? localKeyPrefix + "_" : ""}connectome_spacing`, 1.)


        this.changeLayoutUI = (nameUI) => {
            if (nameUI == "custom") {
                this.nodePositionManager.renderNodePositionInput();
            } else {
                setLocalStr(this.localKey, nameUI);
                this.layoutSetting = this.getLayoutSetting(nameUI)
                this.updateLayout()
            }    
        }
    
        initDropdown(dropdownId, this.changeLayoutUI, false, this.initNameUI);
    }

    getLayoutSetting(nameUI) {  
        const layoutSetting = {
            nameUI: nameUI,
            config: {spacingFactor: this.spacingFactor, animate: true}
        }
        layoutSetting.config.name = nameUI;
        switch (nameUI) {
            case "grid":
                layoutSetting.config.avoidOverlap = true
                layoutSetting.config.avoidOverlapPadding = 5
                break;
            case "circle":
                break;
            case "concentric":
                layoutSetting.config.minNodeSpacing = 5
                break;
            case "dagre":
                layoutSetting.config.rankDir = "TB",
                layoutSetting.config.nodeSep = 10,
                layoutSetting.config.rankSep = 25
                break;
            case "breadthfirst":
                layoutSetting.config.directed = true
                break;
            case "cose":
                layoutSetting.config.nodeRepulsion = (edge) => {return 10000}
                layoutSetting.config.edgeElasticity = (edge) => {return 32}
                layoutSetting.config.initialTemp = 10000
                break;
            default:
                break;
        }
        
        return layoutSetting
    }

    updateSpacingFactor(spacingFactor) {
        this.spacingFactor = spacingFactor;
        this.layoutSetting.config.spacingFactor = spacingFactor;
    }

    updateLayout() {
        if (this.layoutSetting.config.name == "dagre" && this.graph.nodes(":visible").length > 75) {
            // confirm from user to proceed
            const proceed = confirm("This layout (dagre) might take a while to render. It could also freeze your browser. Do you want to proceed?");
            if (!proceed) {
                return;
            }
        }
        const visibleElements = this.graph.filter(':visible');
        visibleElements.layout(this.layoutSetting.config).run();
        this.graph.fit();
    }
}

export class NodePositionManager {
    constructor(graph, containerId, buttonId, otherButtonId) {
        this.graph = graph; // Cytoscape graph instance
        this.containerId = containerId; // ID of the container where the inputs will be rendered
        this.buttonId = buttonId; // ID of the button to update the layout
        this.otherButtonId = otherButtonId;
    }

    // Method to render the input area
    renderNodePositionInput() {
        const customExplanation = document.getElementById("customExplanation");
        customExplanation.innerHTML = "<b>Enter neuron position in csv format</b><br>neuron,x,y"

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

        // Create a text area for batch input
        const textArea = document.createElement('textarea');
        textArea.id = 'node-position-input';
        textArea.className = 'form-control';
        textArea.rows = 10;
        textArea.placeholder = `Enter neuron positions in csv format:\nneuron1,x1,y1\nneuron2,x2,y2`;

        container.appendChild(textArea);

        // Populate with current node positions
        const currentPositions = this.graph.nodes(':visible').map((node) => {
            const { id } = node.data();
            const { x, y } = node.position();
            return `${id},${x.toFixed(2)},${y.toFixed(2)}`;
        }).join('\n');
        textArea.value = currentPositions;

        // Add a container for Bootstrap alerts
        const alertContainer = document.createElement('div');
        alertContainer.id = 'alert-container';
        alertContainer.className = 'mt-3';
        container.appendChild(alertContainer);
    }

    // display parse errors
    showErrorAlert(errors) {
        const alertContainer = document.getElementById('alert-container');
        if (!alertContainer) {
            console.error('Alert container not found.');
            return;
        }

        alertContainer.innerHTML = ""; // Clear any existing alerts

        const alertDiv = document.createElement('div');
        alertDiv.className = 'alert alert-danger alert-dismissible fade show';
        alertDiv.role = 'alert';
        alertDiv.innerHTML = `
            <strong>Error</strong> there are issues with your input:
            <ul>
                ${errors.map((error) => `<li>${error}</li>`).join('')}
            </ul>
            <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
        `;
        alertContainer.appendChild(alertDiv);
    }

    // Method to parse and apply node positions
    applyNodePositions() {
        const textArea = document.getElementById('node-position-input');
        if (!textArea) {
            console.error('Text area for node positions not found.');
            return;
        }

        const inputText = textArea.value.trim();
        const errors = [];
        const existingNodeIds = this.graph.nodes(':visible').map(node => node.data('id')); // Get all node IDs in the graph
        const inputNodeIds = new Set(); // To track node IDs from the input

        // Parse and validate the CSV input
        const nodesData = inputText.split('\n').map((line, index) => {
            // Split the line into columns
            const columns = line.split(',').map(s => s.trim());
            if (columns.length !== 3) {
                errors.push(`Line ${index + 1}: Expected 3 entries (Neuron, x, y), but found ${columns.length}.`);
                return null;
            }

            const [id, xStr, yStr] = columns;
            const x = parseFloat(xStr);
            const y = parseFloat(yStr);

            // Check if x and y are numbers
            if (isNaN(x)) {
                errors.push(`Line ${index + 1}: x value ('${xStr}') is not a valid number.`);
            }
            if (isNaN(y)) {
                errors.push(`Line ${index + 1}: y value ('${yStr}') is not a valid number.`);
            }

            // Check if the node exists in the graph
            if (!existingNodeIds.includes(id)) {
                errors.push(`Line ${index + 1}: Neuron '${id}' does not exist in the graph.`);
            }

            // Track the node ID from the input
            if (id) {
                inputNodeIds.add(id);
            }

            // Only return valid entries
            if (errors.length === 0) {
                return { id, x, y };
            } else {
                return null;
            }
        }).filter(Boolean);

        // Check for missing nodes
        const missingNodeIds = existingNodeIds.filter(id => !inputNodeIds.has(id));
        if (missingNodeIds.length > 0) {
            errors.push(`Missing entries for the following neurons: ${missingNodeIds.join(', ')}.`);
        }

        // Display errors if any
        if (errors.length > 0) {
            this.showErrorAlert(errors); // Display errors using Bootstrap alerts
            return;
        }


        // Update node positions in the graph
        nodesData.forEach(({ id, x, y }) => {
            const node = this.graph.getElementById(id);
            if (node) {
                node.position({ x, y });
            } else {
                console.warn(`Neuron '${id}' not found in the graph.`);
            }
        });

        this.graph.fit(); // Adjust view to fit all
    }

    // Method to initialize the custom layout handler
    init() {
        // Attach event listener to the update button
        const updateButton = document.getElementById(this.buttonId);
        if (!updateButton) {
            console.error(`Button with ID '${this.buttonId}' not found.`);
            return;
        }

        updateButton.addEventListener('click', () => {
            this.applyNodePositions();
        });
    }
}