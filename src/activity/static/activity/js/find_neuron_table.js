import { getDatasetTypePill, getCSRFToken } from '/static/core/js/utility.js';
import { URL_ROOT_ACTIVITY_DATA } from '/static/core/js/constants.js';

const plotMultipleURL = "/activity/plot-multiple-data/"

export class DatasetTable {
    constructor(tableElementId, data) {
        this.tableElementId = tableElementId
        this.tableElementSelector = `#${this.tableElementId}`
        this.data = data
        this.datasets = data.neuropal_datasets_data
        this.tableData = []
        this.matched = {}

        this.datasetIdToPaperAndUID = {}
        this.datasets.forEach(dataset => {
            this.datasetIdToPaperAndUID[dataset.dataset_id] = [dataset.paper.paper_id, dataset.dataset_name];
        })

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
        const $table = $(this.tableElementSelector);
        
        // 1. Apply the filter
        $table.bootstrapTable("filterBy", {paperId: valuePaper, matchDict: matchDict}, {
            filterAlgorithm: (row, filters) => {
                return filters.paperId.includes(row.paper_id) && (row.id in filters.matchDict);
            }
        });
    
        // 2. Gather all row updates first
        const updates = [];
        for (const [datasetId, neuronList] of Object.entries(matchDict)) {
            // Store in local matched cache
            this.matched[datasetId] = neuronList;
    
            // Prepare new action button HTML
            const urlPlot = `/activity/explore/${datasetId}/?n=${neuronList.join("-")}&b=v`;
            const urlData = `${URL_ROOT_ACTIVITY_DATA}${this.datasetIdToPaperAndUID[datasetId][0]}/${this.datasetIdToPaperAndUID[datasetId][1]}.json`
            const htmlBtn = `
                <div class="actions-column">
                    <a href="${urlPlot}" class="action-btn" title="Plot">
                        <i class="bi bi-graph-up"></i>
                    </a>
                    <a href="${urlData}" class="action-btn" title="Download">
                        <i class="bi bi-download"></i>
                    </a>
                </div>
            `;
    
            // Push update instructions
            updates.push({
                id: datasetId,
                row: { action: htmlBtn } // We only update the 'action' field
            });
        }
    
        // 3. Apply all updates in one go
        $table.bootstrapTable("updateByUniqueId", updates);
    
        // 4. (Re)bind the double-click event for row navigation
        $table
          .off("dbl-click-row.bs.table")
          .on("dbl-click-row.bs.table", (event, row) => {
              const id = row.id;
              const neuronList = this.matched[id];
              const neuronParam = (neuronList.length === 1) ? neuronList[0] : neuronList.join("-");
              window.location.href = `/activity/explore/${id}/?n=${neuronParam}&b=v`;
          });
    
        // 5. Finally, uncheck all rows
        $table.bootstrapTable("uncheckAll");
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
            const urlData = `${URL_ROOT_ACTIVITY_DATA}${option.paper_id}/${option.label}.json`
            this.downloadFile(urlData, `${option.paper_id}-${option.label}.json`)
        })
    }
}