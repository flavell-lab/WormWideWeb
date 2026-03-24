import {
    debounce,
    getCSRFToken,
    getLocalBool,
    getLocalJSON,
    getLocalStr,
    setLocalBool,
    setLocalJSON,
    setLocalStr,
} from '/static/core/js/utility.js';
import { URL_CONNECTOME_EDGE } from '/static/core/js/constants.js';

const URL_AVAILABLE_NEURONS = '/connectome/api/available-neurons/';

const WITVLIET_DATASET_IDS = [
    'witvliet_2020_1',
    'witvliet_2020_2',
    'witvliet_2020_3',
    'witvliet_2020_4',
    'witvliet_2020_5',
    'witvliet_2020_6',
    'witvliet_2020_7',
    'witvliet_2020_8',
];

const STAGES = [
    { shortLabel: 'L1 0h', label: 'L1 (~0h after birth)' },
    { shortLabel: 'L1 5h', label: 'L1 (~5h after birth)' },
    { shortLabel: 'L1 8h', label: 'L1 (~8h after birth)' },
    { shortLabel: 'L1 16h', label: 'L1 (~16h after birth)' },
    { shortLabel: 'L2 23h', label: 'L2 (~23h after birth)' },
    { shortLabel: 'L3 27h', label: 'L3 (~27h after birth)' },
    { shortLabel: 'L4 50h', label: 'L4 (~50h, datasets 7+8 mean)' },
];
const DATASET_COUNT_LABELS = [
    'L1 (0h)',
    'L1 (5h)',
    'L1 (8h)',
    'L1 (16h)',
    'L2 (23h)',
    'L3 (27h)',
    'L4 (50h, dataset 7)',
    'L4 (50h, dataset 8)',
];

const STORAGE = {
    selectedValues: 'connectome_development_selected_values',
    showIndividualNeuron: 'connectome_development_show_individual_neuron',
    showConnectedNeuron: 'connectome_development_show_connected_neuron',
    includeElectrical: 'connectome_development_include_electrical',
    thresholdChemical: 'connectome_development_threshold_chemical',
    thresholdElectrical: 'connectome_development_threshold_electrical',
    layout: 'connectome_development_layout',
    layoutSpacing: 'connectome_development_layout_spacing',
    edgeScale: 'connectome_development_edge_scale',
    heatmapColormap: 'connectome_development_heatmap_colormap',
    sliderStage: 'connectome_development_slider_stage',
};

const LAYOUT_OPTIONS = [
    { value: 'grid', label: 'Grid' },
    { value: 'circle', label: 'Circle' },
    { value: 'concentric', label: 'Concentric' },
    { value: 'breadthfirst', label: 'Hierarchy (BFS)' },
    { value: 'dagre', label: 'Hierarchy (Dagre)' },
    { value: 'cose', label: 'Compound Spring Embedder' },
];
const LAYOUT_VALUES = new Set(LAYOUT_OPTIONS.map((option) => option.value));
const DEFAULT_LAYOUT = 'concentric';

const HEATMAP_COLORMAP_OPTIONS = [
    { value: 'Viridis', label: 'Viridis' },
    { value: 'RdBu', label: 'RdBu (divergent)' },
    { value: 'Spectral', label: 'Spectral (divergent)' },
    { value: 'PRGn', label: 'PRGn (divergent)' },
    { value: 'Cividis', label: 'Cividis' },
    { value: 'Plasma', label: 'Plasma' },
];
const HEATMAP_COLORMAP_VALUES = new Set(HEATMAP_COLORMAP_OPTIONS.map((option) => option.value));
const DEFAULT_HEATMAP_COLORMAP = 'Viridis';
const PLOTLY_C0 = '#1f77b4';

const LARGE_EDGE_THRESHOLD = 450;
const LARGE_NODE_THRESHOLD = 140;

function toArray(value) {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') {
        return value.length ? value.split(',') : [];
    }
    if (!value) return [];
    return [value];
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function formatCount(value) {
    const rounded = Math.round(value * 100) / 100;
    return Number.isInteger(rounded) ? `${rounded}` : rounded.toFixed(2);
}

function stageValueLabel(value) {
    return `${formatCount(value)} synapses`;
}

function buildEdgeLabel(edge) {
    if (edge.type === 'e') {
        return `${edge.pre} - ${edge.post} (gap junction)`;
    }
    return `${edge.pre} \u2192 ${edge.post}`;
}

function formatNodeLabel(nodeId) {
    if (nodeId.length <= 3) return nodeId;
    return `${nodeId.slice(0, 3)}\n${nodeId.slice(3)}`;
}

function escapeHtml(value) {
    const div = document.createElement('div');
    div.textContent = value;
    return div.innerHTML;
}

function parsePositiveInt(value, fallback = 0) {
    const parsed = parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(0, parsed);
}

function parseClampedFloat(value, fallback, min, max) {
    const parsed = parseFloat(value);
    if (!Number.isFinite(parsed)) return fallback;
    return clamp(parsed, min, max);
}

function normalizeLayout(value) {
    return LAYOUT_VALUES.has(value) ? value : DEFAULT_LAYOUT;
}

function normalizeHeatmapColormap(value) {
    return HEATMAP_COLORMAP_VALUES.has(value) ? value : DEFAULT_HEATMAP_COLORMAP;
}

function stageTickLabel(stage) {
    const [stagePart, hourPart] = stage.shortLabel.split(' ');
    return `${stagePart}<br>(${hourPart || ''})`;
}

function stageHoverLabel(stage) {
    const [stagePart, hourPart] = stage.shortLabel.split(' ');
    return `${stagePart} (${hourPart || ''})`;
}

