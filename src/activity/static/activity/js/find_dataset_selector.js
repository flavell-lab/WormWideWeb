export class DatasetSelector {
    constructor(selectorId, table, datasetTypes) {
        // Retrieve the selector element by ID and ensure it exists
        this.selectorElement = document.getElementById(selectorId);
        if (!this.selectorElement) {
            throw new Error(`Element with ID "${selectorId}" not found.`);
        }

        this.tableManager = table
        this.datasetShortNameMap = {
            "gfp": "GFP",
            "baseline": "Baseline",
            "neuropal": "NeuroPAL",
            "heat": "Heat",
        }

        // generate options
        const options = [];
        datasetTypes.forEach((dtype) => {
            options.push({
                value: dtype,
                name: this.datasetShortNameMap[dtype]
            })
        });

        // Initialize the TomSelect selector
        this.selector = this.initSelector();
        this.selector.addOptions(options)
    }

    initSelector() {
        return new TomSelect(this.selectorElement, {
            plugins: ['n_items', 'checkbox_options', 'dropdown_input'],
            persist: false,
            create: false,
            maxOptions: null,
            sortField: [{ field: "name" }],
            valueField: "value",
            labelField: "name",
            searchField: ["name"],
            onChange: this.selectorChange.bind(this),
            // onClear: () => this.selectorDataset.close(),
        });    
    }

    selectorChange(value) {
        this.tableManager.updateMatch(value.split(","))
    }

    clearSelector() {
        this.selector.clear();
    }
}
