import { ConnectomeGraph } from './connectome_graph.js';
import { CONNECTOME_DATASET_TYPE } from '/static/core/js/constants.js';
import { getLocalStr, setLocalJSON, setLocalStr, updateCitation } from '/static/core/js/utility.js';

const URL_AVAILABLE_NEURON = "/connectome/api/available-neurons/";
const DEFAULT_DATASET_LEFT = "cook_jarrell_2019_h";
const DEFAULT_DATASET_RIGHT = "cook_jarrell_2019_m";
const SHARED_KEY_PREFIX = "connectome_compare";

function toArray(value) {
    if (Array.isArray(value)) {
        return value;
    }
    if (typeof value === "string") {
        return value.length ? value.split(",") : [];
    }
    if (!value) {
        return [];
    }
    return [value];
}

function datasetExists(datasetId) {
    return datasets.some((dataset) => dataset.dataset_id === datasetId);
}

async function fetchAvailableNeurons(listDataset) {
    if (!listDataset.length) {
        return { neurons: {}, neuron_classes: {} };
    }

    const params = new URLSearchParams({ datasets: [...listDataset].sort().join(",") });
    const response = await fetch(`${URL_AVAILABLE_NEURON}?${params.toString()}`);
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }
    return response.json();
}

class CompareController {
    constructor() {
        this.panels = {
            left: {
                side: "left",
                selectorId: "compare-select-dataset-left",
                citationId: "compare-citation-left",
                datasetStorageKey: "connectome_compare_left_dataset",
                neuronDataStorageKey: "connectome_compare_left_neuron_data",
                graphId: "compare-graph-left",
                selector: null,
                graph: null,
                requestToken: 0,
            },
            right: {
                side: "right",
                selectorId: "compare-select-dataset-right",
                citationId: "compare-citation-right",
                datasetStorageKey: "connectome_compare_right_dataset",
                neuronDataStorageKey: "connectome_compare_right_neuron_data",
                graphId: "compare-graph-right",
                selector: null,
                graph: null,
                requestToken: 0,
            },
        };

        this.loadingStatusElement = null;
        this.loadingCount = 0;
        this.neuronSelector = null;
        this.neuronSelectorWasMouseSelect = false;
        this.neuronOptionsRequestToken = 0;
    }

    async init() {
        this.initTooltips();
        this.initLoadingStatus();
        this.initGraphs();
        this.initDatasetSelectors();
        this.initNeuronSelector();
        this.initButtons();
        await this.setInitialDatasets();
    }

    initTooltips() {
        const tooltipTriggerList = document.querySelectorAll('[data-bs-toggle="tooltip"]');
        [...tooltipTriggerList].forEach((el) => new bootstrap.Tooltip(el));
    }

    initLoadingStatus() {
        this.loadingStatusElement = document.getElementById("compare-loading-status");
    }

    setLoading(isLoading) {
        if (!this.loadingStatusElement) {
            return;
        }

        if (isLoading) {
            this.loadingCount += 1;
        } else {
            this.loadingCount = Math.max(0, this.loadingCount - 1);
        }

        this.loadingStatusElement.style.display = this.loadingCount > 0 ? "flex" : "none";
    }

    initGraphs() {
        const sharedGraphOptions = {
            switchIndividualId: "compare-switchIndividual",
            switchConnectedId: "compare-switchConnected",
            layoutDropdownId: "compare-dropdownLayout",
            colorDropdownId: "compare-dropdownColor",
            sliderSpacingId: "compare-sliderSpacing",
            sliderEdgeScaleId: "compare-sliderEdgeScale",
            thresholdIds: {
                e: { plus: "compare-plus-e", minus: "compare-minus-e", input: "compare-threshold-e" },
                c: { plus: "compare-plus-c", minus: "compare-minus-c", input: "compare-threshold-c" },
            },
            legendId: "compare-legend-modal-items",
            legendItemsId: "compare-legend-modal-items",
            downloadButtonId: "compare-download-unused",
            infoPanelEnabled: false,
        };

        this.panels.left.graph = new ConnectomeGraph(this.panels.left.graphId, SHARED_KEY_PREFIX, {
            ...sharedGraphOptions,
            neuronDataLocalKey: this.panels.left.neuronDataStorageKey,
        });

        this.panels.right.graph = new ConnectomeGraph(this.panels.right.graphId, SHARED_KEY_PREFIX, {
            ...sharedGraphOptions,
            neuronDataLocalKey: this.panels.right.neuronDataStorageKey,
        });

        const setSharedLoading = (show) => this.setLoading(show);
        this.panels.left.graph.toggleSpinner = setSharedLoading;
        this.panels.right.graph.toggleSpinner = setSharedLoading;
    }

