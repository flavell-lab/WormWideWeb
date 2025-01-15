import { getEncodingTable } from "./encoding_utility.js"
import { roundNull } from '/static/core/js/utility.js'

export class EncodingTable {
    constructor(prefix, data, tableType="individual") {
        this.prefix = prefix
        this.tableElementId = `${this.prefix}_encodingTable`
        this.tableElement = document.getElementById(this.tableElementId)
        this.configureElementId = `${this.prefix}_collapseConfigure`
        this.configureElement = document.getElementById(this.configureElementId)
        this.encodingData = []

        if (tableType == "individual") {
            this.datasetId = data.dataset_id
            this.neuronData = data.neuron
        }

        if (tableType == "summary") {
            this.tableDataPromise = this.initTableDataSummary();
            this.tableDataPromise.then(() => {
                this.initTable()
                this.initButtons()
                
            }).catch(error => {
                console.error('Error initializing data:', error);
            });
        } else if (tableType == "individual") {
            this.tableDataPromise = this.initTableData();
            this.tableDataPromise.then(() => {
                this.initTable()
                this.initButtons()
                
            }).catch(error => {
                console.error('Error initializing data:', error);
            });
        } else if (tableType == "aggregate") {
            this.tableDataPromise = this.initTableDataAggregate();
            this.tableDataPromise.then(() => {
                this.initTable()
                this.initButtons()
                
            }).catch(error => {
                console.error('Error initializing data:', error);
            });
        } else {
            console.warn(`tableType of ${tableType} is not a correct option`)
        }
    }

    initButtons() {
        const buttonUpdateColumn = document.getElementById(`${this.prefix}_buttonUpdateColumn`)
        buttonUpdateColumn.addEventListener('click', () => {
            this.updateTableColumn()
        });

        const buttonSelectDefault = document.getElementById(`${this.prefix}_buttonSelectDefault`)
        buttonSelectDefault.addEventListener('click', () => {
            this.selectDefault()
        });

        const buttonAllV = document.getElementById(`${this.prefix}_button_v_all`)
        buttonAllV.addEventListener('click', () => {
            this.toggleV()
        });

        const buttonAllHc = document.getElementById(`${this.prefix}_button_hc_all`)
        buttonAllHc.addEventListener('click', () => {
            this.toggleHC()
        });

        const buttonAllf = document.getElementById(`${this.prefix}_button_f_all`)
        buttonAllf.addEventListener('click', () => {
            this.toggleF()
        });

        const buttonAllO = document.getElementById(`${this.prefix}_button_o_all`)
        buttonAllO.addEventListener('click', () => {
            this.toggleO()
        });
    }

    async initTableDataSummary() {
        // construct the new endpoint URL:
        const fullUrl = "/static/activity/data/encoding_table.json";

        try {
            const response = await fetch(fullUrl);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const data = await response.json();

            this.encodingData = []
            const n_neuron_class = data["class"].length
            for (let i = 0; i < n_neuron_class; i++) {
                this.encodingData.push(
                    {
                        "neuron": data["class"][i],
                        "count": data["count"][i],
                        "strength_v": roundNull(data["enc_strength_v"][i], 2),
                        "strength_hc": roundNull(data["enc_strength_hc"][i], 2),
                        "strength_feeding": roundNull(data["enc_strength_pumping"][i], 2),
                        "fwdness": roundNull(data["enc_v"][i], 2),
                        "dorsalness": roundNull(data["enc_hc"][i], 2),
                        "feedingness": roundNull(data["enc_pumping"][i], 2),
                        "ewma": roundNull(data["tau"][i], 2),
                        "enc_change": roundNull(data["encoding_variability"][i], 2),
        
                        "fwd": data["encoding_table"][i][0].toFixed(2),
                        "rev": data["encoding_table"][i][1].toFixed(2),
                        "fwd_slope_p": data["encoding_table"][i][2].toFixed(2),
                        "fwd_slope_n": data["encoding_table"][i][3].toFixed(2),
                        "rev_slope_p": data["encoding_table"][i][4].toFixed(2),
                        "rev_slope_n": data["encoding_table"][i][5].toFixed(2),
                        "slope_1": data["encoding_table"][i][6].toFixed(2),
                        "slope_2": data["encoding_table"][i][7].toFixed(2),
        
                        "dorsal": data["encoding_table"][i][8].toFixed(2),
                        "ventral": data["encoding_table"][i][9].toFixed(2),
                        "fd": data["encoding_table"][i][10].toFixed(2),
                        "fv": data["encoding_table"][i][11].toFixed(2),
                        "rd": data["encoding_table"][i][12].toFixed(2),
                        "rv": data["encoding_table"][i][13].toFixed(2),
                        "mdf": data["encoding_table"][i][14].toFixed(2),
                        "mvf": data["encoding_table"][i][15].toFixed(2),
        
                        "act": data["encoding_table"][i][16].toFixed(2),
                        "inh": data["encoding_table"][i][17].toFixed(2),
                        "fa": data["encoding_table"][i][18].toFixed(2),
                        "fi": data["encoding_table"][i][19].toFixed(2),
                        "ra": data["encoding_table"][i][20].toFixed(2),
                        "ri": data["encoding_table"][i][21].toFixed(2),
                        "maf": data["encoding_table"][i][22].toFixed(2),
                        "mif": data["encoding_table"][i][23].toFixed(2),
                    }
                )
            }
            this.encodingDataRaw = data;

            return true;
        } catch (error) {
            console.error("Error fetching or parsing encoding data:", error);
            throw error; // re-throw for the .catch in the constructor
        }
    }

