import { getDatasetTypePill, getCSRFToken } from '/static/core/js/utility.js';

const plotMultipleURL = "/activity/plot-multiple-data/"

export class DatasetTable {
    constructor(tableElementId, data) {
        this.tableElementId = tableElementId
        this.tableElementSelector = `#${this.tableElementId}`
        this.data = data
        this.datasets = data.neuropal_datasets_data
        this.tableData = []
        this.matched = {}

        this.initTable()
    }

    initTable() {
        this.datasets.forEach(dataset => {
            this.tableData.push({
                id: dataset.dataset_id,
                label: dataset.dataset_name,
                paper_id: dataset.paper.paper_id,
                paper: dataset.paper.title,
                dataset_type: dataset.dataset_type.map(typeId => getDatasetTypePill(typeId, this.data.neuropal_dataset_type)).join(" "),
                n_neuron: dataset.n_neuron,
                n_labeled: dataset.n_labeled,
                action: ""
            })
        });

        // init table
        $(this.tableElementSelector).bootstrapTable({
            data: this.tableData,
            classes: "table table-sm table-material",
        });

        // hide rows
        this.tableData.forEach((data) => {
            $(this.tableElementSelector).bootstrapTable("hideRow", { uniqueId: data.id });
        })
    }

    updateMatch(matchDict, valuePaper) {
        $(this.tableElementSelector).bootstrapTable("filterBy", {}, {
            "filterAlgorithm": (row, filters) => {
                return valuePaper.includes(row.paper_id) && row.id in matchDict
            }
        })

        Object.keys(matchDict).forEach((datasetId) => {
            this.matched[datasetId] = matchDict[datasetId]

            const listIdxNeuron = matchDict[datasetId]

            // update buttons urls
            const urlPlot = `/activity/explore/${datasetId}/?n=${listIdxNeuron.join("-")}&b=v`
            const urlData = `/static/activity/data/${datasetId}.json`
            const htmlBtn = `<div class="actions-column">
                    <a href="${urlPlot}" class="action-btn" title="Plot">
                        <i class="bi bi-graph-up"></i>
                    </a>
                    <a href="${urlData}" class="action-btn" title="Download"">
                        <i class="bi bi-download"></i>
                    </a>
                </div>`
            $(this.tableElementSelector).bootstrapTable('updateCellByUniqueId', {
                id: datasetId,
                field: 'action',
                value: htmlBtn,
                reinit: true
            })
        })

        // double click links to plot
        $(this.tableElementSelector).off("dbl-click-row.bs.table")
        $(this.tableElementSelector).on("dbl-click-row.bs.table", (row, $element, field) => {
            const id = $element.id
            const neuronList = this.matched[id];
            const neuronParam = neuronList.length === 1 ? neuronList[0] : neuronList.join("-");
            window.location.href = `/activity/explore/${id}/?n=${neuronParam}&b=v`;
        });

        $(this.tableElementSelector).bootstrapTable("uncheckAll")
    }

    getSelected() {
        return $(this.tableElementSelector).bootstrapTable("getSelections")
    }

    plotSelected() {
        const selected = this.getSelected()
        if (selected.length == 0) {
            alert("Please select at least one dataset to plot.")
            return
        }

        if (selected.length > 50) {
            alert("You can only plot up to 50 datasets at a time (currently selected: " + selected.length + ")")
            return
        }

        if (selected.length > 20 && !window.confirm("Plotting more than 20 datasets may take a few seconds if your connection is slow, and your browser will consume more memory.\nAre you sure you want to continue?")) {
            return
        }

        const postData = {}
        selected.forEach((option) => {
            postData[option.id] = this.matched[option.id]
        })

        // request data
        fetch(plotMultipleURL, {
            method: 'POST', // HTTP method
            headers: {
                'Content-Type': 'application/json', // Tell the server it's JSON
                'X-CSRFToken': getCSRFToken() // Include CSRF token for security if needed
            },
            body: JSON.stringify(postData) // Convert the JavaScript object to JSON
        })
            .then(response => {
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                return response.json()
            })
            .then(data => {
                window.location.href = data.redirect
            })
            .catch(error => console.error('Error:', error));
    }

    downloadFile(url, fileName) {
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    downloadSelected() {
        const selected = this.getSelected()

        if (selected.length == 0) {
            alert("Please select at least one dataset to download.")
            return
        }

        selected.forEach((option) => {
            const urlData = `/static/data/${option.id}.json`
            this.downloadFile(urlData, `${option.id}.json`)
        })
    }
}