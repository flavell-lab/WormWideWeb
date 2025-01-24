import { getDatasetTypePill } from '/static/core/js/utility.js';

export class DatasetTable {
    constructor(tableElementId, data) {
        this.tableElementId = tableElementId
        this.tableElementSelector = `#${this.tableElementId}`
        this.data = data
        this.tableData = []

        this.initTable()
    }
    
    initTable() {
        this.data.forEach(dataset => {
            this.tableData.push({
                paper: dataset.paper.title,
                paper_id: dataset.paper.paper_id,
                id: dataset.dataset_id,
                label: dataset.dataset_id,
                dataset_type: dataset.dataset_type.map(dtype=>getDatasetTypePill(dtype)).join(" "),
                dataset_type_raw: dataset.dataset_type.join(","),
                n_neuron: dataset.n_neuron,
                n_labeled: dataset.n_labeled,
                length: (dataset.max_t * dataset.avg_timestep).toFixed(1),
                action: ""
            })
        });

        // init table
        $(this.tableElementSelector).bootstrapTable({
            data: this.tableData,
            classes: "table-sm table-material",            
        });

        // modify rows
        this.tableData.forEach((dataset) => {
            // update buttons urls
            const urlPlot = `/activity/explore/${dataset.id}/?n=1-2-3&b=v-hc`
            const urlData = `/static/data/${dataset.id}.json`
            
            const htmlBtn = `<div class="actions-column">
                    <a href="${urlPlot}" class="action-btn" title="Plot">
                        <i class="bi bi-graph-up"></i>
                    </a>
                    <a href="${urlData}" class="action-btn" title="Download"">
                        <i class="bi bi-download"></i>
                    </a>
                </div>`
            $(this.tableElementSelector).bootstrapTable('updateCellByUniqueId', {
                id: dataset.id,
                field: 'action',
                value: htmlBtn,
                reinit: false
            })
        })

        // double click links to plot
        $(this.tableElementSelector).on("dbl-click-row.bs.table", function (row, $element, field) {
            const id = $element.id
            window.location.href = `/activity/explore/${id}/?n=1-2-3&b=v-hc`
        });

        this.allRows = $(this.tableElementSelector).bootstrapTable('getData'); // Get all rows
    }

    updateMatch(valueDatasetType, valuePaper) {
        $(this.tableElementSelector).bootstrapTable("filterBy", { dataset_type_raw: valueDatasetType, paper_id: valuePaper }, {
            "filterAlgorithm": (row, filters) => {
                return filters.paper_id.includes(row.paper_id) &&
                    filters.dataset_type_raw.split(",").every(dtype => row.dataset_type_raw.includes(dtype))
            }
        })
    }

    getSelected() {
        return $(this.tableElementSelector).bootstrapTable("getSelections")
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
        selected.forEach((option) => {
            const urlData = `/static/data/${option.id}.json`
            this.downloadFile(urlData, `${option.id}.json`)
        })
    }   
}