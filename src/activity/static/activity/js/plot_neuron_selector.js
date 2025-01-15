export class NeuronSelector {
    constructor(selectorNeuronId, plotManager, connectomeGraph) {
        // Retrieve the selector element by ID and ensure it exists
        this.selectorNeuronElement = document.getElementById(selectorNeuronId);
        if (!this.selectorNeuronElement) {
            throw new Error(`Element with ID "${selectorNeuronId}" not found.`);
        }

        this.plotManager = plotManager;
        this.connectomeGraph = connectomeGraph;

        // Initialize the TomSelect selector
        this.selector = this.initSelector();

        const neuronData = this.plotManager.data.neuron;
        if (!neuronData || typeof neuronData !== 'object') {
            console.warn('No neuron data available to populate the selector.');
            return;
        }

        // Create options using Object.values for cleaner code and fix the typo in "idx_neuron"
        const options = []
        Object.keys(neuronData).forEach((key) => {
            options.push({"idx_neuron": neuronData[key].idx_neruon, "name": neuronData[key]["name"],
                "label": neuronData[key]["label"], "class": neuronData[key]["class"]})
        });        
        
        // Add options to the selector
        this.selector.addOptions(options);
    }

    /**
     * Initializes the TomSelect selector with desired configurations and event handlers.
     * @returns {TomSelect} The initialized TomSelect instance.
     */
    initSelector() {
        return new TomSelect(this.selectorNeuronElement, {
            plugins: ['n_items', 'checkbox_options', 'dropdown_input'],
            persist: false,
            create: false,
            maxOptions: null,
            valueField: 'idx_neuron',
            labelField: 'name',
            searchField: ['name'],
            onItemAdd: (value, item) => this.selectorNeuronAdd(value, item),
            onItemRemove: (value, item) => this.selectorNeuronRemove(value, item),
            sortField: (a, b) => {
                const item_a =  this.selector.options[a.id];
                const item_b =  this.selector.options[b.id];        
                const aSelected = this.selector.items.includes(a.id);
                const bSelected = this.selector.items.includes(b.id);

                if (aSelected && !bSelected) return -1;  // a before b
                if (!aSelected && bSelected) return 1;   // b before a

                return item_a.idx_neuron < item_b.idx_neuron;
            }
            
            // onClear: () => this.selectorDataset.close(),
        });
    }

    /**
     * Clears all selections from the selector.
     */
    clearSelector() {
        this.selector.clear(); // clear(true) silent doesn't work; manually handling it if needed
    }

    addLabelToConnectome(optionData) {
        if (optionData.label != "" && !optionData.label.includes("?")) {
            this.connectomeGraph.addManifest(optionData.label, "neuron");
            // this.connectomeGraph.addManifest(optionData.class, "class");
        }
    }

    removeLabelFromConnectome(optionData) {
        if (optionData.label in this.connectomeGraph.manifest) {
            this.connectomeGraph.removeManifest(optionData.label, "neuron");
        }
    }

    /**
     * Handler for when a neuron is added to the selector.
     * @param {string} value - The value of the added neuron.
     * @param {HTMLElement} item - The HTML element of the added item.
     */
    selectorNeuronAdd(value, item) {
        const optionData = this.selector.options[value];
        if (optionData && optionData.name) {
            // Use the sequential plotting method
            this.plotManager.plotNeuronSequential(value, optionData.name);
            
            // connectome plot
            if (this.connectomeGraph) this.addLabelToConnectome(optionData)
        } else {
            console.warn(`Option data not found for value: ${value}`);
        }
    }

    /**
     * Handler for when a neuron is removed from the selector.
     * @param {string} value - The value of the removed neuron.
     * @param {HTMLElement} item - The HTML element of the removed item.
     */
    selectorNeuronRemove(value, item) {
        this.plotManager.removeNeuron(value);

        // connectome plot
        if (this.connectomeGraph) {
            const optionData = this.selector.options[value];
            this.removeLabelFromConnectome(optionData)
        }
    }
}