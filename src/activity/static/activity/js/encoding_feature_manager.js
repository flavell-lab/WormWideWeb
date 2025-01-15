import { getEncodingTable } from "./encoding_utility.js"
import { roundNull } from '/static/core/js/utility.js'
import { PLOTLY_COLOR_SCALES, getInterpolatedColor, createVerticalColorBar } from '/static/core/js/colorscale.js'

export class EncodingFeatureManager {
    constructor(graphParent, selectorId, matchData) {
        this.graphParent = graphParent;
        graphParent.updateNodeColorUponDraw = true;

        this.matchData = matchData; // map from connectome neuron to encoding table class

        // selector
        this.selectorId = selectorId;
        this.selectorElement = document.getElementById(selectorId);
        this.initializeSelector();

        // color map UI
        this.vminInputElement = document.getElementById('vminInput');
        this.vmaxInputElement = document.getElementById('vmaxInput');
        this.colormapSelectElement = document.getElementById('colormapSelect');
        this.updateFeatureButton = document.getElementById('updateFeature');

        // add colormap options
        Object.keys(PLOTLY_COLOR_SCALES).forEach(value=>{
            const optionObj = new Option(value, value);
            this.colormapSelectElement.add(optionObj);
        })

        this.tableDataPromise = this.initTableDataSummary();
        this.tableDataPromise.then(() => {
            this.initUpdateButton()

            this.graphParent.drawGraphCallback = () => {
                
                const featureKey = this.selector.getValue()
                if (featureKey) {
                    document.getElementById("connectome-legend-cbar").classList.remove("d-none")
                    document.getElementById("connectome-legend").style.display = "none"
                    this.applyFeatureColor(featureKey)
                }    
            }

        }).catch(error => {
            console.error('Error initializing data:', error);
        });
    }

    initUpdateButton() {
        this.updateFeatureButton.addEventListener('click', () => {
            const featureKey = this.selector.getValue()
            if (featureKey) {
                document.getElementById("connectome-legend-cbar").classList.remove("d-none")
                document.getElementById("connectome-legend").style.display = "none"
                this.applyFeatureColor(featureKey)
            }
        })
    }

    updateColorBar(colorMin, colorMid, colorMax) {
        const colorScale = [
            [0.0, colorMin],
            [0.5, colorMid],
            [1.0, colorMax]
        ];

        createVerticalColorBar("colorBar", colorScale);
    }

    applyFeatureColor(featureKey) {
        const vmin = Number.parseFloat(this.vminInputElement.value)
        const vmax = Number.parseFloat(this.vmaxInputElement.value)
        const colormapName = this.colormapSelectElement.value

        const colorPie = {}
        const colorBackground = {}
        const nodeIdData = []

        const nodes = this.graphParent.graph.nodes()
        nodes.forEach(node => {
            const id = node.data("id")
            const cellType = node.data("cell_type")

            const colorMin = this.getNodeColor(0, 0, 1, colormapName)
            const colorMid = this.getNodeColor(0.5, 0, 1, colormapName)
            const colorMax = this.getNodeColor(1, 0, 1, colormapName)
            this.updateColorBar(colorMin, colorMid, colorMax)

            document.getElementById('tick-max').textContent = vmax.toFixed(3);
            document.getElementById('tick-mid').textContent = ((vmax+vmin)/2).toFixed(3);
            document.getElementById('tick-min').textContent = vmin.toFixed(3);

            if (id in this.matchData) {
                const matchKey = this.matchData[id]
                const value = this.encodingData[matchKey][featureKey]

                const color = value ? this.getNodeColor(value, vmin, vmax, colormapName) : "rgb(255,255,255)"

                if (["u", "b"].includes(cellType)) {
                    colorBackground[id] = color;
                } else {
                    colorPie[id] = [color];
                }

                nodeIdData.push(id)
            } else {
                if (["u", "b"].includes(cellType)) {
                    colorBackground[id] = "rgb(255,255,255)";
                } else {
                    colorPie[id] = ["rgb(255,255,255)"];
                }
            }
        });

        this.graphParent.nodeManager.removeAllNodeOutline();
        this.graphParent.nodeManager.addNodeOutline(nodeIdData, 4, "black");

        this.graphParent.nodeManager.setNodePieChartColors(colorPie);
        this.graphParent.nodeManager.setNodeColors(colorBackground);
        this.graphParent.nodeManager.adjustNodeLabelColor(colorPie, colorBackground)
    }

    getNodeColor(value, vmin, vmax, colormapName) {
        const normalized = (value - vmin) / (vmax - vmin)
        const ratio = Math.max(0, Math.min(1, normalized))
        const color = getInterpolatedColor(PLOTLY_COLOR_SCALES[colormapName], ratio);

        return color;
    }

