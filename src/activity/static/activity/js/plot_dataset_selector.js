import { setLocalStr, setLocalJSON, getLocalStr } from '/static/core/js/utility.js'

export class DatasetSelector {
    constructor(selectorDatasetId, connectomeGraph) {
        this.selectorDatasetElement = document.getElementById(selectorDatasetId);
        this.connectomeGraph = connectomeGraph;

        // Initialize selector - dataset
        this.initializeDatasetSelector();

        const selectedDatasetStr = getLocalStr("activity_connectome_selected_dataset_str", "white_1986_whole,witvliet_2020_7,witvliet_2020_8");
        this.selectorDataset.setValue(selectedDatasetStr.split(","))
    }

    initializeDatasetSelector() {
        this.selectorDataset = new TomSelect(this.selectorDatasetElement, {
            options: datasets,
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
            onClear: () => this.selectorDataset.close(),
            render: this.getRenderConfig(),
            onDelete: (values) => {
                // at least one dataset is selected
                if (this.selectorDataset.items.length <= values.length) {
                  // block the removal
                  return false;
                }
                return true; // otherwise allow
              }            
        });
    }

    getPluginsConfig(removeTitle, clearTitle) {
        return {
            remove_button: { title: removeTitle },
            clear_button: { title: clearTitle },
        };
    }

    getRenderConfig() {
        return {
            option: (data, escape) =>
                `<div>${escape(data.name)} <span class="select_dataset_opt">${
                    data.description
                }</span></div>`,
            optgroup_header: (data, escape) =>
                `<div class="optgroup-header"><strong>${escape(data.label)}</strong></div>`,
        };
    }

    selectorDatasetUpdate(valuesStr, callback=null) {
        const listDataset = valuesStr.split(",");
        this.connectomeGraph.listDataset = listDataset;

        if (!valuesStr.length) {
            console.warn("No datasets selected");
            // this.clearNeuronSelector();
            return;
        }

        const baseUrl = "/connectome/api/available-neurons/";
        const params = new URLSearchParams({ datasets: listDataset.sort().join(",") });
        const fullUrl = `${baseUrl}?${params.toString()}`;

        fetch(fullUrl)
            .then((response) => {
                if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                return response.json();
            })
            .then((data) => {                
                setLocalJSON("activity_neuron_data", data)
                setLocalStr("activity_connectome_selected_dataset_str", valuesStr)

                // update graph
                if (Object.keys(this.connectomeGraph.manifest).length > 0) {
                    this.connectomeGraph.debouncedUpdateGraph()
                }

                // Execute the callback if provided
                if (callback) callback(data);
            })
            .catch((error) => console.error("Error fetching data:", error));
    }
}

export function getNeuronClassProperty(neuron, localKey="activity_neuron_data") {
    // Parse neuron_data from localStorage
    const neuron_data = JSON.parse(localStorage.getItem(localKey));
    if (!neuron_data || !neuron_data.neurons || !neuron_data.neuron_classes) {
        console.error("Invalid or missing neuron_data in localStorage");
        return null;
    }

    const { neurons, neuron_classes } = neuron_data;

    // Helper function to construct neuron properties
    const constructNeuronProperties = (id, neuron_dict, node_type) => ({
        id,
        cell_type: neuron_dict.cell_type,
        in_head: neuron_dict.in_head,
        in_tail: neuron_dict.in_tail,
        is_embryonic: neuron_dict.is_embryonic,
        neurotransmitter_type: neuron_dict.neurotransmitter_type,
        type: node_type,
        neuron_class: neuron_dict.neuron_class
    });

    // Check if neuron exists in neurons
    if (neurons[neuron]) {
        return constructNeuronProperties(neuron, neurons[neuron], "neuron");
    }

    // Check if neuron exists in neuron_classes
    if (neuron_classes[neuron]) {
        const neuron_class_list = neuron_classes[neuron];

        // Find the first valid neuron in the class
        const neuron_0 = neuron_class_list.find((n) => neurons[n]);
        if (neuron_0) {
            return constructNeuronProperties(neuron, neurons[neuron_0], "class");
        }
    }

    // Return null if neuron is not found
    console.warn(`Neuron "${neuron}" not found in neurons or neuron_classes`);
    return null;
}