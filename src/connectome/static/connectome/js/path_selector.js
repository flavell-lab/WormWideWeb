import { setLocalStr, setLocalJSON, getLocalStr, setLocalBool, getLocalBool, initSwitch, updateCitation } from '/static/core/js/utility.js'

export class PathSelector
{
    constructor(selectorDatasetId, selectorNeuronStartId, selectorNeuronEndId, connectomeGraph) {
        this.selectorDatasetElement = document.getElementById(selectorDatasetId);
        this.selectorNeuronStartElement = document.getElementById(selectorNeuronStartId);
        this.selectorNeuronEndElement = document.getElementById(selectorNeuronEndId);
        this.connectomeGraph = connectomeGraph;

        // set up switches
        this.switchClass = {value: getLocalBool("connectome_path_use_class", true)}
        this.switchNoGapJunction = {value: getLocalBool("connectome_path_no_gap_junction", false)}
        // this.switchWeight = {value: getLocalBool("connectome_path_use_weight", false)}
        this.switchWeight = {value: false}
        initSwitch("switchClass",
            () => this.selectorNeuronUpdate(),
            () => this.selectorNeuronUpdate(),
            this.switchClass, "connectome_path_use_class", this.switchClass.value);    

        initSwitch("SwitchGapJunction", ()=>null, ()=>null,
            this.switchNoGapJunction, "connectome_path_no_gap_junction", this.switchNoGapJunction.value);

        // initSwitch("switchWeight", ()=>null, ()=>null,
        //     this.switchWeight, "connectome_path_use_weight");
    
        // setup button
        const searchButton = document.getElementById("searchButton");
        searchButton.addEventListener("click", () => this.searchPath());

        // selectors
        this.initializeDatasetSelector()
        this.selectorNeuronStart = this.initializeNeuronSelector(this.selectorNeuronStartElement)
        this.selectorNeuronEnd = this.initializeNeuronSelector(this.selectorNeuronEndElement)

        const selectedDatasetStr = getLocalStr("connectome_path_selected_dataset_str", "witvliet_2020_8");
        this.selectorDataset.addItem(selectedDatasetStr)
    }
    
    searchPath() {
        const dataset_name = this.selectorDataset.getValue()
        const startNeuron = this.selectorNeuronStart.getValue()
        const endNeuron = this.selectorNeuronEnd.getValue()
        const weighted = this.switchWeight.value
        const useClass = this.switchClass.value
        const useGapJunction = !this.switchNoGapJunction.value

        this.connectomeGraph.searchPath(dataset_name, startNeuron, endNeuron, weighted, useClass, useGapJunction)
    }

    initializeDatasetSelector() {
        this.selectorDataset = new TomSelect(this.selectorDatasetElement, {
            options: datasets,
            optgroups: [
                { value: "pharynx", label: "Pharynx"},
                { value: "complete", label: "Complete" },
                { value: "head", label: "Head ganglia" },
                { value: "tail", label: "Tail ganglia" },
            ],
            maxItems: 1,
            hidePlaceholder: true,
            optgroupField: "dataset_type",
            valueField: "dataset_id",
            labelField: "name",
            searchField: ["name", "description", "dataset_type"],
            sortField: [{ field: "name" }],
            create: false,
            plugins: ['dropdown_input'],
            onChange: (valuesStr) => this.selectorDatasetUpdate(valuesStr),
            // onClear: () => this.selectorDataset.close(),
            render: {
                option: (data, escape) =>
                    `<div>${escape(data.name)} <span class="select_dataset_opt">${
                        data.description
                    }</span></div>`,
                optgroup_header: (data, escape) =>
                    `<div class="optgroup-header"><strong>${escape(data.label)}</strong></div>`,
            },
       });
    }

    initializeNeuronSelector(selectorNeuronElement) {
        return new TomSelect(selectorNeuronElement, {
            create: false,
            maxItems: 1,
            valueField: "name",
            labelField: "name",
            searchField: ["name"],
            sortField: [{ field: "name" }],
            hidePlaceholder: true,
            maxOptions: null,
            plugins: ['dropdown_input'],
        })
    }

    selectorDatasetUpdate(valuesStr, callback=null) {
        const listDataset = valuesStr.split(",");

        updateCitation(listDataset, "connectomeCitation", this.selectorDataset.options)

        if (!valuesStr.length) {
            console.warn("No datasets selected");
            this.clearNeuronSelector();
            return;
        }

        this.connectomeGraph.graph.elements().remove();
        this.connectomeGraph.hideError();
        this.connectomeGraph.pathList.innerHTML = "";

        const baseUrl = "/connectome/api/available-neurons/";
        const params = new URLSearchParams({ datasets: listDataset.sort().join(",") });
        const fullUrl = `${baseUrl}?${params.toString()}`;

        fetch(fullUrl)
            .then((response) => {
                if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                return response.json();
            })
            .then((data) => {
                this.neuronData = data
                this.selectorNeuronUpdate()
                
                setLocalJSON("connectome_path_neuron_data", data)
                setLocalStr("connectome_path_selected_dataset_str", valuesStr)

                // Execute the callback if provided
                if (callback) callback(data);
            })
            .catch((error) => console.error("Error fetching data:", error));
    }
    
    clearNeuronSelector() {
        for (const selector of [this.selectorNeuronStart, this.selectorNeuronEnd]) {
            selector.clear();
            selector.clearOptions();
        }
    }

    selectorNeuronUpdate() {
        this.clearNeuronSelector();
        const data = this.neuronData;
        if (this.switchClass.value) {
            // Add valid neuron classes
            for (const [neuronClass, neuronList] of Object.entries(data.neuron_classes)) {
                for (const selector of [this.selectorNeuronStart, this.selectorNeuronEnd]) {
                    selector.addOption({
                        name: neuronClass,
                        type: "class",
                        neurons: neuronList.join(","),
                    });
                }
            }
        } else {
            // Add valid neurons
            for (const [neuron, neuronDict] of Object.entries(data.neurons)) {
                for (const selector of [this.selectorNeuronStart, this.selectorNeuronEnd]) {
                    selector.addOption({
                        name: neuron,
                        type: "neuron",
                        neuron_class: neuronDict.neuron_class,
                        neurons: data.neuron_classes[neuronDict.neuron_class].join(","),
                    });
                }
            }
        }
    }

}