    initializeSelector() {
        const options = [
            // --- Velocity encoding ---
            { behavior: "v", value: "strength_v",    name: "Velocity strength",  desc: "Velocity encoding strength" },
            { behavior: "v", value: "fwdness",       name: "Forwardness",        desc: "Forwardness" },
            { behavior: "v", value: "fwd",           name: "Forward",            desc: "Forward tuning" },
            { behavior: "v", value: "rev",           name: "Reverse",            desc: "Reverse tuning" },
            { behavior: "v", value: "fwd_slope_p",   name: "Fwd slope +",        desc: "Positive slope during forward" },
            { behavior: "v", value: "fwd_slope_n",   name: "Fwd slope -",        desc: "Negative slope during Forward" },
            { behavior: "v", value: "rev_slope_p",   name: "Rev slope +",        desc: "Positive slope during reverse" },
            { behavior: "v", value: "rev_slope_n",   name: "Rev slope -",        desc: "Negative slope during reverse" },
            { behavior: "v", value: "slope_1",       name: "Fwd slope > Rev slope", desc: "Tuning curve slope greater during forward" },
            { behavior: "v", value: "slope_2",       name: "Fwd slope < Rev slope", desc: "Tuning curve slope greater during reverse" },
          
            // --- Head curvature encoding ---
            { behavior: "hc", value: "strength_hc",  name: "Head curvature strength",           desc: "Head curvature encoding strength" },
            { behavior: "hc", value: "dorsalness",   name: "Dorsalness",         desc: "Dorsalness" },
            { behavior: "hc", value: "dorsal",       name: "Dorsal",             desc: "Dorsal tuning" },
            { behavior: "hc", value: "ventral",      name: "Ventral",            desc: "Ventral tuning" },
            { behavior: "hc", value: "fd",           name: "Dorsal during F",    desc: "Dorsal during forward" },
            { behavior: "hc", value: "fv",           name: "Ventral during F",   desc: "Ventral during forward" },
            { behavior: "hc", value: "rd",           name: "Dorsal during R",    desc: "Dorsal during reverse" },
            { behavior: "hc", value: "rv",           name: "Ventral during R",   desc: "Ventral during reverse" },
            { behavior: "hc", value: "mdf",          name: "More D during F",    desc: "More dorsal during forward" },
            { behavior: "hc", value: "mvf",          name: "More V during F",    desc: "More ventral during forward" },
          
            // --- Feeding encoding ---
            { behavior: "f", value: "strength_feeding",  name: "Feeding strength", desc: "Feeding encoding strength" },
            { behavior: "f", value: "feedingness",       name: "Feedingness",    desc: "Feedingness" },
            { behavior: "f", value: "act",               name: "Activated",      desc: "Feeding activated" },
            { behavior: "f", value: "inh",               name: "Inhibited",      desc: "Feeding inhibited" },
            { behavior: "f", value: "fa",                name: "Act during F",   desc: "Activated during forward" },
            { behavior: "f", value: "fi",                name: "Inh during F",   desc: "Inhibited during forward" },
            { behavior: "f", value: "ra",                name: "Act during R",   desc: "Activated during reverse" },
            { behavior: "f", value: "ri",                name: "Inh during R",   desc: "Inhibited during reverse" },
            { behavior: "f", value: "maf",               name: "More A during F",desc: "More feeding activated during forward" },
            { behavior: "f", value: "mif",               name: "More I during F",desc: "More feeding inhibited during forward" },
          
            // --- Others ---
            { behavior: "o", value: "ewma",         name: "Timescale", desc: "EWMA decay constant" },
            { behavior: "o", value: "enc_change",   name: "Encoding variability", desc: "Encoding var" },
        ];

        this.selector = new TomSelect(this.selectorElement, {
            options: options,
            optgroups: [
                { value: "v", label: "Velocity" },
                { value: "hc", label: "Head curvature" },
                { value: "f", label: "Feeding" },
                { value: "o", label: "Others" },
            ],
            plugins: ['dropdown_input'],
            create: false,
            maxItems: 1,

            optgroupField: "behavior",
            valueField: "value",
            labelField: "name",
            searchField: ["name", "desc"],
            // sortField: [{ field: "name" }],
            // onChange: (valuesStr) => this.selectorDatasetUpdate(valuesStr),
            // // onClear: () => this.selectorDataset.close(),
            render: {
                option: (data, escape) => {
                    return `<div>${escape(data.name)}<br><span class="select_dataset_opt">${data.desc}</span></div>`
                    },
                optgroup_header: (data, escape) =>
                    `<div class="optgroup-header"><strong>${escape(data.label)}</strong></div>`,
            },
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

            this.encodingData = {}
            const n_neuron_class = data["class"].length
            for (let i = 0; i < n_neuron_class; i++) {
                this.encodingData[data["class"][i]] = {
                    "neuron": data["class"][i],
                    "count": data["count"][i],
                    "strength_v": data["enc_strength_v"][i],
                    "strength_hc": data["enc_strength_hc"][i],
                    "strength_feeding": data["enc_strength_pumping"][i],
                    "fwdness": data["enc_v"][i],
                    "dorsalness": data["enc_hc"][i],
                    "feedingness": data["enc_pumping"][i],
                    "ewma": data["tau"][i],
                    "enc_change": data["encoding_variability"][i],

                    "fwd": data["encoding_table"][i][0],
                    "rev": data["encoding_table"][i][1],
                    "fwd_slope_p": data["encoding_table"][i][2],
                    "fwd_slope_n": data["encoding_table"][i][3],
                    "rev_slope_p": data["encoding_table"][i][4],
                    "rev_slope_n": data["encoding_table"][i][5],
                    "slope_1": data["encoding_table"][i][6],
                    "slope_2": data["encoding_table"][i][7],

                    "dorsal": data["encoding_table"][i][8],
                    "ventral": data["encoding_table"][i][9],
                    "fd": data["encoding_table"][i][10],
                    "fv": data["encoding_table"][i][11],
                    "rd": data["encoding_table"][i][12],
                    "rv": data["encoding_table"][i][13],
                    "mdf": data["encoding_table"][i][14],
                    "mvf": data["encoding_table"][i][15],

                    "act": data["encoding_table"][i][16],
                    "inh": data["encoding_table"][i][17],
                    "fa": data["encoding_table"][i][18],
                    "fi": data["encoding_table"][i][19],
                    "ra": data["encoding_table"][i][20],
                    "ri": data["encoding_table"][i][21],
                    "maf": data["encoding_table"][i][22],
                    "mif": data["encoding_table"][i][23],
                }
            }
            this.encodingDataRaw = data;

            return true;
        } catch (error) {
            console.error("Error fetching or parsing encoding data:", error);
            throw error; // re-throw for the .catch in the constructor
        }
    }


}