class DevelopmentTrajectoryController {
    constructor() {
        this.availableNeuronData = { neurons: {}, neuron_classes: {} };
        this.manifest = {};
        this.currentData = null;
        this.latestResponseData = null;
        this.basePositions = {};

        this.neuronSelector = null;
        this.neuronSelectorWasMouseSelect = false;

        this.stageGraphs = [];
        this.sliderGraph = null;
        this.sliderHasBeenFit = false;

        this.selectedEdgeIndex = null;
        this.lastRequestToken = 0;
        this.loadingCount = 0;

        this.showIndividualNeuron = getLocalBool(STORAGE.showIndividualNeuron, false);
        this.showConnectedNeuron = getLocalBool(STORAGE.showConnectedNeuron, true);
        this.includeElectrical = getLocalBool(STORAGE.includeElectrical, true);
        this.thresholdChemical = parsePositiveInt(getLocalStr(STORAGE.thresholdChemical, '0'), 0);
        this.thresholdElectrical = parsePositiveInt(getLocalStr(STORAGE.thresholdElectrical, '0'), 0);
        this.layoutName = normalizeLayout(getLocalStr(STORAGE.layout, DEFAULT_LAYOUT));
        this.layoutSpacing = parseClampedFloat(getLocalStr(STORAGE.layoutSpacing, '1'), 1, 0.25, 1.5);
        this.edgeScaleFactor = parseClampedFloat(getLocalStr(STORAGE.edgeScale, '1'), 1, 0.1, 3.0);
        this.heatmapColormap = normalizeHeatmapColormap(getLocalStr(STORAGE.heatmapColormap, DEFAULT_HEATMAP_COLORMAP));
        this.sliderStageIndex = clamp(parseInt(getLocalStr(STORAGE.sliderStage, '0'), 10) || 0, 0, STAGES.length - 1);

        this.autoplayTimer = null;

        this.scheduleRefresh = debounce(() => this.refresh(), 350);
        this.scheduleLocalRerender = debounce(() => this.renderFromLatestResponse(), 150);
        this.scheduleRelayout = debounce(() => this.relayoutCurrentGraphs(), 120);
        this.scheduleRescaleEdges = debounce(() => this.rerenderGraphViews(false), 120);
    }

    async init() {
        this.cacheDom();
        this.initTooltips();
        this.initStageCards();
        this.initSliderGraph();
        this.initControls();
        this.initTabs();
        this.applyCitation();

        await this.loadAvailableNeuronOptions();
        this.restoreSelection();

        this.syncManifestFromSelector();
        this.updateSelectionSummary();
        if (Object.keys(this.manifest).length) {
            this.scheduleRefresh();
        } else {
            this.renderNoSelectionState();
        }
    }

    cacheDom() {
        this.heatmapElement = document.getElementById('development-heatmap');
        this.trendElement = document.getElementById('development-trend');
        this.trendDetailsElement = document.getElementById('development-trend-details');
        this.stageGridElement = document.getElementById('development-stage-grid');
        this.selectionSummaryElement = document.getElementById('development-selection-summary');
        this.spinnerElement = document.getElementById('development-spinner');
        this.densityNoticeElement = document.getElementById('development-density-notice');
        this.stageSliderElement = document.getElementById('development-stage-slider');
        this.stageLabelElement = document.getElementById('development-stage-label');
        this.stageSummaryElement = document.getElementById('development-stage-summary');
        this.sliderPlayButton = document.getElementById('development-slider-play');
        this.layoutButtonElement = document.getElementById('development-dropdownLayout');
        this.layoutItemElements = [...document.querySelectorAll('#connectome-development-container #development-dropdownLayout + .dropdown-menu .dropdown-item')];
        this.showIndividualElement = document.getElementById('development-switch-individual');
        this.showConnectedElement = document.getElementById('development-switch-connected');
        this.includeElectricalElement = document.getElementById('development-switch-electrical');
        this.thresholdChemicalElement = document.getElementById('development-threshold-c');
        this.thresholdElectricalElement = document.getElementById('development-threshold-e');
        this.thresholdChemicalMinusButton = document.getElementById('development-minus-c');
        this.thresholdChemicalPlusButton = document.getElementById('development-plus-c');
        this.thresholdElectricalMinusButton = document.getElementById('development-minus-e');
        this.thresholdElectricalPlusButton = document.getElementById('development-plus-e');
        this.layoutSpacingElement = document.getElementById('development-sliderSpacing');
        this.edgeScaleElement = document.getElementById('development-sliderEdgeScale');
        this.heatmapColormapElement = document.getElementById('development-heatmap-cmap');
        this.clearButton = document.getElementById('development-clear-neurons');
    }

    initTooltips() {
        const tooltipTriggerList = document.querySelectorAll('[data-bs-toggle="tooltip"]');
        [...tooltipTriggerList].forEach((el) => new bootstrap.Tooltip(el));
    }

    initControls() {
        this.initNeuronSelector();
        this.initLayoutControls();
        this.initThresholdControls();
        this.initRenderControls();

        this.showIndividualElement.checked = this.showIndividualNeuron;
        this.showConnectedElement.checked = this.showConnectedNeuron;
        this.includeElectricalElement.checked = this.includeElectrical;

        this.showIndividualElement.addEventListener('change', () => {
            this.showIndividualNeuron = this.showIndividualElement.checked;
            setLocalBool(STORAGE.showIndividualNeuron, this.showIndividualNeuron);
            this.scheduleRefresh();
        });

        this.showConnectedElement.addEventListener('change', () => {
            this.showConnectedNeuron = this.showConnectedElement.checked;
            setLocalBool(STORAGE.showConnectedNeuron, this.showConnectedNeuron);
            this.scheduleRefresh();
        });

        this.includeElectricalElement.addEventListener('change', () => {
            this.includeElectrical = this.includeElectricalElement.checked;
            setLocalBool(STORAGE.includeElectrical, this.includeElectrical);
            this.scheduleLocalRerender();
        });

        this.clearButton.addEventListener('click', () => {
            this.neuronSelector.clear();
            this.persistSelection();
            this.syncManifestFromSelector();
            this.updateSelectionSummary();
            this.renderNoSelectionState();
        });

        this.stageSliderElement.value = String(this.sliderStageIndex);
        this.stageSliderElement.addEventListener('input', (event) => {
            const stageIndex = clamp(parseInt(event.target.value, 10) || 0, 0, STAGES.length - 1);
            this.sliderStageIndex = stageIndex;
            setLocalStr(STORAGE.sliderStage, String(stageIndex));
            this.updateSliderStageView();
        });

        this.sliderPlayButton.addEventListener('click', () => this.toggleAutoplay());
    }

