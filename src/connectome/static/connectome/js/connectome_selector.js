import { setLocalStr, setLocalJSON, getLocalStr } from '/static/core/js/utility.js'

const urlAvailableNeuron = "/connectome/api/available-neurons/";

/**
 * Class managing dataset and neuron selectors and updating a connectome graph.
 */
export class SelectorDatasetNeuron {
    /**
     * @param {string} selectorDatasetId - The HTML ID of the dataset selector element.
     * @param {string} selectorNeuronId - The HTML ID of the neuron selector element.
     * @param {object} connectomeGraph - The graph object that will be updated based on user selections.
     */
    constructor(selectorDatasetId, selectorNeuronId, connectomeGraph, enableClass=false) {
        this.enableClass = enableClass;

        // Grab the DOM elements
        this.selectorDatasetElement = document.getElementById(selectorDatasetId);
        this.selectorNeuronElement = document.getElementById(selectorNeuronId);

        // Optional: Guard if elements are not found
        if (!this.selectorDatasetElement || !this.selectorNeuronElement) {
            console.error("SelectorDatasetNeuron: One or more DOM elements not found.");
            return;
        }

        this.connectomeGraph = connectomeGraph;
        this.keyPrefix = connectomeGraph.keyPrefix;

        // Initialize selectors
        this.initializeNeuronSelector();
        this.initializeDatasetSelector();

        // Retrieve previously selected dataset(s) from localStorage

        const selectedDatasetStr = getLocalStr(`${this.keyPrefix ? this.keyPrefix + "_" : ""}connectome_selected_dataset_str`, "witvliet_2020_8");
        this.selectorDataset.setValue(selectedDatasetStr.split(","));
        this.selectorDataset.refreshOptions();
    }

    /**
     * Initialize the TomSelect instance for the neuron selector.
     */
    initializeNeuronSelector() {
        this.selectorNeuron = new TomSelect(this.selectorNeuronElement, {
            create: false,
            maxItems: null,
            valueField: "value",
            labelField: "name",
            searchField: ["name"],
            sortField: [{ field: "name" }],
            hidePlaceholder: true,
            maxOptions: null,
            plugins: this.getPluginsConfig("Remove this neuron", "Clear all neurons"),
            onItemAdd: (value, item) => this.selectorNeuronAdd(value, item),
            onItemRemove: (value, item) => this.selectorNeuronRemove(value, item),
            // Optionally close the dataset selector (or both) on certain actions
            onClear: () => {
                this.selectorDataset.close();
                // this.selectorNeuron.close(); // if you want to close neuron as well
            },
        });
    }

    /**
     * Initialize the TomSelect instance for the dataset selector.
     * Make sure 'datasets' is defined (globally or imported).
     */
    initializeDatasetSelector() {
        this.selectorDataset = new TomSelect(this.selectorDatasetElement, {
            options: datasets, // ensure 'datasets' is defined in your scope
            optgroups: [
                { value: "complete", label: "Complete" },
                { value: "head", label: "Head ganglia" },
                { value: "tail", label: "Tail ganglia" },
            ],
            hidePlaceholder: true,
            optgroupField: "dataset_type",
            valueField: "dataset_id",
            labelField: "name",
            searchField: ["name", "description", "dataset_type"],
            sortField: [{ field: "name" }],
            create: false,
            plugins: this.getPluginsConfig("Remove this dataset", "Clear all datasets"),
            onChange: (valuesStr) => this.selectorDatasetUpdate(valuesStr),
            // Optionally close the neuron selector (or both) on certain actions
            onClear: () => {
                this.selectorDataset.close();
                // this.selectorNeuron.close(); // if you want to close neuron as well
            },
            render: this.getRenderConfig(),
        });
    }

    /**
     * Return a plugins configuration object for TomSelect.
     * @param {string} removeTitle - Title text for remove button.
     * @param {string} clearTitle - Title text for clear-all button.
     * @returns {object}
     */
    getPluginsConfig(removeTitle, clearTitle) {
        return {
            remove_button: { title: removeTitle },
            clear_button: { title: clearTitle },
        };
    }

    /**
     * Return a rendering configuration object for TomSelect (for dataset selector).
     * @returns {object}
     */
    getRenderConfig() {
        return {
            option: (data, escape) =>
                `<div>${escape(data.name)} <span class="select_dataset_opt">${data.description}</span></div>`,
            optgroup_header: (data, escape) =>
                `<div class="optgroup-header"><strong>${escape(data.label)}</strong></div>`,
        };
    }