    initDatasetSelectors() {
        Object.values(this.panels).forEach((panel) => {
            panel.selector = new TomSelect(`#${panel.selectorId}`, {
                options: datasets,
                optgroups: CONNECTOME_DATASET_TYPE,
                maxItems: 1,
                hidePlaceholder: true,
                optgroupField: "dataset_type",
                valueField: "dataset_id",
                labelField: "name",
                searchField: ["name", "description", "dataset_type"],
                sortField: [{ field: "name" }],
                create: false,
                plugins: ["dropdown_input"],
                onChange: (value) => this.handlePanelDatasetChange(panel, value),
                render: {
                    option: (data, escape) =>
                        `<div class="select_dataset_option">
                            <div class="select_dataset_name">${escape(data.name)}</div>
                            <span class="select_dataset_opt">${escape(data.description || "")}</span>
                        </div>`,
                    optgroup_header: (data, escape) =>
                        `<div class="optgroup-header"><strong>${escape(data.label)}</strong></div>`,
                },
            });
        });
    }

    initNeuronSelector() {
        this.neuronSelector = new TomSelect("#compare-select-neuron", {
            create: false,
            maxItems: null,
            valueField: "value",
            labelField: "name",
            searchField: ["name"],
            sortField: [{ field: "name" }],
            hidePlaceholder: true,
            maxOptions: null,
            plugins: {
                "n_items": {},
                "checkbox_options": {},
                "dropdown_input": {},
                "remove_button": { title: "Remove this neuron" },
            },
            onItemAdd: (value) => {
                this.handleNeuronAdd(value);

                this.neuronSelector.setTextboxValue("");
                this.neuronSelector.lastQuery = null;
                this.neuronSelector.refreshOptions(false);

                const usedMouse = this.neuronSelectorWasMouseSelect;
                this.neuronSelectorWasMouseSelect = false;
                if (!usedMouse) {
                    const firstOption = this.neuronSelector.dropdown_content?.querySelector(".option");
                    if (firstOption) {
                        this.neuronSelector.setActiveOption(firstOption);
                    }
                }
            },
            onItemRemove: (value) => this.handleNeuronRemove(value),
        });

        const dropdownEl = this.neuronSelector.dropdown;
        dropdownEl?.addEventListener("mousedown", () => { this.neuronSelectorWasMouseSelect = true; });
        dropdownEl?.addEventListener("touchstart", () => { this.neuronSelectorWasMouseSelect = true; });
    }

    initButtons() {
        const clearButton = document.getElementById("compare-clear-neurons");
        if (clearButton) {
            clearButton.addEventListener("click", () => this.neuronSelector.clear());
        }
    }

    async setInitialDatasets() {
        const leftInitial = getLocalStr(
            this.panels.left.datasetStorageKey,
            datasetExists(DEFAULT_DATASET_LEFT) ? DEFAULT_DATASET_LEFT : datasets[0]?.dataset_id || ""
        );
        const rightInitial = getLocalStr(
            this.panels.right.datasetStorageKey,
            datasetExists(DEFAULT_DATASET_RIGHT) ? DEFAULT_DATASET_RIGHT : leftInitial
        );

        if (leftInitial && datasetExists(leftInitial)) {
            this.panels.left.selector.setValue(leftInitial);
        }
        if (rightInitial && datasetExists(rightInitial)) {
            this.panels.right.selector.setValue(rightInitial);
        }

        await this.refreshSharedNeuronSelector();
        this.syncAllGraphManifests();
    }

    async handlePanelDatasetChange(panel, datasetId) {
        const dataset = datasetId || "";
        panel.graph.listDataset = dataset ? [dataset] : [];
        panel.graph.graph.elements().remove();
        panel.graph.jsonData = null;

        setLocalStr(panel.datasetStorageKey, dataset);
        updateCitation(dataset ? [dataset] : [""], panel.citationId, panel.selector.options);

        const requestToken = ++panel.requestToken;
        if (!dataset) {
            setLocalJSON(panel.neuronDataStorageKey, { neurons: {}, neuron_classes: {} });
            panel.graph.debouncedUpdateGraph();
            await this.refreshSharedNeuronSelector();
            return;
        }

        try {
            const neuronData = await fetchAvailableNeurons([dataset]);
            if (requestToken !== panel.requestToken) {
                return;
            }
            setLocalJSON(panel.neuronDataStorageKey, neuronData);
        } catch (error) {
            console.error(`Failed loading available neurons for ${panel.side} panel:`, error);
            setLocalJSON(panel.neuronDataStorageKey, { neurons: {}, neuron_classes: {} });
        }

        await this.refreshSharedNeuronSelector();
        this.syncAllGraphManifests();
    }