    initLayoutControls() {
        this.updateLayoutMenuState();

        this.layoutItemElements.forEach((item) => {
            item.addEventListener('click', (event) => {
                event.preventDefault();
                const layoutValue = normalizeLayout(item.dataset.value);
                if (layoutValue === this.layoutName) return;
                this.layoutName = layoutValue;
                setLocalStr(STORAGE.layout, this.layoutName);
                this.updateLayoutMenuState();
                this.scheduleRelayout();
            });
        });
    }

    updateLayoutMenuState() {
        this.layoutItemElements.forEach((item) => {
            item.classList.toggle('active', item.dataset.value === this.layoutName);
        });

        const label = LAYOUT_OPTIONS.find((option) => option.value === this.layoutName)?.label || 'Layout';
        this.layoutButtonElement.textContent = 'Layout';
        this.layoutButtonElement.title = `Layout: ${label}`;
    }

    initThresholdControls() {
        this.thresholdChemicalElement.value = String(this.thresholdChemical);
        this.thresholdElectricalElement.value = String(this.thresholdElectrical);

        this.thresholdChemicalElement.addEventListener('input', (event) => {
            this.updateThreshold('chemical', event.target.value, false);
        });
        this.thresholdChemicalElement.addEventListener('change', (event) => {
            this.updateThreshold('chemical', event.target.value, true);
        });
        this.thresholdElectricalElement.addEventListener('input', (event) => {
            this.updateThreshold('electrical', event.target.value, false);
        });
        this.thresholdElectricalElement.addEventListener('change', (event) => {
            this.updateThreshold('electrical', event.target.value, true);
        });

        this.thresholdChemicalMinusButton.addEventListener('click', (event) => {
            event.preventDefault();
            this.updateThreshold('chemical', this.thresholdChemical - 1, true);
        });
        this.thresholdChemicalPlusButton.addEventListener('click', (event) => {
            event.preventDefault();
            this.updateThreshold('chemical', this.thresholdChemical + 1, true);
        });
        this.thresholdElectricalMinusButton.addEventListener('click', (event) => {
            event.preventDefault();
            this.updateThreshold('electrical', this.thresholdElectrical - 1, true);
        });
        this.thresholdElectricalPlusButton.addEventListener('click', (event) => {
            event.preventDefault();
            this.updateThreshold('electrical', this.thresholdElectrical + 1, true);
        });
    }

    updateThreshold(kind, value, rerenderNow) {
        const nextValue = parsePositiveInt(value, kind === 'chemical' ? this.thresholdChemical : this.thresholdElectrical);
        if (kind === 'chemical') {
            if (nextValue === this.thresholdChemical && String(nextValue) === this.thresholdChemicalElement.value) return;
            this.thresholdChemical = nextValue;
            this.thresholdChemicalElement.value = String(nextValue);
            setLocalStr(STORAGE.thresholdChemical, String(nextValue));
        } else {
            if (nextValue === this.thresholdElectrical && String(nextValue) === this.thresholdElectricalElement.value) return;
            this.thresholdElectrical = nextValue;
            this.thresholdElectricalElement.value = String(nextValue);
            setLocalStr(STORAGE.thresholdElectrical, String(nextValue));
        }

        if (rerenderNow) {
            this.renderFromLatestResponse();
        } else {
            this.scheduleLocalRerender();
        }
    }

    initRenderControls() {
        this.layoutSpacingElement.value = String(this.layoutSpacing);
        this.edgeScaleElement.value = String(this.edgeScaleFactor);
        if (this.heatmapColormapElement) {
            this.heatmapColormapElement.value = this.heatmapColormap;
        }

        this.layoutSpacingElement.addEventListener('input', (event) => {
            const spacing = parseClampedFloat(event.target.value, this.layoutSpacing, 0.25, 1.5);
            if (spacing === this.layoutSpacing) return;
            this.layoutSpacing = spacing;
            this.layoutSpacingElement.value = String(spacing);
            setLocalStr(STORAGE.layoutSpacing, String(spacing));
            this.scheduleRelayout();
        });

        this.edgeScaleElement.addEventListener('input', (event) => {
            const factor = parseClampedFloat(event.target.value, this.edgeScaleFactor, 0.1, 3.0);
            if (factor === this.edgeScaleFactor) return;
            this.edgeScaleFactor = factor;
            this.edgeScaleElement.value = String(factor);
            setLocalStr(STORAGE.edgeScale, String(factor));
            this.scheduleRescaleEdges();
        });

        if (this.heatmapColormapElement) {
            this.heatmapColormapElement.addEventListener('change', (event) => {
                this.heatmapColormap = normalizeHeatmapColormap(event.target.value);
                this.heatmapColormapElement.value = this.heatmapColormap;
                setLocalStr(STORAGE.heatmapColormap, this.heatmapColormap);
                if (this.currentData?.edges?.length) {
                    this.renderHeatmap(this.currentData);
                }
            });
        }
    }

    relayoutCurrentGraphs() {
        this.rerenderGraphViews(true);
    }

    rerenderGraphViews(recomputeLayout = false) {
        if (!this.currentData?.edges?.length) return;
        if (recomputeLayout) {
            this.basePositions = this.computeBasePositions(this.currentData);
            this.sliderHasBeenFit = false;
        }
        this.renderSmallMultiples(this.currentData);
        this.updateSliderStageView();
    }