    /**
     * Update the dataset selection. Fetch neuron data, update selectors and graph.
     * @param {string} valuesStr - Comma-separated list of dataset IDs.
     * @param {function} [callback=null] - Optional callback to execute after updating.
     */
    async selectorDatasetUpdate(valuesStr, callback = null) {
        const listDataset = valuesStr.split(",");
        this.connectomeGraph.listDataset = listDataset;

        // If no datasets selected, clear the neuron selector and bail
        if (!valuesStr.length) {
            this.clearNeuronSelector();
            return;
        }

        try {
            const baseUrl = urlAvailableNeuron
            const params = new URLSearchParams({ datasets: listDataset.sort().join(",") });
            const fullUrl = `${baseUrl}?${params.toString()}`;

            const response = await fetch(fullUrl);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();

            // Update neuron selector with the fetched data
            this.selectorNeuronUpdate(data);

            // Save data to localStorage
            setLocalJSON(`${this.keyPrefix ? this.keyPrefix + "_" : ""}neuron_data`, data);
            setLocalStr(`${this.keyPrefix ? this.keyPrefix + "_" : ""}connectome_selected_dataset_str`, valuesStr);

            // Update the graph
            this.connectomeGraph.updateGraph();

            // Execute callback if provided
            if (callback) {
                callback(data);
            }
        } catch (error) {
            console.error("Error fetching data:", error);
        }
    }

    /**
     * Update the neuron selector options based on fetched data.
     * @param {object} data - Object containing `neurons` and `neuron_classes`.
     */
    selectorNeuronUpdate(data) {
        // Current selection in the neuron selector
        const selectionStr = this.selectorNeuron.getValue();
        // Current options
        const currentOptions = this.selectorNeuron.options;

        const dataNeurons = new Set(Object.keys(data.neurons));
        const dataNeuronClasses = new Set(Object.keys(data.neuron_classes));

        // 1) Remove invalid options (those not in the new dataset)
        Object.entries(currentOptions).forEach(([optionId, option]) => {
            const notInNeurons = !dataNeurons.has(option.value);
            const notInNeuronClasses = !dataNeuronClasses.has(option.value);
            if (notInNeurons && notInNeuronClasses) {
                this.selectorNeuron.removeOption(optionId);
            }
        });

        // 2) Add valid individual neurons
        for (const [neuron, neuronDict] of Object.entries(data.neurons)) {
            const neuronClass = neuronDict.neuron_class;
            // Only add if it's not already present, and not overshadowed by the class in selection
            if (!currentOptions[neuron] && !selectionStr.includes(neuronClass)) {
                this.selectorNeuron.addOption({
                    name: neuron,
                    value: neuron,
                    type: "neuron",
                    neuron_class: neuronClass,
                    neurons: data.neuron_classes[neuronClass].join(","),
                });
            }
        }

        // 3) Add valid neuron classes
        if (this.enableClass) {
            for (const [neuronClass, neuronList] of Object.entries(data.neuron_classes)) {
                // Only add the class if it isn't already in the options
                // and if none of its member neurons are currently selected
                if (!currentOptions[neuronClass]) {
                    const allUnselected = neuronList.every((item) => !selectionStr.includes(item));
                    if (allUnselected) {
                        this.selectorNeuron.addOption({
                            name: neuronClass,
                            value: neuronClass,
                            type: "class",
                            neurons: neuronList.join(","),
                        });
                    }
                }
            }
        }

        // Finally, refresh
        this.selectorNeuron.refreshOptions();
    }

    /**
     * Clear the neuron selector and remove the dataset key from localStorage.
     */
    clearNeuronSelector() {
        // Remove only the dataset key rather than clearing all localStorage
        localStorage.removeItem("connectome_selected_dataset_str");
        this.selectorNeuron.clear();
        this.selectorNeuron.clearOptions();
    }