    getSelectedDatasets() {
        const left = this.panels.left.selector.getValue();
        const right = this.panels.right.selector.getValue();
        return [left, right].filter(Boolean);
    }

    async refreshSharedNeuronSelector() {
        const selectedDatasets = this.getSelectedDatasets();
        const requestToken = ++this.neuronOptionsRequestToken;

        if (!selectedDatasets.length) {
            this.neuronSelector.clear();
            this.neuronSelector.clearOptions();
            this.syncAllGraphManifests();
            return;
        }

        try {
            const availableNeuronData = await fetchAvailableNeurons(selectedDatasets);
            if (requestToken !== this.neuronOptionsRequestToken) {
                return;
            }
            this.updateNeuronSelectorOptions(availableNeuronData);
            this.syncAllGraphManifests();
        } catch (error) {
            console.error("Failed loading shared neuron options:", error);
        }
    }

    updateNeuronSelectorOptions(data) {
        const selectedValues = new Set(toArray(this.neuronSelector.getValue()));
        const currentOptions = this.neuronSelector.options;

        const availableNeurons = new Set(Object.keys(data.neurons || {}));
        const availableNeuronClasses = new Set(Object.keys(data.neuron_classes || {}));

        Object.entries(currentOptions).forEach(([optionId, option]) => {
            const notInNeurons = !availableNeurons.has(option.value);
            const notInClasses = !availableNeuronClasses.has(option.value);
            if (notInNeurons && notInClasses) {
                this.neuronSelector.removeOption(optionId);
            }
        });

        for (const [neuronName, neuronDict] of Object.entries(data.neurons || {})) {
            const neuronClass = neuronDict.neuron_class;
            if (!currentOptions[neuronName] && !selectedValues.has(neuronClass)) {
                this.neuronSelector.addOption({
                    name: neuronName,
                    value: neuronName,
                    type: "neuron",
                    neuron_class: neuronClass,
                    neurons: (data.neuron_classes?.[neuronClass] || []).join(","),
                });
            }
        }

        for (const [neuronClass, neuronList] of Object.entries(data.neuron_classes || {})) {
            if (!currentOptions[neuronClass]) {
                const allUnselected = neuronList.every((name) => !selectedValues.has(name));
                if (allUnselected) {
                    this.neuronSelector.addOption({
                        name: neuronClass,
                        value: neuronClass,
                        type: "class",
                        neurons: neuronList.join(","),
                    });
                }
            }
        }

        this.neuronSelector.refreshOptions(false);
    }

    handleNeuronAdd(value) {
        const selectedOption = this.neuronSelector.options[value];
        if (!selectedOption) {
            return;
        }

        if (selectedOption.type === "class") {
            selectedOption.neurons.split(",").forEach((neuron) => this.neuronSelector.removeOption(neuron));
        } else {
            const neuronNames = selectedOption.neurons.split(",");
            if (neuronNames.length > 1 && selectedOption.neuron_class) {
                this.neuronSelector.removeOption(selectedOption.neuron_class);
            }
        }

        this.syncAllGraphManifests();
    }

    handleNeuronRemove(value) {
        const options = this.neuronSelector.options;
        if (!(value in options)) {
            this.syncAllGraphManifests();
            return;
        }

        const removedOption = options[value];
        if (removedOption.type === "class") {
            removedOption.neurons.split(",").forEach((neuron) => {
                this.neuronSelector.addOption({
                    name: neuron,
                    value: neuron,
                    type: "neuron",
                    neuron_class: value,
                    neurons: removedOption.neurons,
                });
            });
        } else {
            const neuronList = removedOption.neurons.split(",");
            const selection = new Set(toArray(this.neuronSelector.getValue()));
            const classUnselected = neuronList.every((name) => !selection.has(name));
            if (classUnselected && removedOption.neuron_class) {
                this.neuronSelector.addOption({
                    name: removedOption.neuron_class,
                    value: removedOption.neuron_class,
                    type: "class",
                    neurons: removedOption.neurons,
                });
            }
        }

        this.syncAllGraphManifests();
    }

    syncAllGraphManifests() {
        const selectedValues = toArray(this.neuronSelector.getValue());
        const manifest = {};
        selectedValues.forEach((value) => {
            const option = this.neuronSelector.options[value];
            if (option) {
                manifest[value] = option.type === "class" ? "class" : "neuron";
            }
        });

        Object.values(this.panels).forEach((panel) => {
            panel.graph.manifest = { ...manifest };
            panel.graph.debouncedUpdateGraph();
        });
    }
}

document.addEventListener("DOMContentLoaded", async () => {
    const controller = new CompareController();
    await controller.init();
});