    initTabs() {
        const tabButtons = document.querySelectorAll('#development-view-tabs button[data-bs-toggle="tab"]');
        tabButtons.forEach((button) => {
            button.addEventListener('shown.bs.tab', () => {
                this.resizeVisibleGraphs();
            });
        });
    }

    initNeuronSelector() {
        this.neuronSelector = new TomSelect('#development-select-neuron', {
            create: false,
            maxItems: null,
            valueField: 'value',
            labelField: 'name',
            searchField: ['name'],
            sortField: [{ field: 'name' }],
            hidePlaceholder: true,
            maxOptions: null,
            plugins: {
                n_items: {},
                checkbox_options: {},
                dropdown_input: {},
                remove_button: { title: 'Remove this neuron' },
            },
            onItemAdd: (value) => {
                this.handleNeuronAdd(value);
                this.neuronSelector.setTextboxValue('');
                this.neuronSelector.lastQuery = null;
                this.neuronSelector.refreshOptions(false);

                const usedMouse = this.neuronSelectorWasMouseSelect;
                this.neuronSelectorWasMouseSelect = false;
                if (!usedMouse) {
                    const firstOption = this.neuronSelector.dropdown_content?.querySelector('.option');
                    if (firstOption) {
                        this.neuronSelector.setActiveOption(firstOption);
                    }
                }

                this.persistSelection();
                this.syncManifestFromSelector();
                this.updateSelectionSummary();
                this.scheduleRefresh();
            },
            onItemRemove: (value) => {
                this.handleNeuronRemove(value);
                this.persistSelection();
                this.syncManifestFromSelector();
                this.updateSelectionSummary();
                this.scheduleRefresh();
            },
        });

        const dropdownElement = this.neuronSelector.dropdown;
        dropdownElement?.addEventListener('mousedown', () => {
            this.neuronSelectorWasMouseSelect = true;
        });
        dropdownElement?.addEventListener('touchstart', () => {
            this.neuronSelectorWasMouseSelect = true;
        });
    }

    initStageCards() {
        this.stageGridElement.innerHTML = STAGES.map((stage, index) => `
            <article class="card card-body development-stage-card">
                <div class="development-stage-header">
                    <div>
                        <h6 class="development-stage-title">${stage.shortLabel}</h6>
                        <p class="development-stage-subtitle">${stage.label}</p>
                    </div>
                    <span class="development-stage-summary" id="development-stage-summary-${index}">0 edges</span>
                </div>
                <div class="development-stage-graph" id="development-stage-graph-${index}"></div>
            </article>
        `).join('');

        this.stageGraphs = STAGES.map((_, index) => this.createGraph(`development-stage-graph-${index}`, true));
    }

    initSliderGraph() {
        this.sliderGraph = this.createGraph('development-slider-graph', false);
        this.updateSliderStageText();
    }

    createGraph(containerId, compactMode) {
        const container = document.getElementById(containerId);
        return cytoscape({
            container,
            elements: [],
            style: [
                {
                    selector: 'node',
                    style: {
                        width: compactMode ? 24 : 32,
                        height: compactMode ? 24 : 32,
                        label: 'data(label)',
                        'font-size': compactMode ? 8.5 : 10,
                        'text-wrap': 'wrap',
                        'text-max-width': compactMode ? 40 : 60,
                        'text-halign': 'center',
                        'text-valign': 'center',
                        'background-color': (node) => (node.data('active') ? '#0d6efd' : '#d1d5db'),
                        'border-width': (node) => (node.data('active') ? 1.5 : 1),
                        'border-color': (node) => (node.data('active') ? '#1d4ed8' : '#94a3b8'),
                        color: (node) => (node.data('active') ? '#0f172a' : '#64748b'),
                    },
                },
                {
                    selector: 'edge',
                    style: {
                        width: 'data(width)',
                        'line-color': (edge) => (edge.data('type') === 'e' ? '#94a3b8' : '#1f2937'),
                        'target-arrow-color': (edge) => (edge.data('type') === 'e' ? '#94a3b8' : '#1f2937'),
                        'target-arrow-shape': (edge) => (edge.data('type') === 'e' ? 'none' : 'triangle'),
                        'curve-style': 'bezier',
                        opacity: 0.92,
                    },
                },
            ],
            zoomingEnabled: true,
            minZoom: 0.12,
            maxZoom: 4,
            wheelSensitivity: 0.2,
        });
    }

    async loadAvailableNeuronOptions() {
        const params = new URLSearchParams({ datasets: WITVLIET_DATASET_IDS.join(',') });
        const response = await fetch(`${URL_AVAILABLE_NEURONS}?${params.toString()}`);
        if (!response.ok) {
            throw new Error(`Failed to fetch available neurons (status ${response.status})`);
        }

        this.availableNeuronData = await response.json();
        this.updateNeuronSelectorOptions(this.availableNeuronData);
    }

    updateNeuronSelectorOptions(data) {
        this.neuronSelector.clearOptions();

        const neurons = Object.entries(data.neurons || {}).sort(([a], [b]) => a.localeCompare(b));
        const neuronClasses = Object.entries(data.neuron_classes || {}).sort(([a], [b]) => a.localeCompare(b));

        neurons.forEach(([neuronName, neuronInfo]) => {
            const neuronClass = neuronInfo.neuron_class || '';
            this.neuronSelector.addOption({
                name: neuronName,
                value: neuronName,
                type: 'neuron',
                neuron_class: neuronClass,
                neurons: (data.neuron_classes?.[neuronClass] || [neuronName]).join(','),
            });
        });

        neuronClasses.forEach(([neuronClass, neuronList]) => {
            this.neuronSelector.addOption({
                name: neuronClass,
                value: neuronClass,
                type: 'class',
                neurons: neuronList.join(','),
            });
        });

        this.neuronSelector.refreshOptions(false);
    }