    /**
     * Handler for when the user adds a neuron or neuron class.
     * @param {string} value - The added neuron's or class's name.
     * @param {HTMLElement} item - The rendered DOM element for the added item.
     */
    selectorNeuronAdd(value, item) {
        const selected = this.selectorNeuron.options[value];
        // If the user selected a neuron class, remove its constituent neurons from the options.
        // If the user selected an individual neuron, remove the class if it has multiple members.
        if (selected.type === "class") {
            const neuronNames = selected.neurons.split(",");
            // Remove each individual neuron from the options, so we don't show them simultaneously
            neuronNames.forEach((neuron) => this.selectorNeuron.removeOption(neuron));
            this.connectomeGraph.addManifest(value, "class");
        } else {
            // selected.type === "neuron"
            const neuronNames = selected.neurons.split(",");
            // If this neuron belongs to a class of multiple neurons, remove the class
            if (this.enableClass && neuronNames.length > 1) {
                this.selectorNeuron.removeOption(selected.neuron_class);
            }
            this.connectomeGraph.addManifest(value, "neuron");
        }
    }

    /**
     * Handler for when the user removes a neuron or neuron class.
     * @param {string} value - The removed neuron's or class's name.
     * @param {HTMLElement} item - The rendered DOM element for the removed item.
     */
    selectorNeuronRemove(value, item) {
        const options = this.selectorNeuron.options;
        if (value in options) {
            const selected = options[value];
            if (selected.type === "class") {
                // Class was removed: Add back its individual neurons to the options
                selected.neurons.split(",").forEach((neuron) => {
                    this.selectorNeuron.addOption({
                        name: neuron,
                        value: neuron,
                        type: "neuron",
                        neuron_class: value,
                        neurons: selected.neurons,
                    });
                });
            } else {
                // A single neuron was removed: If all neurons of a class are removed,
                // we can add the class back as an option.
                const neuronList = selected.neurons.split(",");
                const selectionStr = this.selectorNeuron.getValue();
                const allNeuronsUnselected = neuronList.every((n) => !selectionStr.includes(n));
                if (this.enableClass && allNeuronsUnselected) {
                    this.selectorNeuron.addOption({
                        name: selected.neuron_class,
                        value: selected.neuron_class,
                        type: "class",
                        neurons: selected.neurons,
                    });
                }
            }
        }

        // If the graph has nodes, remove the item from the graph manifest
        if (this.connectomeGraph.graph.nodes().length > 0) {
            this.connectomeGraph.removeManifest(value);
        }
    }
}

/**
 * Return the property object for a given neuron or neuron class, if found in local storage.
 * @param {string} neuron - The neuron ID or neuron class to look up.
 * @param {string} [localKey="neuron_data"] - The localStorage key where neuron data is stored.
 * @returns {?object} An object containing neuron properties (id, cell_type, etc.),
 *                    or null if not found or invalid.
 */
export function getNeuronClassProperty(neuron, localKey="neuron_data") {
    // Retrieve from localStorage
    const neuronDataRaw = localStorage.getItem(localKey);
    if (!neuronDataRaw) {
        console.error(`${localKey} not found in localStorage`);
        return null;
    }

    let neuron_data;
    try {
        neuron_data = JSON.parse(neuronDataRaw);
    } catch (err) {
        console.error("Failed to parse neuron data from localStorage:", err);
        return null;
    }

    if (!neuron_data.neurons || !neuron_data.neuron_classes) {
        console.error("Invalid or missing neuron_data properties");
        return null;
    }

    const { neurons, neuron_classes } = neuron_data;

    /**
     * Construct a standardized neuron/class properties object.
     */
    const constructNeuronProperties = (id, neuron_dict, node_type) => ({
        id,
        cell_type: neuron_dict.cell_type,
        in_head: neuron_dict.in_head,
        in_tail: neuron_dict.in_tail,
        is_embryonic: neuron_dict.is_embryonic,
        neurotransmitter_type: neuron_dict.neurotransmitter_type,
        type: node_type,
        neuron_class: neuron_dict.neuron_class,
    });

    // Check if the given string is an individual neuron
    if (neurons[neuron]) {
        return constructNeuronProperties(neuron, neurons[neuron], "neuron");
    }

    // Otherwise, check if it's a neuron class
    if (neuron_classes[neuron]) {
        const neuron_class_list = neuron_classes[neuron];
        // We pick the first valid member neuron to retrieve properties
        const neuron_0 = neuron_class_list.find((n) => neurons[n]);
        if (neuron_0) {
            return constructNeuronProperties(neuron, neurons[neuron_0], "class");
        }
    }

    // Not found
    console.warn(`Neuron or neuron class "${neuron}" not found in neurons or neuron_classes.`);
    return null;
}