    async initTableData() {
        const fullUrl = `/activity/api/data/${this.datasetId}/encoding/`;

        try {
            const response = await fetch(fullUrl);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const remoteData = await response.json();
            this.encodingDataRaw = remoteData
            this.encodingData = getEncodingTable(this.encodingDataRaw, this.neuronData)

            return true;
        } catch (error) {
            console.error("Error fetching or parsing encoding data:", error);
            throw error; // re-throw for the .catch in the constructor
        }
    }

    async initTableDataAggregate() {
        const fullUrl = `/activity/api/data/atanas_kim_2023_encoding/`;

        try {
            const response = await fetch(fullUrl);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const remoteData = await response.json();

            // data = []

            Object.keys(remoteData).forEach((datasetId) => {
                remoteData[datasetId].encoding["uid"] = datasetId

                const data = getEncodingTable(remoteData[datasetId].encoding,
                    remoteData[datasetId].neuron, true, true)

                data.forEach((neuron) => {
                    const urlPlot = `/activity/explore/${neuron.dataset}/?n=${neuron.id.split("_")[1]}&b=v`
                    const htmlBtn = `<div class="actions-column">
                            <a href="${urlPlot}" class="action-btn" title="Plot">
                                <i class="bi bi-graph-up"></i>
                            </a></div>`
                    neuron.action = htmlBtn
                    this.encodingData.push(neuron)
                })
                // this.encodingData.push(...getEncodingTable(remoteData[datasetId].encoding,
                //     remoteData[datasetId].neuron, true))
            })

            return true;
        } catch (error) {
            console.error("Error fetching or parsing encoding data:", error);
            throw error; // re-throw for the .catch in the constructor
        }
    }

    rowStyle(row, index) {
        return {
            css: {'font-size': "14px"},
        // classes: 'table_exsm'
        }
    }
    
    headerStyle(column) {
        return {
            css: {'font-size': "14px", "font-weight": "bold"},
        //   classes: 'table_exsm'
        }
    }

    initTable() {
        $(this.tableElement).bootstrapTable({
            data: this.encodingData,
            classes: "table-sm table-material",
            rowStyle: this.rowStyle,
            headerStyle: this.headerStyle,
            // checkboxHeader: false,
        });        
    }

    // table UI control
    toggleColumn(checkId, columnName) {
        const check = this.configureElement.querySelector(`#${checkId}`)
        if (check.checked) {
            $(this.tableElement).bootstrapTable('showColumn', columnName);
        } else {
            $(this.tableElement).bootstrapTable('hideColumn', columnName);
        }
    }

    toggleChecks(listCheckId, check) {
        listCheckId.forEach((checkId) => {
            this.configureElement.querySelector(`#${checkId}`).checked = check
        })
    }    
    
    updateTableColumn() {
        // v
        this.toggleColumn(`${this.prefix}_check_v_s`, "strength_v")
        this.toggleColumn(`${this.prefix}_check_v_fwdness`, "fwdness")
        this.toggleColumn(`${this.prefix}_check_v_fwd`, "fwd")
        this.toggleColumn(`${this.prefix}_check_v_rev`, "rev")
        this.toggleColumn(`${this.prefix}_check_fwd_slope_p`, "fwd_slope_p")
        this.toggleColumn(`${this.prefix}_check_fwd_slope_n`, "fwd_slope_n")
        this.toggleColumn(`${this.prefix}_check_rev_slope_p`, "rev_slope_p")
        this.toggleColumn(`${this.prefix}_check_rev_slope_n`, "rev_slope_n")
        this.toggleColumn(`${this.prefix}_check_slope_1`, "slope_1")
        this.toggleColumn(`${this.prefix}_check_slope_2`, "slope_2")

        // hc
        this.toggleColumn(`${this.prefix}_check_hc_s`, "strength_hc")
        this.toggleColumn(`${this.prefix}_check_hc_dorsalness`, "dorsalness")
        this.toggleColumn(`${this.prefix}_check_hc_dorsal`, "dorsal")
        this.toggleColumn(`${this.prefix}_check_hc_ventral`, "ventral")
        this.toggleColumn(`${this.prefix}_check_hc_fd`, "fd")
        this.toggleColumn(`${this.prefix}_check_hc_fv`, "fv")
        this.toggleColumn(`${this.prefix}_check_hc_rd`, "rd")
        this.toggleColumn(`${this.prefix}_check_hc_rv`, "rv")
        this.toggleColumn(`${this.prefix}_check_hc_mdf`, "mdf")
        this.toggleColumn(`${this.prefix}_check_hc_mvf`, "mvf")

        // feeding
        this.toggleColumn(`${this.prefix}_check_f_strength`, "strength_feeding")
        this.toggleColumn(`${this.prefix}_check_feedness`, "feedingness")
        this.toggleColumn(`${this.prefix}_check_f_act`, "act")
        this.toggleColumn(`${this.prefix}_check_f_inh`, "inh")
        this.toggleColumn(`${this.prefix}_check_f_fa`, "fa")
        this.toggleColumn(`${this.prefix}_check_f_fi`, "fi")
        this.toggleColumn(`${this.prefix}_check_f_ra`, "ra")
        this.toggleColumn(`${this.prefix}_check_f_ri`, "ri")
        this.toggleColumn(`${this.prefix}_check_f_maf`, "maf")
        this.toggleColumn(`${this.prefix}_check_f_mif`, "mif")
        
        // other
        this.toggleColumn(`${this.prefix}_check_o_ewma`, "ewma")
        this.toggleColumn(`${this.prefix}_check_o_enc_change`, "enc_change")
    }

