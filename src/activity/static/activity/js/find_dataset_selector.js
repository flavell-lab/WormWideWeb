export class PaperDatasetSelector {
    constructor(selectorDatasetId, selectorPaperId, table, datasetTypes, papers) {
        // get elements
        this.selectorDatasetElement = document.getElementById(selectorDatasetId);
        if (!this.selectorDatasetElement) {
            throw new Error(`Element with ID "${selectorDatasetId}" not found.`);
        }
        this.selectorPaperElement = document.getElementById(selectorPaperId);
        if (!this.selectorPaperElement) {
            throw new Error(`Element with ID "${selectorPaperId}" not found.`);
        }

        this.tableManager = table

        // generate options
        const options = [];
        Object.keys(datasetTypes).forEach((typeId) => {
            options.push({
                value: datasetTypes[typeId].type_id,
                name: datasetTypes[typeId].name
            })
        });

        this.selectorDataset = this.initSelectorDataset();
        this.selectorDataset.addOptions(options)

        /*
            Papers selector
        */
        const optionsPaper = [];
        papers.forEach((paper) => {
            optionsPaper.push({
                value: paper.paper_id,
                name: paper.title
            })
        });

        this.selectorPaper = this.initSelectorPaper();
        this.selectorPaper.addOptions(optionsPaper)
    }

    initSelectorPaper() {
        return new TomSelect(this.selectorPaperElement, {
            plugins: ['n_items', 'checkbox_options', 'dropdown_input'],
            persist: false,
            create: false,
            maxOptions: null,
            sortField: [{ field: "name" }],
            valueField: "value",
            labelField: "name",
            searchField: ["name"],
            onChange: this.selectorChange.bind(this),
        });
    }

    initSelectorDataset() {
        return new TomSelect(this.selectorDatasetElement, {
            plugins: ['n_items', 'checkbox_options', 'dropdown_input'],
            persist: false,
            create: false,
            maxOptions: null,
            sortField: [{ field: "name" }],
            valueField: "value",
            labelField: "name",
            searchField: ["name"],
            onChange: this.selectorChange.bind(this),
        });    
    }

    selectorChange(value) {
        const valueDataset = this.selectorDataset.getValue()
        const valuePaper = this.selectorPaper.getValue()
        this.tableManager.updateMatch(valueDataset, valuePaper)
    }

    clearSelector() {
        this.selectorDataset.clear();
        this.selectorPaper.clear();
    }
}
