import { ConnectomeGraph } from './connectome_graph.js';
import { CONNECTOME_DATASET_TYPE } from '/static/core/js/constants.js';
import { getLocalStr, setLocalJSON, setLocalStr, updateCitation, initDropdown } from '/static/core/js/utility.js';

const URL_AVAILABLE_NEURON = "/connectome/api/available-neurons/";
const DEFAULT_DATASET_LEFT = "cook_jarrell_2019_h";
const DEFAULT_DATASET_RIGHT = "cook_jarrell_2019_m";
const SHARED_KEY_PREFIX = "connectome_compare";
const STORAGE_DIFF_MODE = "connectome_compare_diff_mode";

const DIFF_MODE_OFF = "off";
const DIFF_MODE_HIGHLIGHT = "highlight";
const DIFF_MODE_ONLY = "only";

// Matplotlib/Plotly default categorical colors: C0, C1
const DIFF_COLOR_LEFT = "#1f77b4";  // C0
const DIFF_COLOR_RIGHT = "#ff7f0e"; // C1
const DIFF_COLOR_SHARED = "#94a3b8";

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
        this.diffMode = getLocalStr(STORAGE_DIFF_MODE, DIFF_MODE_HIGHLIGHT);
        this.diffApplyScheduled = false;
        this.lastAppliedDiffMode = DIFF_MODE_OFF;
        this.diffLegendElement = null;
        this.diffLegendNoteElement = null;
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

        this.panels.left.graph.drawGraphCallback = () => this.scheduleApplyDiffMode();
        this.panels.right.graph.drawGraphCallback = () => this.scheduleApplyDiffMode();
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

        this.initDownloadMenu();
        this.initDiffModeControl();
        this.initColorDropdownCancelsDiff();
        this.initDiffModeRefreshTriggers();
    }

    initDownloadMenu() {
        const downloadItems = document.querySelectorAll(".compare-download-option");
        if (!downloadItems.length) {
            return;
        }

        downloadItems.forEach((item) => {
            item.addEventListener("click", () => {
                const side = item.dataset.side;
                const format = item.dataset.format;
                const panel = side ? this.panels[side] : null;
                const panelGraph = panel?.graph;

                if (!panelGraph) {
                    alert("Cannot download graph");
                    return;
                }

                if (format === "data") {
                    if (panelGraph.jsonData !== null) {
                        panelGraph.downloadEdgeJSON(
                            panelGraph.jsonData,
                            `wormwideweb connectome ${side} data.json`
                        );
                    } else {
                        alert("Cannot download data");
                    }
                    return;
                }

                if (format === "png") {
                    panelGraph.downloadGraphPNG(`wormwideweb connectome ${side} plot.png`);
                    return;
                }

                if (format === "svg") {
                    panelGraph.downloadGraphSVG(`wormwideweb connectome ${side} plot.svg`);
                }
            });
        });
    }

    initDiffModeControl() {
        this.diffLegendElement = document.getElementById("compare-diff-legend");
        this.diffLegendNoteElement = document.getElementById("compare-diff-legend-note");

        initDropdown(
            "compare-dropdownDiff",
            (value) => this.setDiffMode(value, { syncUI: true }),
            false,
            this.diffMode
        );

        this.syncDiffDropdownUI();
        this.updateDiffLegendVisibility();
    }

    initColorDropdownCancelsDiff() {
        const colorMenu = document.querySelector('.dropdown-menu[aria-labelledby="compare-dropdownColor"]');
        if (!colorMenu) {
            return;
        }

        const colorItems = colorMenu.querySelectorAll(".dropdown-item");
        colorItems.forEach((item) => {
            item.addEventListener("click", () => {
                if (this.diffMode !== DIFF_MODE_OFF) {
                    this.setDiffMode(DIFF_MODE_OFF, { syncUI: true });
                }
            });
        });
    }

    syncDiffDropdownUI() {
        const diffMenu = document.querySelector('.dropdown-menu[aria-labelledby="compare-dropdownDiff"]');
        if (!diffMenu) {
            return;
        }

        const diffItems = diffMenu.querySelectorAll(".dropdown-item");
        diffItems.forEach((item) => item.classList.remove("active"));
        const activeItem = diffMenu.querySelector(`.dropdown-item[data-value="${this.diffMode}"]`);
        if (activeItem) {
            activeItem.classList.add("active");
        }
    }

    setDiffMode(mode, { syncUI = false } = {}) {
        this.diffMode = mode;
        setLocalStr(STORAGE_DIFF_MODE, mode);
        if (syncUI) {
            this.syncDiffDropdownUI();
        }
        this.updateDiffLegendVisibility();
        this.scheduleApplyDiffMode();
    }

    initDiffModeRefreshTriggers() {
        const refreshIds = [
            "compare-plus-c",
            "compare-minus-c",
            "compare-plus-e",
            "compare-minus-e",
            "compare-threshold-c",
            "compare-threshold-e",
        ];

        refreshIds.forEach((id) => {
            const element = document.getElementById(id);
            if (!element) return;

            const eventName = id.startsWith("compare-threshold") ? "input" : "click";
            element.addEventListener(eventName, () => {
                setTimeout(() => this.scheduleApplyDiffMode(), 0);
            });
        });
    }

    updateDiffLegendVisibility() {
        if (!this.diffLegendElement) {
            return;
        }

        const hidden = this.diffMode === DIFF_MODE_OFF;
        this.diffLegendElement.classList.toggle("d-none", hidden);
        if (this.diffLegendNoteElement) {
            this.diffLegendNoteElement.textContent =
                this.diffMode === DIFF_MODE_ONLY
                    ? "Differences only hides shared edges in both panels. Diff is topology-based (edge existence), not weight-based."
                    : "Highlight mode keeps all edges and color-codes shared versus unique edges. Diff is topology-based (edge existence), not weight-based.";
        }
    }

    scheduleApplyDiffMode() {
        if (this.diffApplyScheduled) {
            return;
        }

        this.diffApplyScheduled = true;
        requestAnimationFrame(() => {
            this.diffApplyScheduled = false;
            this.applyDiffMode();
        });
    }

    buildVisibleEdgeKeySet(graph) {
        const keys = new Set();
        graph.edges().forEach((edge) => {
            if (edge.visible()) {
                keys.add(edge.id());
            }
        });
        return keys;
    }

    getNodeDiffType(node, sharedEdgeKeys) {
        let hasVisible = false;
        let hasShared = false;
        let hasUnique = false;

        node.connectedEdges().forEach((edge) => {
            if (!edge.visible()) {
                return;
            }
            hasVisible = true;
            if (sharedEdgeKeys.has(edge.id())) {
                hasShared = true;
            } else {
                hasUnique = true;
            }
        });

        if (!hasVisible) return "none";
        if (hasUnique) return "unique";
        if (hasShared) return "shared";
        return "none";
    }

    getReadableTextColor(hexColor) {
        const hex = (hexColor || "").replace("#", "");
        if (hex.length !== 6) {
            return "#0f172a";
        }

        const r = parseInt(hex.slice(0, 2), 16);
        const g = parseInt(hex.slice(2, 4), 16);
        const b = parseInt(hex.slice(4, 6), 16);
        const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
        return luminance > 0.55 ? "#0f172a" : "#f8fafc";
    }

    resetDiffStyles(graph) {
        graph.edges().forEach((edge) => {
            edge.removeStyle("line-color");
            edge.removeStyle("target-arrow-color");
            edge.removeStyle("mid-source-arrow-color");
            edge.removeStyle("source-arrow-color");
            edge.removeStyle("opacity");
        });

        graph.nodes().forEach((node) => {
            node.removeStyle("pie-size");
            node.removeStyle("background-color");
            node.removeStyle("border-width");
            node.removeStyle("border-color");
            node.removeStyle("color");
            node.removeStyle("opacity");
        });
    }

    restorePanelNodeColors(panelGraph) {
        panelGraph.nodeManager.updateNodeColorSet();
        panelGraph.nodeManager.adjustNodeLabelWrap();
    }

    applyPanelDiffStyles(panelGraph, sharedEdgeKeys, uniqueColor, onlyDiff) {
        const graph = panelGraph.graph;
        graph.edges().forEach((edge) => {
            if (!edge.visible()) {
                return;
            }

            const isShared = sharedEdgeKeys.has(edge.id());
            if (onlyDiff && isShared) {
                edge.hide();
                return;
            }

            const edgeColor = isShared ? DIFF_COLOR_SHARED : uniqueColor;
            edge.style({
                "line-color": edgeColor,
                "target-arrow-color": edgeColor,
                "mid-source-arrow-color": edgeColor,
                "opacity": isShared ? 0.55 : 1,
            });
        });
    }

    applyPanelNodeDiffStyles(panelGraph, sharedEdgeKeys, uniqueColor, onlyDiff) {
        const graph = panelGraph.graph;
        graph.nodes().forEach((node) => {
            if (!node.visible()) {
                return;
            }

            const diffType = this.getNodeDiffType(node, sharedEdgeKeys);
            if (onlyDiff && diffType !== "unique") {
                node.hide();
                return;
            }

            if (diffType === "none") {
                node.hide();
                return;
            }

            const nodeColor = diffType === "unique" ? uniqueColor : DIFF_COLOR_SHARED;
            node.style({
                "pie-size": "0%",
                "background-color": nodeColor,
                "border-color": nodeColor,
                "border-width": diffType === "unique" ? 2.6 : 2.0,
                "color": this.getReadableTextColor(nodeColor),
                "opacity": diffType === "unique" ? 1 : 0.92,
            });
        });
    }

    applyDiffMode() {
        const leftGraph = this.panels.left.graph;
        const rightGraph = this.panels.right.graph;
        if (!leftGraph || !rightGraph) {
            return;
        }

        if (this.diffMode === DIFF_MODE_OFF) {
            if (this.lastAppliedDiffMode === DIFF_MODE_ONLY) {
                leftGraph.filterEdge();
                rightGraph.filterEdge();
            }
            this.resetDiffStyles(leftGraph.graph);
            this.resetDiffStyles(rightGraph.graph);
            this.restorePanelNodeColors(leftGraph);
            this.restorePanelNodeColors(rightGraph);
            this.lastAppliedDiffMode = this.diffMode;
            return;
        }

        leftGraph.filterEdge();
        rightGraph.filterEdge();

        this.resetDiffStyles(leftGraph.graph);
        this.resetDiffStyles(rightGraph.graph);

        const leftVisibleEdgeKeys = this.buildVisibleEdgeKeySet(leftGraph.graph);
        const rightVisibleEdgeKeys = this.buildVisibleEdgeKeySet(rightGraph.graph);
        const sharedEdgeKeys = new Set(
            [...leftVisibleEdgeKeys].filter((edgeKey) => rightVisibleEdgeKeys.has(edgeKey))
        );

        const onlyDiff = this.diffMode === DIFF_MODE_ONLY;
        this.applyPanelDiffStyles(leftGraph, sharedEdgeKeys, DIFF_COLOR_LEFT, onlyDiff);
        this.applyPanelDiffStyles(rightGraph, sharedEdgeKeys, DIFF_COLOR_RIGHT, onlyDiff);
        this.applyPanelNodeDiffStyles(leftGraph, sharedEdgeKeys, DIFF_COLOR_LEFT, onlyDiff);
        this.applyPanelNodeDiffStyles(rightGraph, sharedEdgeKeys, DIFF_COLOR_RIGHT, onlyDiff);

        if (onlyDiff) {
            leftGraph.layoutManager.updateLayout();
            rightGraph.layoutManager.updateLayout();
        }

        this.lastAppliedDiffMode = this.diffMode;
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
        this.scheduleApplyDiffMode();
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
        this.scheduleApplyDiffMode();
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