    restoreSelection() {
        const savedSelection = getLocalJSON(STORAGE.selectedValues, []);
        if (!Array.isArray(savedSelection) || !savedSelection.length) {
            return;
        }

        const availableValues = new Set(Object.keys(this.neuronSelector.options));
        const filteredSelection = savedSelection.filter((value) => availableValues.has(value));
        if (!filteredSelection.length) {
            return;
        }

        this.neuronSelector.setValue(filteredSelection);
    }

    persistSelection() {
        setLocalJSON(STORAGE.selectedValues, toArray(this.neuronSelector.getValue()));
    }

    handleNeuronAdd(value) {
        const selectedOption = this.neuronSelector.options[value];
        if (!selectedOption) return;

        if (selectedOption.type === 'class') {
            selectedOption.neurons.split(',').forEach((neuron) => this.neuronSelector.removeOption(neuron));
            return;
        }

        const neuronNames = selectedOption.neurons.split(',');
        if (neuronNames.length > 1 && selectedOption.neuron_class) {
            this.neuronSelector.removeOption(selectedOption.neuron_class);
        }
    }

    handleNeuronRemove(value) {
        const options = this.neuronSelector.options;
        if (!(value in options)) {
            return;
        }

        const removedOption = options[value];
        if (removedOption.type === 'class') {
            removedOption.neurons.split(',').forEach((neuron) => {
                this.neuronSelector.addOption({
                    name: neuron,
                    value: neuron,
                    type: 'neuron',
                    neuron_class: value,
                    neurons: removedOption.neurons,
                });
            });
            return;
        }

        const neuronList = removedOption.neurons.split(',');
        const selection = new Set(toArray(this.neuronSelector.getValue()));
        const classUnselected = neuronList.every((name) => !selection.has(name));
        if (classUnselected && removedOption.neuron_class) {
            this.neuronSelector.addOption({
                name: removedOption.neuron_class,
                value: removedOption.neuron_class,
                type: 'class',
                neurons: removedOption.neurons,
            });
        }
    }

    syncManifestFromSelector() {
        const selectedValues = toArray(this.neuronSelector.getValue());
        const manifest = {};

        selectedValues.forEach((value) => {
            const option = this.neuronSelector.options[value];
            if (!option) return;
            manifest[value] = option.type === 'class' ? 'class' : 'neuron';
        });

        this.manifest = manifest;
    }

    updateSelectionSummary() {
        const selectedCount = Object.keys(this.manifest).length;
        if (!selectedCount) {
            this.selectionSummaryElement.textContent = 'No neurons selected';
            return;
        }

        const edgeCount = this.currentData?.edges?.length || 0;
        this.selectionSummaryElement.textContent = `${selectedCount} selected, ${edgeCount} edges in trajectory`;
    }

    setLoading(isLoading) {
        if (isLoading) {
            this.loadingCount += 1;
        } else {
            this.loadingCount = Math.max(0, this.loadingCount - 1);
        }
        this.spinnerElement.style.display = this.loadingCount > 0 ? 'inline-block' : 'none';
    }

    async refresh() {
        if (!Object.keys(this.manifest).length) {
            this.renderNoSelectionState();
            return;
        }

        const requestToken = ++this.lastRequestToken;
        this.setLoading(true);

        try {
            const responseData = await this.fetchEdgeData();
            if (requestToken !== this.lastRequestToken) {
                return;
            }
            this.latestResponseData = responseData;
            this.renderFromLatestResponse();
        } catch (error) {
            console.error('Failed refreshing developmental trajectory:', error);
            this.renderErrorState('Could not load connectome trajectory. Please try again.');
        } finally {
            this.setLoading(false);
        }
    }

    renderFromLatestResponse() {
        if (!this.latestResponseData) return;

        this.currentData = this.transformResponse(this.latestResponseData);
        this.selectedEdgeIndex = this.resolveSelectedEdgeIndex(this.selectedEdgeIndex);
        this.basePositions = this.computeBasePositions(this.currentData);
        this.sliderHasBeenFit = false;

        this.updateSelectionSummary();
        this.updateDensityNotice(this.currentData);
        this.renderHeatmap(this.currentData);
        this.renderTrend(this.currentData);
        this.renderSmallMultiples(this.currentData);
        this.updateSliderStageView();
    }

    async fetchEdgeData() {
        const payload = {
            datasets: WITVLIET_DATASET_IDS,
            neurons: [],
            classes: [],
            show_individual_neuron: this.showIndividualNeuron,
            show_connected_neuron: this.showConnectedNeuron,
        };

        Object.entries(this.manifest).forEach(([value, nodeType]) => {
            if (nodeType === 'class') {
                payload.classes.push(value);
            } else {
                payload.neurons.push(value);
            }
        });

        payload.classes.sort();
        payload.neurons.sort();

        const response = await fetch(URL_CONNECTOME_EDGE, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCSRFToken(),
            },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            throw new Error(`HTTP error: ${response.status}`);
        }