    selectDefault() {
        const allChecks = this.configureElement.getElementsByClassName("form-check-input")
        for (var i = 0; i < allChecks.length; i++) {
            allChecks[i].checked = false
        }
    
        const listCheckId = [`${this.prefix}_check_v_fwd`, `${this.prefix}_check_v_rev`, `${this.prefix}_check_hc_dorsal`, `${this.prefix}_check_hc_ventral`,
            `${this.prefix}_check_f_act`, `${this.prefix}_check_f_inh`, `${this.prefix}_check_o_ewma`]
        this.toggleChecks(listCheckId, true)

        this.updateTableColumn()
    }

    toggleV() {
        const button_v_all = this.configureElement.querySelector(`#${this.prefix}_button_v_all`)

        let listCheckId = [`${this.prefix}_check_v_fwdness`, `${this.prefix}_check_v_fwd`, `${this.prefix}_check_v_rev`, `${this.prefix}_check_v_s`,
            `${this.prefix}_check_fwd_slope_p`, `${this.prefix}_check_fwd_slope_n`, `${this.prefix}_check_rev_slope_p`, `${this.prefix}_check_rev_slope_n`,
            `${this.prefix}_check_slope_1`, `${this.prefix}_check_slope_2`]


        if (button_v_all.innerHTML.replace(/\s+/g, '') == "SelectAll") {
            button_v_all.innerHTML = "Deselect All"
            this.toggleChecks(listCheckId, true)
        } else {
            button_v_all.innerHTML = "Select All"
            this.toggleChecks(listCheckId, false)
        }
    }

    toggleHC(parent) {
        var control = document.getElementById(parent)
        var button_hc_all = this.configureElement.querySelector(`#${this.prefix}_button_hc_all`)

        let list_check_id = [`${this.prefix}_check_hc_s`, `${this.prefix}_check_hc_dorsalness`, `${this.prefix}_check_hc_dorsal`, `${this.prefix}_check_hc_ventral`,
            `${this.prefix}_check_hc_fd`, `${this.prefix}_check_hc_fv`, `${this.prefix}_check_hc_rd`, `${this.prefix}_check_hc_rv`,
            `${this.prefix}_check_hc_mdf`, `${this.prefix}_check_hc_mvf`]

        if (button_hc_all.innerHTML.replace(/\s+/g, '') == "SelectAll") {
            button_hc_all.innerHTML = "Deselect All"
            this.toggleChecks(list_check_id, true)
        } else {
            button_hc_all.innerHTML = "Select All"
            this.toggleChecks(list_check_id, false)   
        }
    }

    toggleF(parent) {
        var control = document.getElementById(parent)
        var button_f_all = this.configureElement.querySelector(`#${this.prefix}_button_f_all`)

        let list_check_id = [`${this.prefix}_check_f_strength`, `${this.prefix}_check_feedness`, `${this.prefix}_check_f_act`, `${this.prefix}_check_f_inh`,
            `${this.prefix}_check_f_fa`, `${this.prefix}_check_f_fi`, `${this.prefix}_check_f_ra`, `${this.prefix}_check_f_ri`,
            `${this.prefix}_check_f_maf`, `${this.prefix}_check_f_mif`]

        if (button_f_all.innerHTML.replace(/\s+/g, '') == "SelectAll") {
            button_f_all.innerHTML = "Deselect All"
            this.toggleChecks(list_check_id, true)
        } else {
            button_f_all.innerHTML = "Select All"
            this.toggleChecks(list_check_id, false)
        }
    }

    toggleO(parent) {
        var control = document.getElementById(parent)
        var button_o_all = this.configureElement.querySelector(`#${this.prefix}_button_o_all`)

        let list_check_id = [`${this.prefix}_check_o_ewma`, `${this.prefix}_check_o_enc_change`]

        if (button_o_all.innerHTML.replace(/\s+/g, '') == "SelectAll") {
            button_o_all.innerHTML = "Deselect All"
            this.toggleChecks(list_check_id, true)
        } else {
            button_o_all.innerHTML = "Select All"
            this.toggleChecks(list_check_id, false)
        }
    }
}