        return response.json();
    }

    transformResponse(responseData) {
        const synapses = responseData?.synapses || [];
        const edges = synapses
            .map((synapse) => {
                const edgeType = String(synapse.type || '').toLowerCase();
                const listCount = WITVLIET_DATASET_IDS.map((_, index) => Number(synapse.list_count?.[index] || 0));
                const l4Mean = (listCount[6] + listCount[7]) / 2;
                const stageValues = [
                    listCount[0],
                    listCount[1],
                    listCount[2],
                    listCount[3],
                    listCount[4],
                    listCount[5],
                    l4Mean,
                ];
                const stageMins = [
                    listCount[0],
                    listCount[1],
                    listCount[2],
                    listCount[3],
                    listCount[4],
                    listCount[5],
                    Math.min(listCount[6], listCount[7]),
                ];
                const stageMaxs = [
                    listCount[0],
                    listCount[1],
                    listCount[2],
                    listCount[3],
                    listCount[4],
                    listCount[5],
                    Math.max(listCount[6], listCount[7]),
                ];

                return {
                    key: `${synapse.pre}!${synapse.post}!${edgeType}`,
                    pre: synapse.pre,
                    post: synapse.post,
                    type: edgeType,
                    stageValues,
                    stageMins,
                    stageMaxs,
                    listCount,
                    total: stageValues.reduce((acc, value) => acc + value, 0),
                };
            })
            .filter((edge) => edge.type === 'c' || edge.type === 'e')
            .filter((edge) => this.includeElectrical || edge.type === 'c')
            .filter((edge) => {
                const threshold = edge.type === 'e' ? this.thresholdElectrical : this.thresholdChemical;
                if (threshold <= 0) return true;
                return Math.max(...edge.stageValues) >= threshold;
            })
            .sort((edgeA, edgeB) => {
                const preCompare = edgeA.pre.localeCompare(edgeB.pre);
                if (preCompare !== 0) {
                    return preCompare;
                }
                return edgeA.post.localeCompare(edgeB.post);
            });

        const nodeSet = new Set();
        edges.forEach((edge) => {
            nodeSet.add(edge.pre);
            nodeSet.add(edge.post);
        });

        return {
            edges,
            nodes: [...nodeSet].sort(),
        };
    }

    resolveSelectedEdgeIndex(currentIndex) {
        const edgeCount = this.currentData?.edges?.length || 0;
        if (!edgeCount) return null;
        if (currentIndex === null || currentIndex < 0 || currentIndex >= edgeCount) {
            return 0;
        }
        return currentIndex;
    }

    computeBasePositions(data) {
        if (!data.nodes.length) {
            return {};
        }

        const elements = [
            ...data.nodes.map((nodeId) => ({
                group: 'nodes',
                data: { id: nodeId },
            })),
            ...data.edges
                .filter((edge) => edge.total > 0)
                .map((edge, index) => ({
                    group: 'edges',
                    data: {
                        id: `layout-${index}`,
                        source: edge.pre,
                        target: edge.post,
                    },
                })),
        ];

        const layoutGraph = cytoscape({
            headless: true,
            styleEnabled: false,
            elements,
        });

        try {
            layoutGraph.layout(this.getLayoutOptions()).run();
        } catch (error) {
            console.warn(`Failed applying ${this.layoutName} layout, falling back to ${DEFAULT_LAYOUT}.`, error);
            this.layoutName = DEFAULT_LAYOUT;
            setLocalStr(STORAGE.layout, this.layoutName);
            this.updateLayoutMenuState();
            layoutGraph.layout(this.getLayoutOptions()).run();
        }

        const positions = {};
        layoutGraph.nodes().forEach((node) => {
            positions[node.id()] = { ...node.position() };
        });

        layoutGraph.destroy();
        return positions;
    }

    getLayoutOptions() {
        const spacingFactor = this.layoutSpacing;
        if (this.layoutName === 'grid') {
            return {
                name: 'grid',
                fit: false,
                avoidOverlap: true,
                spacingFactor,
                animate: false,
            };
        }
        if (this.layoutName === 'circle') {
            return {
                name: 'circle',
                fit: false,
                avoidOverlap: true,
                spacingFactor,
                animate: false,
            };
        }
        if (this.layoutName === 'breadthfirst') {
            return {
                name: 'breadthfirst',
                fit: false,
                directed: true,
                spacingFactor,
                animate: false,
            };
        }
        if (this.layoutName === 'dagre') {
            return {
                name: 'dagre',
                fit: false,
                rankDir: 'LR',
                nodeSep: Math.round(48 * spacingFactor),
                edgeSep: Math.round(14 * spacingFactor),
                rankSep: Math.round(86 * spacingFactor),
                animate: false,
            };
        }
        if (this.layoutName === 'cose') {
            return {
                name: 'cose',
                fit: false,
                animate: false,
                randomize: false,
                idealEdgeLength: Math.round(80 * spacingFactor),
            };
        }
        return {
            name: 'concentric',
            fit: false,
            avoidOverlap: true,
            minNodeSpacing: Math.round(24 * spacingFactor),
            spacingFactor,
            animate: false,
        };
    }

    computeEdgeWidth(count, compactMode) {
        const baseScale = compactMode ? 1.9 : 2.2;
        return Math.max(0.25, Math.log(Number(count || 0) + 1) * baseScale * this.edgeScaleFactor);
    }

    getStageEdgeCount(stageIndex) {
        if (!this.currentData?.edges) return 0;
        return this.currentData.edges.filter((edge) => edge.stageValues[stageIndex] > 0).length;
    }

    buildStageElements(stageIndex, compactMode) {
        const activeNodes = new Set();

        const edgeElements = this.currentData.edges
            .filter((edge) => edge.stageValues[stageIndex] > 0)
            .map((edge, index) => {
                activeNodes.add(edge.pre);
                activeNodes.add(edge.post);
                return {
                    group: 'edges',
                    data: {
                        id: `${edge.key}!stage-${stageIndex}!${index}`,
                        source: edge.pre,
                        target: edge.post,
                        count: edge.stageValues[stageIndex],
                        width: this.computeEdgeWidth(edge.stageValues[stageIndex], compactMode),
                        type: edge.type,
                    },
                };
            });

        const nodeElements = this.currentData.nodes.map((nodeId) => ({
            group: 'nodes',
            data: {
                id: nodeId,
                label: formatNodeLabel(nodeId),
                active: activeNodes.has(nodeId),
            },
        }));

        return { nodeElements, edgeElements };
    }

    applyStageElementsToGraph(graph, stageIndex, fitGraph = true, compactMode = false) {
        const { nodeElements, edgeElements } = this.buildStageElements(stageIndex, compactMode);

        graph.batch(() => {
            graph.elements().remove();
            graph.add(nodeElements);
            graph.add(edgeElements);
        });

        graph.layout({
            name: 'preset',
            positions: (node) => this.basePositions[node.id()] || { x: 0, y: 0 },
            fit: fitGraph,
            padding: 20,
            animate: false,
        }).run();
    }

    updateDensityNotice(data) {
        const dense = data.edges.length > LARGE_EDGE_THRESHOLD || data.nodes.length > LARGE_NODE_THRESHOLD;
        this.densityNoticeElement.classList.toggle('d-none', !dense);
        if (dense) {
            this.densityNoticeElement.textContent =
                `Large selection detected (${data.nodes.length} nodes, ${data.edges.length} edges). ` +
                'Rendering all edges may take longer, but no edges are hidden.';
        }
    }

    renderHeatmap(data) {
        if (!data.edges.length) {
            this.renderEmptyHeatmap('No edges match the current selection and filters.');
            return;
        }

        const stageTickLabels = STAGES.map((stage) => stageTickLabel(stage));
        const stageHoverLabels = STAGES.map((stage) => stageHoverLabel(stage));
        const yLabels = data.edges.map((edge) => buildEdgeLabel(edge));
        const zValues = data.edges.map((edge) => edge.stageValues);

        Plotly.react(this.heatmapElement, [{
            type: 'heatmap',
            x: stageHoverLabels,
            y: yLabels,
            z: zValues,
            colorscale: this.heatmapColormap,
            hovertemplate: '<b>%{y}</b><br>%{x}: %{z}<extra></extra>',
            colorbar: {
                tickfont: { size: 10 },
                thickness: 10,
                y: 0.5,
                yanchor: 'middle',
                lenmode: 'fraction',
                len: 1,
            },
        }], {
            margin: { t: 10, r: 92, b: 44, l: 210 },
            xaxis: {
                title: 'Development stage',
                tickmode: 'array',
                tickvals: stageHoverLabels,
                ticktext: stageTickLabels,
            },
            yaxis: {
                automargin: true,
                tickfont: { size: 10 },
            },
            annotations: [{
                text: 'Synapse count',
                xref: 'paper',
                yref: 'paper',
                x: 1.14,
                y: 0.5,
                showarrow: false,
                textangle: 90,
                xanchor: 'center',
                yanchor: 'middle',
                font: { size: 10, color: '#334155' },
            }],
            template: 'plotly_white',
        }, {
            displayModeBar: false,
            responsive: true,
        });

        if (typeof this.heatmapElement.removeAllListeners === 'function') {
            this.heatmapElement.removeAllListeners('plotly_click');
        }

        this.heatmapElement.on('plotly_click', (eventData) => {
            const point = eventData?.points?.[0];
            if (!point) return;
            const rowLabel = point.y;
            const rowIndex = yLabels.indexOf(rowLabel);
            if (rowIndex === -1) return;

            this.selectedEdgeIndex = rowIndex;
            this.renderTrend(this.currentData);
        });
    }

    renderTrend(data) {
        if (!data.edges.length) {
            this.renderEmptyTrend('Select neurons to inspect edge trajectories.');
            return;
        }

        const edgeIndex = this.resolveSelectedEdgeIndex(this.selectedEdgeIndex);
        const edge = data.edges[edgeIndex];
        this.selectedEdgeIndex = edgeIndex;
        const stageTickLabels = STAGES.map((stage) => stageTickLabel(stage));
        const stageHoverData = STAGES.map((stage, index) => [
            stageHoverLabel(stage),
            formatCount(edge.stageValues[index]),
        ]);
        const stageValuesX = STAGES.map((_, index) => index);
        const l4Index = STAGES.length - 1;
        const errorUpper = new Array(STAGES.length).fill(null);
        const errorLower = new Array(STAGES.length).fill(null);

        const l4Upper = edge.stageMaxs[6] - edge.stageValues[6];
        const l4Lower = edge.stageValues[6] - edge.stageMins[6];
        errorUpper[l4Index] = l4Upper;
        errorLower[l4Index] = l4Lower;

        Plotly.react(this.trendElement, [
            {
                type: 'scatter',
                mode: 'lines+markers',
                x: stageValuesX,
                y: edge.stageValues,
                customdata: stageHoverData,
                name: buildEdgeLabel(edge),
                line: {
                    color: PLOTLY_C0,
                    width: 2.8,
                },
                marker: {
                    size: 8,
                    color: PLOTLY_C0,
                },
                error_y: {
                    type: 'data',
                    symmetric: false,
                    array: errorUpper,
                    arrayminus: errorLower,
                    color: PLOTLY_C0,
                    thickness: 1.5,
                    width: 3,
                    visible: true,
                },
                hovertemplate: '%{customdata[0]}: %{customdata[1]}<extra></extra>',
            },
            {
                type: 'scatter',
                mode: 'markers',
                x: [l4Index, l4Index],
                y: [edge.listCount[6], edge.listCount[7]],
                text: ['Dataset 7 raw', 'Dataset 8 raw'],
                marker: {
                    color: PLOTLY_C0,
                    size: 9,
                    symbol: ['circle-open', 'diamond-open'],
                    line: {
                        color: PLOTLY_C0,
                        width: 1,
                    },
                },
                hovertemplate: '%{text}: %{y}<extra></extra>',
                name: 'Datasets 7/8',
            },
        ], {
            margin: { t: 18, r: 8, b: 40, l: 64 },
            xaxis: {
                title: 'Stage',
                tickmode: 'array',
                tickvals: stageValuesX,
                ticktext: stageTickLabels,
                fixedrange: true,
            },
            yaxis: {
                title: {
                    text: 'Synapse count',
                    standoff: 8,
                },
                automargin: true,
                rangemode: 'tozero',
                fixedrange: true,
            },
            dragmode: false,
            template: 'plotly_white',
            showlegend: false,
        }, {
            displayModeBar: false,
            scrollZoom: false,
            responsive: true,
        });

        const datasetCountRows = edge.listCount
            .map((count, index) => (
                `<div class="development-trend-stat"><span>${DATASET_COUNT_LABELS[index] || `Dataset ${index + 1}`}</span><span>${formatCount(count)}</span></div>`
            ))
            .join('');

        this.trendDetailsElement.innerHTML = `
            <div class="development-trend-title mb-2"><strong>${escapeHtml(buildEdgeLabel(edge))}</strong></div>
            ${datasetCountRows}
        `;
    }

    renderSmallMultiples(data) {
        this.stageGraphs.forEach((graph, stageIndex) => {
            this.applyStageElementsToGraph(graph, stageIndex, true, true);
            const edgeCount = this.getStageEdgeCount(stageIndex);
            const summary = document.getElementById(`development-stage-summary-${stageIndex}`);
            if (summary) {
                summary.textContent = `${edgeCount} edges`;
            }
        });
    }

    updateSliderStageText() {
        const stage = STAGES[this.sliderStageIndex];
        this.stageLabelElement.textContent = stage.label;

        if (this.currentData?.edges?.length) {
            this.stageSummaryElement.textContent = `${this.getStageEdgeCount(this.sliderStageIndex)} edges shown`;
        } else {
            this.stageSummaryElement.textContent = '0 edges shown';
        }
    }

    updateSliderStageView() {
        this.updateSliderStageText();

        if (!this.currentData?.edges?.length) {
            this.sliderGraph.elements().remove();
            this.sliderHasBeenFit = false;
            return;
        }

        const shouldFit = !this.sliderHasBeenFit;
        this.applyStageElementsToGraph(this.sliderGraph, this.sliderStageIndex, shouldFit, false);
        this.sliderHasBeenFit = true;
    }

    toggleAutoplay() {
        if (this.autoplayTimer !== null) {
            this.stopAutoplay();
            return;
        }

        this.autoplayTimer = window.setInterval(() => {
            this.sliderStageIndex = (this.sliderStageIndex + 1) % STAGES.length;
            this.stageSliderElement.value = String(this.sliderStageIndex);
            setLocalStr(STORAGE.sliderStage, String(this.sliderStageIndex));
            this.updateSliderStageView();
        }, 1200);

        this.sliderPlayButton.innerHTML = '<i class="bi bi-pause-fill" aria-hidden="true"></i> Pause';
    }

    stopAutoplay() {
        if (this.autoplayTimer === null) return;
        window.clearInterval(this.autoplayTimer);
        this.autoplayTimer = null;
        this.sliderPlayButton.innerHTML = '<i class="bi bi-play-fill" aria-hidden="true"></i> Play';
    }

    resizeVisibleGraphs() {
        if (typeof Plotly?.Plots?.resize === 'function') {
            Plotly.Plots.resize(this.heatmapElement);
            Plotly.Plots.resize(this.trendElement);
        }

        this.stageGraphs.forEach((graph, stageIndex) => {
            graph.resize();
            if (this.currentData?.edges?.length) {
                this.applyStageElementsToGraph(graph, stageIndex, true, true);
            }
        });

        if (this.sliderGraph) {
            this.sliderGraph.resize();
            if (this.currentData?.edges?.length) {
                this.applyStageElementsToGraph(this.sliderGraph, this.sliderStageIndex, false, false);
            }
        }
    }

    renderNoSelectionState() {
        this.stopAutoplay();
        this.currentData = null;
        this.latestResponseData = null;
        this.basePositions = {};
        this.updateSelectionSummary();
        this.densityNoticeElement.classList.add('d-none');

        this.renderEmptyHeatmap('Select neurons or neuron classes to load trajectories.');
        this.renderEmptyTrend('Select neurons or neuron classes to inspect stage trajectories.');

        this.stageGraphs.forEach((graph, stageIndex) => {
            graph.elements().remove();
            const summary = document.getElementById(`development-stage-summary-${stageIndex}`);
            if (summary) {
                summary.textContent = '0 edges';
            }
        });

        this.sliderGraph.elements().remove();
        this.sliderHasBeenFit = false;
        this.updateSliderStageText();
    }

    renderErrorState(message) {
        this.stopAutoplay();
        this.renderEmptyHeatmap(message);
        this.renderEmptyTrend(message);
    }

    renderEmptyHeatmap(message) {
        Plotly.react(this.heatmapElement, [], {
            margin: { t: 12, r: 8, b: 30, l: 30 },
            xaxis: { visible: false },
            yaxis: { visible: false },
            annotations: [{
                text: message,
                x: 0.5,
                y: 0.5,
                xref: 'paper',
                yref: 'paper',
                showarrow: false,
                font: { size: 14, color: '#475569' },
            }],
            template: 'plotly_white',
        }, {
            displayModeBar: false,
            responsive: true,
        });
    }

    renderEmptyTrend(message) {
        Plotly.react(this.trendElement, [], {
            margin: { t: 12, r: 8, b: 30, l: 30 },
            xaxis: { visible: false },
            yaxis: { visible: false },
            annotations: [{
                text: message,
                x: 0.5,
                y: 0.5,
                xref: 'paper',
                yref: 'paper',
                showarrow: false,
                font: { size: 14, color: '#475569' },
            }],
            template: 'plotly_white',
        }, {
            displayModeBar: false,
            responsive: true,
        });

        this.trendDetailsElement.innerHTML = '';
    }

    applyCitation() {
        const citationElement = document.getElementById('development-citation');
        if (!citationElement) return;

        const citations = [...new Set(
            (datasets || [])
                .flatMap((dataset) => (dataset.citation || '').split('$'))
                .map((citation) => citation.trim())
                .filter(Boolean)
        )];

        citationElement.textContent = citations.join(', ') || 'Witvliet et al., 2021';
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    if (typeof cytoscapeDagre === 'function') {
        cytoscape.use(cytoscapeDagre);
    }

    const controller = new DevelopmentTrajectoryController();
    try {
        await controller.init();
    } catch (error) {
        console.error('Failed to initialize development trajectory page:', error);
        controller.renderErrorState('Failed to initialize development trajectory page.');
    }
});
