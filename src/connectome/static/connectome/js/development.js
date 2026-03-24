import {
    calculateLuminance,
    debounce,
    getCSRFToken,
    getLocalBool,
    getLocalStr,
    isNodeRectangle,
    parseRGB,
    setLocalBool,
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
    showIndividualNeuron: 'connectome_development_show_individual_neuron',
    showConnectedNeuron: 'connectome_development_show_connected_neuron',
    thresholdChemical: 'connectome_development_threshold_chemical',
    layout: 'connectome_development_layout',
    layoutSpacing: 'connectome_development_layout_spacing',
    edgeScale: 'connectome_development_edge_scale',
    layoutSpacingSmall: 'connectome_development_layout_spacing_small',
    layoutSpacingSlider: 'connectome_development_layout_spacing_slider',
    edgeScaleSmall: 'connectome_development_edge_scale_small',
    edgeScaleSlider: 'connectome_development_edge_scale_slider',
    heatmapColormap: 'connectome_development_heatmap_colormap',
    heatmapRowOrder: 'connectome_development_heatmap_row_order',
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
const HEATMAP_ROW_ORDER_OPTIONS = [
    { value: 'pre_post', label: 'Pre \u2192 Post (A-Z)' },
    { value: 'post_pre', label: 'Post \u2192 Pre (A-Z)' },
    { value: 'total_desc', label: 'Total synapses (high-low)' },
    { value: 'peak_stage', label: 'Peak stage' },
    { value: 'clustered', label: 'Clustered (trajectory)' },
];
const HEATMAP_ROW_ORDER_VALUES = new Set(HEATMAP_ROW_ORDER_OPTIONS.map((option) => option.value));
const DEFAULT_HEATMAP_ROW_ORDER = 'pre_post';
const PLOTLY_C0 = '#1f77b4';
const TREND_FILTER_ALL_VALUE = '__trend_filter_all__';
const TYPE_COLORS = Object.freeze({
    u: 'rgb(210,210,210)',
    b: 'rgb(75,75,75)',
    s: 'rgb(51,117,56)',
    i: 'rgb(148,203,236)',
    m: 'rgb(126,41,84)',
    n: 'rgb(220,205,125)',
});
const MAX_PIE_SLICES = 8;

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

function normalizeHeatmapRowOrder(value) {
    return HEATMAP_ROW_ORDER_VALUES.has(value) ? value : DEFAULT_HEATMAP_ROW_ORDER;
}

function stageTickLabel(stage) {
    const [stagePart, hourPart] = stage.shortLabel.split(' ');
    return `${stagePart}<br>(${hourPart || ''})`;
}

function stageHoverLabel(stage) {
    const [stagePart, hourPart] = stage.shortLabel.split(' ');
    return `${stagePart} (${hourPart || ''})`;
}

function wrapAnnotationText(message, maxCharsPerLine = 42) {
    const source = String(message || '');
    const normalized = source.replace(/\s+/g, ' ').trim();
    if (!normalized.length) return '';

    const sourceLines = source
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length);

    const linesToWrap = sourceLines.length ? sourceLines : [normalized];
    const wrappedLines = [];

    linesToWrap.forEach((line) => {
        const words = line.split(/\s+/).filter(Boolean);
        let currentLine = '';

        words.forEach((word) => {
            if (!currentLine.length) {
                currentLine = word;
                return;
            }

            if ((currentLine.length + 1 + word.length) <= maxCharsPerLine) {
                currentLine += ` ${word}`;
                return;
            }

            wrappedLines.push(currentLine);
            currentLine = word;
        });

        if (currentLine.length) {
            wrappedLines.push(currentLine);
        }
    });

    return wrappedLines.map((line) => escapeHtml(line)).join('<br>');
}

class DevelopmentTrajectoryController {
    constructor() {
        this.availableNeuronData = { neurons: {}, neuron_classes: {} };
        this.manifest = {};
        this.currentData = null;
        this.latestResponseData = null;
        this.basePositionsSmall = {};
        this.basePositionsSlider = {};

        this.neuronSelector = null;
        this.neuronSelectorWasMouseSelect = false;
        this.trendPreSelector = null;
        this.trendPostSelector = null;

        this.stageGraphs = [];
        this.stageGraphsHasBeenFit = [];
        this.sliderGraph = null;
        this.sliderHasBeenFit = false;
        this.sliderUserPositions = {};
        this.activeNetworkView = 'small';

        this.selectedEdgeIndex = null;
        this.lastRequestToken = 0;
        this.loadingCount = 0;
        this.trendPreFilter = '';
        this.trendPostFilter = '';

        this.showIndividualNeuron = getLocalBool(STORAGE.showIndividualNeuron, false);
        this.showConnectedNeuron = getLocalBool(STORAGE.showConnectedNeuron, true);
        this.thresholdChemical = parsePositiveInt(getLocalStr(STORAGE.thresholdChemical, '0'), 0);
        this.layoutName = normalizeLayout(getLocalStr(STORAGE.layout, DEFAULT_LAYOUT));
        const legacyLayoutSpacing = parseClampedFloat(getLocalStr(STORAGE.layoutSpacing, '1'), 1, 0.25, 1.5);
        const legacyEdgeScaleFactor = parseClampedFloat(getLocalStr(STORAGE.edgeScale, '1'), 1, 0.1, 3.0);
        this.layoutSpacingSmall = parseClampedFloat(
            getLocalStr(STORAGE.layoutSpacingSmall, String(legacyLayoutSpacing)),
            legacyLayoutSpacing,
            0.25,
            1.5,
        );
        this.layoutSpacingSlider = parseClampedFloat(
            getLocalStr(STORAGE.layoutSpacingSlider, String(legacyLayoutSpacing)),
            legacyLayoutSpacing,
            0.25,
            1.5,
        );
        this.edgeScaleFactorSmall = parseClampedFloat(
            getLocalStr(STORAGE.edgeScaleSmall, String(legacyEdgeScaleFactor)),
            legacyEdgeScaleFactor,
            0.1,
            3.0,
        );
        this.edgeScaleFactorSlider = parseClampedFloat(
            getLocalStr(STORAGE.edgeScaleSlider, String(legacyEdgeScaleFactor)),
            legacyEdgeScaleFactor,
            0.1,
            3.0,
        );
        this.heatmapColormap = normalizeHeatmapColormap(getLocalStr(STORAGE.heatmapColormap, DEFAULT_HEATMAP_COLORMAP));
        this.heatmapRowOrder = normalizeHeatmapRowOrder(getLocalStr(STORAGE.heatmapRowOrder, DEFAULT_HEATMAP_ROW_ORDER));
        this.sliderStageIndex = clamp(parseInt(getLocalStr(STORAGE.sliderStage, '0'), 10) || 0, 0, STAGES.length - 1);

        this.autoplayTimer = null;

        this.scheduleRefresh = debounce(() => this.refresh(), 350);
        this.scheduleLocalRerender = debounce(() => this.renderFromLatestResponse(), 150);
        this.scheduleRelayout = debounce(() => this.relayoutCurrentGraphs(), 120);
        this.scheduleRelayoutSmall = debounce(() => this.relayoutSmallMultiples(), 120);
        this.scheduleRelayoutSlider = debounce(() => this.relayoutSliderNetwork(), 120);
        this.scheduleRescaleSmall = debounce(() => this.rerenderSmallMultiples(), 120);
        this.scheduleRescaleSlider = debounce(() => this.rerenderSliderNetwork(), 120);
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
        this.trendPreSelectElement = document.getElementById('development-trend-pre');
        this.trendPostSelectElement = document.getElementById('development-trend-post');
        this.stageGridElement = document.getElementById('development-stage-grid');
        this.selectionSummaryElement = document.getElementById('development-selection-summary');
        this.loadingStatusElement = document.getElementById('development-loading-status');
        this.densityNoticeElement = document.getElementById('development-density-notice');
        this.stageSliderElement = document.getElementById('development-stage-slider');
        this.stageLabelElement = document.getElementById('development-stage-label');
        this.stageSummaryElement = document.getElementById('development-stage-summary');
        this.sliderPlayButton = document.getElementById('development-slider-play');
        this.layoutButtonElement = document.getElementById('development-dropdownLayout');
        this.layoutItemElements = [...document.querySelectorAll('#connectome-development-container #development-dropdownLayout + .dropdown-menu .dropdown-item')];
        this.showIndividualElement = document.getElementById('development-switch-individual');
        this.showConnectedElement = document.getElementById('development-switch-connected');
        this.thresholdChemicalElement = document.getElementById('development-threshold-c');
        this.thresholdChemicalMinusButton = document.getElementById('development-minus-c');
        this.thresholdChemicalPlusButton = document.getElementById('development-plus-c');
        this.layoutSpacingElement = document.getElementById('development-sliderSpacing');
        this.edgeScaleElement = document.getElementById('development-sliderEdgeScale');
        this.heatmapColormapElement = document.getElementById('development-heatmap-cmap');
        this.heatmapRowOrderElement = document.getElementById('development-heatmap-row-order');
        this.clearButton = document.getElementById('development-clear-neurons');
    }

    initTooltips() {
        const tooltipTriggerList = document.querySelectorAll('[data-bs-toggle="tooltip"]');
        [...tooltipTriggerList].forEach((el) => new bootstrap.Tooltip(el));
    }

    initControls() {
        this.initNeuronSelector();
        this.initTrendFilterControls();
        this.initLayoutControls();
        this.initThresholdControls();
        this.initRenderControls();

        this.showIndividualElement.checked = this.showIndividualNeuron;
        this.showConnectedElement.checked = this.showConnectedNeuron;

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

        this.clearButton.addEventListener('click', () => {
            this.neuronSelector.clear();
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

        this.thresholdChemicalElement.addEventListener('input', (event) => {
            this.updateThreshold(event.target.value, false);
        });
        this.thresholdChemicalElement.addEventListener('change', (event) => {
            this.updateThreshold(event.target.value, true);
        });

        this.thresholdChemicalMinusButton.addEventListener('click', (event) => {
            event.preventDefault();
            this.updateThreshold(this.thresholdChemical - 1, true);
        });
        this.thresholdChemicalPlusButton.addEventListener('click', (event) => {
            event.preventDefault();
            this.updateThreshold(this.thresholdChemical + 1, true);
        });
    }

    updateThreshold(value, rerenderNow) {
        const nextValue = parsePositiveInt(value, this.thresholdChemical);
        if (nextValue === this.thresholdChemical && String(nextValue) === this.thresholdChemicalElement.value) return;
        this.thresholdChemical = nextValue;
        this.thresholdChemicalElement.value = String(nextValue);
        setLocalStr(STORAGE.thresholdChemical, String(nextValue));

        if (rerenderNow) {
            this.renderFromLatestResponse();
        } else {
            this.scheduleLocalRerender();
        }
    }

    initRenderControls() {
        this.syncActiveNetworkView();
        this.syncNetworkRenderControlValues();
        if (this.heatmapColormapElement) {
            this.heatmapColormapElement.value = this.heatmapColormap;
        }
        if (this.heatmapRowOrderElement) {
            this.heatmapRowOrderElement.value = this.heatmapRowOrder;
        }

        this.layoutSpacingElement.addEventListener('input', (event) => {
            this.syncActiveNetworkView();
            const isSliderView = this.activeNetworkView === 'slider';
            const currentSpacing = isSliderView ? this.layoutSpacingSlider : this.layoutSpacingSmall;
            const spacing = parseClampedFloat(event.target.value, currentSpacing, 0.25, 1.5);
            if (spacing === currentSpacing) return;

            this.layoutSpacingElement.value = String(spacing);
            if (isSliderView) {
                this.layoutSpacingSlider = spacing;
                setLocalStr(STORAGE.layoutSpacingSlider, String(spacing));
                this.scheduleRelayoutSlider();
            } else {
                this.layoutSpacingSmall = spacing;
                setLocalStr(STORAGE.layoutSpacingSmall, String(spacing));
                this.scheduleRelayoutSmall();
            }
        });

        this.edgeScaleElement.addEventListener('input', (event) => {
            this.syncActiveNetworkView();
            const isSliderView = this.activeNetworkView === 'slider';
            const currentFactor = isSliderView ? this.edgeScaleFactorSlider : this.edgeScaleFactorSmall;
            const factor = parseClampedFloat(event.target.value, currentFactor, 0.1, 3.0);
            if (factor === currentFactor) return;

            this.edgeScaleElement.value = String(factor);
            if (isSliderView) {
                this.edgeScaleFactorSlider = factor;
                setLocalStr(STORAGE.edgeScaleSlider, String(factor));
                this.scheduleRescaleSlider();
            } else {
                this.edgeScaleFactorSmall = factor;
                setLocalStr(STORAGE.edgeScaleSmall, String(factor));
                this.scheduleRescaleSmall();
            }
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

        if (this.heatmapRowOrderElement) {
            this.heatmapRowOrderElement.addEventListener('change', (event) => {
                this.heatmapRowOrder = normalizeHeatmapRowOrder(event.target.value);
                this.heatmapRowOrderElement.value = this.heatmapRowOrder;
                setLocalStr(STORAGE.heatmapRowOrder, this.heatmapRowOrder);
                if (this.currentData?.edges?.length) {
                    this.renderHeatmap(this.currentData);
                } else {
                    this.renderEmptyHeatmap('Select neurons or neuron classes to load trajectories.');
                }
            });
        }
    }

    relayoutCurrentGraphs() {
        this.rerenderGraphViews(true);
    }

    relayoutSmallMultiples() {
        if (!this.currentData?.edges?.length) return;
        this.basePositionsSmall = this.computeBasePositions(this.currentData, this.layoutSpacingSmall);
        this.renderSmallMultiples(this.currentData);
    }

    relayoutSliderNetwork() {
        if (!this.currentData?.edges?.length) return;
        this.basePositionsSlider = this.computeBasePositions(this.currentData, this.layoutSpacingSlider);
        this.sliderUserPositions = {};
        this.sliderHasBeenFit = false;
        this.updateSliderStageView();
    }

    rerenderSmallMultiples() {
        if (!this.currentData?.edges?.length) return;
        this.renderSmallMultiples(this.currentData);
    }

    rerenderSliderNetwork() {
        if (!this.currentData?.edges?.length) return;
        this.updateSliderStageView();
    }

    rerenderGraphViews(recomputeLayout = false) {
        if (!this.currentData?.edges?.length) return;
        if (recomputeLayout) {
            this.basePositionsSmall = this.computeBasePositions(this.currentData, this.layoutSpacingSmall);
            this.basePositionsSlider = this.computeBasePositions(this.currentData, this.layoutSpacingSlider);
            this.stageGraphsHasBeenFit = STAGES.map(() => false);
            this.sliderUserPositions = {};
            this.sliderHasBeenFit = false;
        }
        this.renderSmallMultiples(this.currentData);
        this.updateSliderStageView();
    }

    initTabs() {
        const tabButtons = document.querySelectorAll('#development-view-tabs button[data-bs-toggle="tab"]');
        tabButtons.forEach((button) => {
            button.addEventListener('shown.bs.tab', () => {
                this.syncActiveNetworkView();
                this.syncNetworkRenderControlValues();
                if (this.activeNetworkView === 'slider') {
                    this.sliderHasBeenFit = false;
                } else if (this.activeNetworkView === 'small') {
                    this.stageGraphsHasBeenFit = STAGES.map(() => false);
                }
                this.resizeVisibleGraphs();
            });
        });
    }

    syncActiveNetworkView() {
        const activeTabButton = document.querySelector('#development-view-tabs .nav-link.active');
        const activeTarget = activeTabButton?.getAttribute('data-bs-target') || '';
        if (activeTarget === '#development-pane-slider') {
            this.activeNetworkView = 'slider';
        } else if (activeTarget === '#development-pane-multiples') {
            this.activeNetworkView = 'small';
        }
    }

    syncNetworkRenderControlValues() {
        const isSliderView = this.activeNetworkView === 'slider';
        const spacingValue = isSliderView ? this.layoutSpacingSlider : this.layoutSpacingSmall;
        const edgeScaleValue = isSliderView ? this.edgeScaleFactorSlider : this.edgeScaleFactorSmall;

        if (this.layoutSpacingElement) {
            this.layoutSpacingElement.value = String(spacingValue);
        }
        if (this.edgeScaleElement) {
            this.edgeScaleElement.value = String(edgeScaleValue);
        }
    }

    isGraphContainerVisible(graph) {
        const container = graph?.container?.();
        return Boolean(container && container.offsetParent !== null && container.clientWidth > 0 && container.clientHeight > 0);
    }

    initTrendFilterControls() {
        const handlePreChange = (value) => {
            this.trendPreFilter = this.normalizeTrendFilterValue(value);
            if (this.currentData?.edges?.length) {
                this.renderTrend(this.currentData);
            } else {
                this.syncTrendFilterControls(null);
            }
        };

        const handlePostChange = (value) => {
            this.trendPostFilter = this.normalizeTrendFilterValue(value);
            if (this.currentData?.edges?.length) {
                this.renderTrend(this.currentData);
            } else {
                this.syncTrendFilterControls(null);
            }
        };

        if (this.trendPreSelectElement) {
            if (typeof TomSelect === 'function') {
                this.trendPreSelector = new TomSelect(this.trendPreSelectElement, {
                    create: false,
                    maxItems: 1,
                    valueField: 'value',
                    labelField: 'label',
                    searchField: ['label'],
                    options: [{ value: TREND_FILTER_ALL_VALUE, label: 'All' }],
                    items: [TREND_FILTER_ALL_VALUE],
                    plugins: {
                        dropdown_input: {},
                    },
                    score(search) {
                        const score = this.getScoreFunction(search);
                        return (item) => (item.value === TREND_FILTER_ALL_VALUE ? 2 : score(item));
                    },
                    onChange: (value) => handlePreChange(value),
                });
            } else {
                this.trendPreSelectElement.addEventListener('change', (event) => {
                    handlePreChange(event.target.value || '');
                });
            }
        }

        if (this.trendPostSelectElement) {
            if (typeof TomSelect === 'function') {
                this.trendPostSelector = new TomSelect(this.trendPostSelectElement, {
                    create: false,
                    maxItems: 1,
                    valueField: 'value',
                    labelField: 'label',
                    searchField: ['label'],
                    options: [{ value: TREND_FILTER_ALL_VALUE, label: 'All' }],
                    items: [TREND_FILTER_ALL_VALUE],
                    plugins: {
                        dropdown_input: {},
                    },
                    score(search) {
                        const score = this.getScoreFunction(search);
                        return (item) => (item.value === TREND_FILTER_ALL_VALUE ? 2 : score(item));
                    },
                    onChange: (value) => handlePostChange(value),
                });
            } else {
                this.trendPostSelectElement.addEventListener('change', (event) => {
                    handlePostChange(event.target.value || '');
                });
            }
        }

        this.syncTrendFilterControls(null);
    }

    normalizeTrendFilterValue(value) {
        const normalized = Array.isArray(value) ? (value[0] || '') : (value || '');
        if (!normalized || normalized === TREND_FILTER_ALL_VALUE) {
            return '';
        }
        return normalized;
    }

    getTrendSelectorDisplayValue(value) {
        return value || TREND_FILTER_ALL_VALUE;
    }

    setTrendSelectOptions(selectElement, selectControl, options, selectedValue) {
        if (!selectElement) return;

        if (selectControl) {
            const normalizedOptions = [
                { value: TREND_FILTER_ALL_VALUE, label: 'All' },
                ...options.map((value) => ({ value, label: value })),
            ];
            selectControl.clear(true);
            selectControl.clearOptions();
            normalizedOptions.forEach((option) => selectControl.addOption(option));
            selectControl.refreshOptions(false);
            selectControl.setValue(this.getTrendSelectorDisplayValue(selectedValue), true);
            selectControl.inputState();
            return;
        }

        const optionHtml = ['<option value="">All</option>', ...options.map((value) => (
            `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`
        ))];
        selectElement.innerHTML = optionHtml.join('');
        selectElement.value = selectedValue || '';
    }

    computeTrendFilterState(data, preValue, postValue) {
        if (!data?.edges?.length) {
            return {
                preValue: '',
                postValue: '',
                preOptions: [],
                postOptions: [],
            };
        }

        let nextPre = preValue || '';
        let nextPost = postValue || '';

        for (let i = 0; i < 2; i += 1) {
            const preOptions = [...new Set(
                data.edges
                    .filter((edge) => !nextPost || edge.post === nextPost)
                    .map((edge) => edge.pre)
            )].sort((a, b) => a.localeCompare(b));
            if (nextPre && !preOptions.includes(nextPre)) {
                nextPre = '';
            }

            const postOptions = [...new Set(
                data.edges
                    .filter((edge) => !nextPre || edge.pre === nextPre)
                    .map((edge) => edge.post)
            )].sort((a, b) => a.localeCompare(b));
            if (nextPost && !postOptions.includes(nextPost)) {
                nextPost = '';
            }
        }

        const finalPreOptions = [...new Set(
            data.edges
                .filter((edge) => !nextPost || edge.post === nextPost)
                .map((edge) => edge.pre)
        )].sort((a, b) => a.localeCompare(b));

        const finalPostOptions = [...new Set(
            data.edges
                .filter((edge) => !nextPre || edge.pre === nextPre)
                .map((edge) => edge.post)
        )].sort((a, b) => a.localeCompare(b));

        return {
            preValue: nextPre,
            postValue: nextPost,
            preOptions: finalPreOptions,
            postOptions: finalPostOptions,
        };
    }

    syncTrendFilterControls(data) {
        const filterState = this.computeTrendFilterState(data, this.trendPreFilter, this.trendPostFilter);
        this.trendPreFilter = filterState.preValue;
        this.trendPostFilter = filterState.postValue;

        this.setTrendSelectOptions(
            this.trendPreSelectElement,
            this.trendPreSelector,
            filterState.preOptions,
            this.trendPreFilter,
        );
        this.setTrendSelectOptions(
            this.trendPostSelectElement,
            this.trendPostSelector,
            filterState.postOptions,
            this.trendPostFilter,
        );

        const hasEdges = Boolean(data?.edges?.length);
        if (this.trendPreSelector) {
            if (hasEdges) {
                this.trendPreSelector.enable();
            } else {
                this.trendPreSelector.disable();
            }
        } else if (this.trendPreSelectElement) {
            this.trendPreSelectElement.disabled = !hasEdges;
        }
        if (this.trendPostSelector) {
            if (hasEdges) {
                this.trendPostSelector.enable();
            } else {
                this.trendPostSelector.disable();
            }
        } else if (this.trendPostSelectElement) {
            this.trendPostSelectElement.disabled = !hasEdges;
        }
    }

    getTrendFilteredEntries(data) {
        return data.edges
            .map((edge, index) => ({ edge, index }))
            .filter(({ edge }) => {
                if (this.trendPreFilter && edge.pre !== this.trendPreFilter) {
                    return false;
                }
                if (this.trendPostFilter && edge.post !== this.trendPostFilter) {
                    return false;
                }
                return true;
            });
    }

    buildTrendSeriesFromEdge(edge) {
        return {
            label: buildEdgeLabel(edge),
            listCount: [...edge.listCount],
            stageValues: [...edge.stageValues],
            stageMins: [...edge.stageMins],
            stageMaxs: [...edge.stageMaxs],
            edgeCount: 1,
            isAggregated: false,
        };
    }

    buildTrendSeriesFromEntries(entries) {
        const summedCounts = new Array(WITVLIET_DATASET_IDS.length).fill(0);
        entries.forEach(({ edge }) => {
            edge.listCount.forEach((count, index) => {
                summedCounts[index] += Number(count || 0);
            });
        });

        const stageValues = [
            summedCounts[0],
            summedCounts[1],
            summedCounts[2],
            summedCounts[3],
            summedCounts[4],
            summedCounts[5],
            (summedCounts[6] + summedCounts[7]) / 2,
        ];
        const stageMins = [
            summedCounts[0],
            summedCounts[1],
            summedCounts[2],
            summedCounts[3],
            summedCounts[4],
            summedCounts[5],
            Math.min(summedCounts[6], summedCounts[7]),
        ];
        const stageMaxs = [
            summedCounts[0],
            summedCounts[1],
            summedCounts[2],
            summedCounts[3],
            summedCounts[4],
            summedCounts[5],
            Math.max(summedCounts[6], summedCounts[7]),
        ];

        const preLabel = this.trendPreFilter || 'All';
        const postLabel = this.trendPostFilter || 'All';
        return {
            label: `${preLabel} \u2192 ${postLabel}`,
            listCount: summedCounts,
            stageValues,
            stageMins,
            stageMaxs,
            edgeCount: entries.length,
            isAggregated: true,
        };
    }

    normalizeTrajectory(values) {
        const total = values.reduce((sum, value) => sum + Number(value || 0), 0);
        if (total <= 0) {
            return values.map(() => 0);
        }
        return values.map((value) => Number(value || 0) / total);
    }

    trajectoryDistance(profileA, profileB) {
        let sumSq = 0;
        for (let index = 0; index < profileA.length; index += 1) {
            const delta = profileA[index] - profileB[index];
            sumSq += delta * delta;
        }
        return Math.sqrt(sumSq);
    }

    getClusteredHeatmapEntries(entries) {
        if (entries.length <= 2) {
            return entries;
        }

        if (entries.length > 900) {
            return [...entries].sort((entryA, entryB) => {
                const peakA = entryA.edge.stageValues.indexOf(Math.max(...entryA.edge.stageValues));
                const peakB = entryB.edge.stageValues.indexOf(Math.max(...entryB.edge.stageValues));
                if (peakA !== peakB) return peakA - peakB;
                if (entryB.edge.total !== entryA.edge.total) return entryB.edge.total - entryA.edge.total;
                return buildEdgeLabel(entryA.edge).localeCompare(buildEdgeLabel(entryB.edge));
            });
        }

        const profiles = entries.map((entry) => this.normalizeTrajectory(entry.edge.stageValues));
        let startIndex = 0;
        for (let index = 1; index < entries.length; index += 1) {
            if (entries[index].edge.total > entries[startIndex].edge.total) {
                startIndex = index;
            }
        }

        const remaining = new Set(entries.map((_, index) => index));
        remaining.delete(startIndex);
        const orderedIndices = [startIndex];

        while (remaining.size) {
            const lastIndex = orderedIndices[orderedIndices.length - 1];
            let bestIndex = null;
            let bestDistance = Infinity;
            remaining.forEach((candidateIndex) => {
                const distance = this.trajectoryDistance(profiles[lastIndex], profiles[candidateIndex]);
                if (distance < bestDistance) {
                    bestDistance = distance;
                    bestIndex = candidateIndex;
                } else if (distance === bestDistance) {
                    const candidateTotal = entries[candidateIndex].edge.total;
                    const bestTotal = bestIndex === null ? -Infinity : entries[bestIndex].edge.total;
                    if (candidateTotal > bestTotal) {
                        bestIndex = candidateIndex;
                    }
                }
            });

            if (bestIndex === null) {
                break;
            }
            remaining.delete(bestIndex);
            orderedIndices.push(bestIndex);
        }

        return orderedIndices.map((index) => entries[index]);
    }

    getHeatmapOrderedEntries(data) {
        const entries = data.edges.map((edge, index) => ({ edge, index }));

        if (this.heatmapRowOrder === 'post_pre') {
            return entries.sort((entryA, entryB) => {
                const postCompare = entryA.edge.post.localeCompare(entryB.edge.post);
                if (postCompare !== 0) return postCompare;
                return entryA.edge.pre.localeCompare(entryB.edge.pre);
            });
        }

        if (this.heatmapRowOrder === 'total_desc') {
            return entries.sort((entryA, entryB) => {
                if (entryB.edge.total !== entryA.edge.total) {
                    return entryB.edge.total - entryA.edge.total;
                }
                return buildEdgeLabel(entryA.edge).localeCompare(buildEdgeLabel(entryB.edge));
            });
        }

        if (this.heatmapRowOrder === 'peak_stage') {
            return entries.sort((entryA, entryB) => {
                const peakA = entryA.edge.stageValues.indexOf(Math.max(...entryA.edge.stageValues));
                const peakB = entryB.edge.stageValues.indexOf(Math.max(...entryB.edge.stageValues));
                if (peakA !== peakB) return peakA - peakB;
                const peakValueA = Math.max(...entryA.edge.stageValues);
                const peakValueB = Math.max(...entryB.edge.stageValues);
                if (peakValueB !== peakValueA) return peakValueB - peakValueA;
                return buildEdgeLabel(entryA.edge).localeCompare(buildEdgeLabel(entryB.edge));
            });
        }

        if (this.heatmapRowOrder === 'clustered') {
            return this.getClusteredHeatmapEntries(entries);
        }

        return entries.sort((entryA, entryB) => {
            const preCompare = entryA.edge.pre.localeCompare(entryB.edge.pre);
            if (preCompare !== 0) return preCompare;
            return entryA.edge.post.localeCompare(entryB.edge.post);
        });
    }

    getSliderRenderPositions() {
        if (!this.sliderUserPositions || !Object.keys(this.sliderUserPositions).length) {
            return this.basePositionsSlider;
        }

        const mergedPositions = { ...this.basePositionsSlider };
        Object.entries(this.sliderUserPositions).forEach(([nodeId, position]) => {
            if (nodeId in mergedPositions) {
                mergedPositions[nodeId] = position;
            }
        });
        return mergedPositions;
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

                this.syncManifestFromSelector();
                this.updateSelectionSummary();
                this.scheduleRefresh();
            },
            onItemRemove: (value) => {
                this.handleNeuronRemove(value);
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
        this.stageGraphsHasBeenFit = STAGES.map(() => false);
    }

    initSliderGraph() {
        this.sliderGraph = this.createGraph('development-slider-graph', false);
        this.initSliderDragPersistence();
        this.updateSliderStageText();
    }

    initSliderDragPersistence() {
        if (!this.sliderGraph) return;
        this.sliderGraph.on('dragfree', 'node', (event) => {
            const node = event.target;
            const position = node.position();
            this.sliderUserPositions[node.id()] = {
                x: position.x,
                y: position.y,
            };
        });
    }

    createGraph(containerId, compactMode) {
        const container = document.getElementById(containerId);
        const graph = cytoscape({
            container,
            elements: [],
            style: [
                {
                    selector: 'node',
                    style: {
                        opacity: 1,
                        'z-index': 1,
                        height: 35,
                        width: (node) => (isNodeRectangle(node) ? 70 : 35),
                        label: 'data(id)',
                        shape: (node) => (isNodeRectangle(node) ? 'round-rectangle' : 'ellipse'),
                        'font-size': compactMode ? 10 : 12,
                        'text-wrap': 'wrap',
                        'text-halign': 'center',
                        'text-valign': 'center',
                        'background-color': TYPE_COLORS.u,
                        color: '#000000',
                    },
                },
                {
                    selector: 'edge',
                    style: {
                        opacity: 1,
                        'z-index': 1,
                        'source-distance-from-node': 5,
                        'target-distance-from-node': 5,
                        width: 'data(width)',
                        'line-color': '#000000',
                        'target-arrow-color': '#000000',
                        'source-arrow-shape': 'none',
                        'target-arrow-shape': 'triangle',
                        'curve-style': 'bezier',
                    },
                },
            ],
            zoomingEnabled: true,
            minZoom: 0.1,
            maxZoom: 3,
            wheelSensitivity: 0.2,
        });

        this.initGraphSelection(graph, compactMode);
        return graph;
    }

    getNodeDisplayData(nodeId) {
        const neurons = this.availableNeuronData?.neurons || {};
        const neuronClasses = this.availableNeuronData?.neuron_classes || {};
        const neuronData = neurons[nodeId];

        if (neuronData) {
            return {
                id: nodeId,
                cell_type: neuronData.cell_type || 'u',
                cell_type_desc: neuronData.cell_type_desc || '',
                neuron_class: neuronData.neuron_class || nodeId,
            };
        }

        const classMembers = Array.isArray(neuronClasses[nodeId]) ? neuronClasses[nodeId] : [];
        const representativeNeuron = classMembers.find((neuronName) => neurons[neuronName]);
        if (representativeNeuron) {
            const representativeData = neurons[representativeNeuron];
            return {
                id: nodeId,
                cell_type: representativeData.cell_type || 'u',
                cell_type_desc: representativeData.cell_type_desc || '',
                neuron_class: nodeId,
            };
        }

        return {
            id: nodeId,
            cell_type: 'u',
            cell_type_desc: '',
            neuron_class: nodeId,
        };
    }

    getSelectedEdgeLabel(edgeData) {
        const edgeLabel = edgeData?.edge_label || '';
        const stageLabel = edgeData?.stage_label || 'Stage';
        const count = formatCount(Number(edgeData?.count || 0));
        return `${edgeLabel}\n${stageLabel}: ${count}`;
    }

    getTypeColorSpec(cellTypeRaw) {
        const cellType = String(cellTypeRaw || 'u').toLowerCase();
        if (['u', 'b'].includes(cellType)) {
            return {
                isPie: false,
                colors: [TYPE_COLORS[cellType] || TYPE_COLORS.u],
            };
        }

        const pieColors = cellType
            .split('')
            .map((typeCode) => TYPE_COLORS[typeCode])
            .filter(Boolean);
        if (!pieColors.length) {
            return {
                isPie: false,
                colors: [TYPE_COLORS.u],
            };
        }

        return {
            isPie: true,
            colors: pieColors,
        };
    }

    getReadableNodeLabelColor(colors) {
        const luminances = colors
            .map((color) => parseRGB(color))
            .filter(Boolean)
            .map((rgb) => calculateLuminance(rgb.r, rgb.g, rgb.b));
        if (!luminances.length) {
            return '#000000';
        }

        return Math.min(...luminances) < 0.25 ? '#FFFFFF' : '#000000';
    }

    applyNodeTypeColors(graph) {
        graph.nodes().forEach((node) => {
            const { isPie, colors } = this.getTypeColorSpec(node.data('cell_type'));
            const styleProps = {
                'background-color': colors[0] || TYPE_COLORS.u,
                color: this.getReadableNodeLabelColor(colors),
            };

            for (let index = 1; index <= MAX_PIE_SLICES; index += 1) {
                styleProps[`pie-${index}-background-color`] = 'rgba(0,0,0,0)';
                styleProps[`pie-${index}-background-size`] = '0%';
            }

            if (isPie && colors.length) {
                const sliceSize = `${100 / colors.length}%`;
                colors.slice(0, MAX_PIE_SLICES).forEach((color, index) => {
                    styleProps[`pie-${index + 1}-background-color`] = color;
                    styleProps[`pie-${index + 1}-background-size`] = sliceSize;
                });
            }

            node.style(styleProps);
        });
    }

    resetGraphSelectionStyles(graph) {
        graph.edges().forEach((edge) => {
            edge.style({
                opacity: 1,
                'z-index': 1,
                label: '',
                'text-background-opacity': 0,
            });
        });

        graph.nodes().forEach((node) => {
            node.style({
                opacity: 1,
                'z-index': 1,
            });
        });
    }

    initGraphSelection(graph, compactMode = false) {
        graph.on('select', 'node', (event) => {
            const selectedNode = event.target;
            const connectedEdges = selectedNode.connectedEdges();
            const connectedNodes = connectedEdges.connectedNodes();

            graph.elements().style({
                opacity: 0.1,
                'z-index': 1,
            });

            selectedNode.style({
                opacity: 1,
                'z-index': 10,
            });
            connectedEdges.style({
                opacity: 1,
                'z-index': 5,
            });
            connectedNodes.style({
                opacity: 1,
                'z-index': 5,
            });
        });

        graph.on('unselect', 'node', () => {
            this.resetGraphSelectionStyles(graph);
        });

        graph.on('select', 'edge', (event) => {
            const selectedEdge = event.target;

            graph.edges().forEach((edge) => {
                if (edge.id() === selectedEdge.id()) {
                    edge.style({
                        opacity: 1,
                        'z-index': 15,
                        'text-background-color': 'rgb(240,240,240)',
                        'text-background-opacity': 0.9,
                        'text-background-padding': '3px',
                        'text-background-shape': 'roundrectangle',
                        color: '#000',
                        'font-size': compactMode ? '10px' : '12px',
                        'text-wrap': 'wrap',
                    });
                    edge.style('label', this.getSelectedEdgeLabel(edge.data()));
                } else {
                    edge.style({
                        opacity: 0.1,
                        label: '',
                        'text-background-opacity': 0,
                        'z-index': 1,
                    });
                }
            });

            const connectedNodes = selectedEdge.connectedNodes();
            graph.nodes().forEach((node) => {
                if (connectedNodes.includes(node)) {
                    node.style({
                        opacity: 1,
                        'z-index': 5,
                    });
                } else {
                    node.style({
                        opacity: 0.1,
                        'z-index': 1,
                    });
                }
            });
        });

        graph.on('unselect', 'edge', () => {
            this.resetGraphSelectionStyles(graph);
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
        if (!this.selectionSummaryElement) {
            return;
        }

        const selectedCount = Object.keys(this.manifest).length;
        if (!selectedCount) {
            this.selectionSummaryElement.textContent = 'No neurons selected';
            return;
        }

        const edgeCount = this.currentData?.edges?.length || 0;
        this.selectionSummaryElement.textContent = `${selectedCount} selected, ${edgeCount} edges in trajectory`;
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
        this.loadingStatusElement.style.display = this.loadingCount > 0 ? 'flex' : 'none';
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
        this.basePositionsSmall = this.computeBasePositions(this.currentData, this.layoutSpacingSmall);
        this.basePositionsSlider = this.computeBasePositions(this.currentData, this.layoutSpacingSlider);
        this.stageGraphsHasBeenFit = STAGES.map(() => false);
        this.sliderUserPositions = {};
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
            .filter((synapse) => String(synapse.type || '').toLowerCase() === 'c')
            .map((synapse) => {
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
                    key: `${synapse.pre}!${synapse.post}!c`,
                    pre: synapse.pre,
                    post: synapse.post,
                    type: 'c',
                    stageValues,
                    stageMins,
                    stageMaxs,
                    listCount,
                    total: stageValues.reduce((acc, value) => acc + value, 0),
                };
            })
            .filter((edge) => {
                if (this.thresholdChemical <= 0) return true;
                return Math.max(...edge.stageValues) >= this.thresholdChemical;
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

    computeBasePositions(data, spacingFactor) {
        if (!data.nodes.length) {
            return {};
        }

        const elements = [
            ...data.nodes.map((nodeId) => ({
                group: 'nodes',
                data: this.getNodeDisplayData(nodeId),
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
            styleEnabled: true,
            elements,
            style: [
                {
                    selector: 'node',
                    style: {
                        height: 35,
                        width: (node) => (isNodeRectangle(node) ? 70 : 35),
                    },
                },
            ],
        });

        try {
            layoutGraph.layout(this.getLayoutOptions(spacingFactor)).run();
        } catch (error) {
            console.warn(`Failed applying ${this.layoutName} layout, falling back to ${DEFAULT_LAYOUT}.`, error);
            this.layoutName = DEFAULT_LAYOUT;
            setLocalStr(STORAGE.layout, this.layoutName);
            this.updateLayoutMenuState();
            layoutGraph.layout(this.getLayoutOptions(spacingFactor)).run();
        }

        const positions = {};
        layoutGraph.nodes().forEach((node) => {
            positions[node.id()] = { ...node.position() };
        });

        const nodeIds = Object.keys(positions);
        if (nodeIds.length > 1) {
            let minX = Infinity;
            let maxX = -Infinity;
            let minY = Infinity;
            let maxY = -Infinity;
            nodeIds.forEach((nodeId) => {
                const { x, y } = positions[nodeId];
                minX = Math.min(minX, x);
                maxX = Math.max(maxX, x);
                minY = Math.min(minY, y);
                maxY = Math.max(maxY, y);
            });

            const spread = Math.max(maxX - minX, maxY - minY);
            const minSpread = Math.max(240, Math.sqrt(nodeIds.length) * 95) * spacingFactor;

            if (!Number.isFinite(spread) || spread <= 0) {
                const radius = minSpread / 2;
                nodeIds.forEach((nodeId, index) => {
                    const angle = (2 * Math.PI * index) / nodeIds.length;
                    positions[nodeId] = {
                        x: Math.cos(angle) * radius,
                        y: Math.sin(angle) * radius,
                    };
                });
            } else if (spread < minSpread) {
                const centerX = (minX + maxX) / 2;
                const centerY = (minY + maxY) / 2;
                const scale = minSpread / spread;
                nodeIds.forEach((nodeId) => {
                    const { x, y } = positions[nodeId];
                    positions[nodeId] = {
                        x: (x - centerX) * scale,
                        y: (y - centerY) * scale,
                    };
                });
            }
        }

        layoutGraph.destroy();
        return positions;
    }

    getLayoutOptions(spacingFactor) {
        if (this.layoutName === 'grid') {
            return {
                name: 'grid',
                fit: false,
                avoidOverlap: true,
                nodeDimensionsIncludeLabels: true,
                avoidOverlapPadding: Math.round(8 * spacingFactor),
                spacingFactor,
                animate: false,
            };
        }
        if (this.layoutName === 'circle') {
            return {
                name: 'circle',
                fit: false,
                avoidOverlap: true,
                nodeDimensionsIncludeLabels: true,
                avoidOverlapPadding: Math.round(8 * spacingFactor),
                spacingFactor,
                animate: false,
            };
        }
        if (this.layoutName === 'breadthfirst') {
            return {
                name: 'breadthfirst',
                fit: false,
                directed: true,
                nodeDimensionsIncludeLabels: true,
                spacingFactor,
                animate: false,
            };
        }
        if (this.layoutName === 'dagre') {
            return {
                name: 'dagre',
                fit: false,
                nodeDimensionsIncludeLabels: true,
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
                nodeDimensionsIncludeLabels: true,
                animate: false,
                randomize: false,
                idealEdgeLength: Math.round(80 * spacingFactor),
            };
        }
        return {
            name: 'concentric',
            fit: false,
            avoidOverlap: true,
            nodeDimensionsIncludeLabels: true,
            avoidOverlapPadding: Math.round(8 * spacingFactor),
            minNodeSpacing: Math.round(24 * spacingFactor),
            spacingFactor,
            animate: false,
        };
    }

    computeEdgeWidth(count, compactMode, edgeScaleFactor) {
        const baseScale = compactMode ? 1.9 : 2.2;
        return Math.max(0.25, Math.log(Number(count || 0) + 1) * baseScale * edgeScaleFactor);
    }

    getStageEdgeCount(stageIndex) {
        if (!this.currentData?.edges) return 0;
        return this.currentData.edges.filter((edge) => edge.stageValues[stageIndex] > 0).length;
    }

    buildStageElements(stageIndex, compactMode, edgeScaleFactor) {
        const activeNodes = new Set();
        const stageLabel = stageHoverLabel(STAGES[stageIndex]);

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
                        width: this.computeEdgeWidth(edge.stageValues[stageIndex], compactMode, edgeScaleFactor),
                        type: edge.type,
                        edge_label: buildEdgeLabel(edge),
                        stage_label: stageLabel,
                    },
                };
            });

        const nodeElements = this.currentData.nodes.map((nodeId) => {
            const nodeData = this.getNodeDisplayData(nodeId);
            return {
                group: 'nodes',
                data: {
                    ...nodeData,
                    active: activeNodes.has(nodeId),
                },
            };
        });

        return { nodeElements, edgeElements };
    }

    applyStageElementsToGraph(graph, stageIndex, basePositions, edgeScaleFactor, fitGraph = true, compactMode = false) {
        const { nodeElements, edgeElements } = this.buildStageElements(stageIndex, compactMode, edgeScaleFactor);

        graph.batch(() => {
            graph.elements().remove();
            graph.add(nodeElements);
            graph.add(edgeElements);
        });
        this.applyNodeTypeColors(graph);

        graph.layout({
            name: 'preset',
            positions: (node) => basePositions[node.id()] || { x: 0, y: 0 },
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

        if (this.heatmapRowOrderElement) {
            this.heatmapRowOrderElement.disabled = false;
        }

        const stageTickLabels = STAGES.map((stage) => stageTickLabel(stage));
        const stageHoverLabels = STAGES.map((stage) => stageHoverLabel(stage));
        const orderedEntries = this.getHeatmapOrderedEntries(data);
        const yLabels = orderedEntries.map(({ edge }) => buildEdgeLabel(edge));
        const zValues = orderedEntries.map(({ edge }) => edge.stageValues);
        const plotHeight = this.heatmapElement?.clientHeight || 460;
        const usableHeight = Math.max(120, plotHeight - 64);
        const minTickSpacingPx = 12;
        const maxDisplayableYTicks = Math.max(8, Math.floor(usableHeight / minTickSpacingPx));
        const hideYTicks = yLabels.length > maxDisplayableYTicks;
        const yAxisConfig = hideYTicks
            ? {
                automargin: true,
                showticklabels: false,
                ticks: '',
                title: {
                    text: 'Too many to display',
                    standoff: 8,
                    font: { size: 10, color: '#64748b' },
                },
            }
            : {
                automargin: true,
                tickfont: { size: 10 },
            };
        const leftMargin = hideYTicks ? 92 : 210;

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
            margin: { t: 10, r: 108, b: 44, l: leftMargin },
            xaxis: {
                title: 'Development stage',
                tickmode: 'array',
                tickvals: stageHoverLabels,
                ticktext: stageTickLabels,
            },
            yaxis: yAxisConfig,
            annotations: [{
                text: 'Synapse count',
                xref: 'paper',
                yref: 'paper',
                x: 1.11,
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

            const selectedEntry = orderedEntries[rowIndex];
            if (!selectedEntry) return;

            this.selectedEdgeIndex = selectedEntry.index;
            const selectedEdge = selectedEntry.edge;
            if (selectedEdge) {
                this.trendPreFilter = selectedEdge.pre;
                this.trendPostFilter = selectedEdge.post;
            }
            this.renderTrend(this.currentData);
        });
    }

    renderTrend(data) {
        this.syncTrendFilterControls(data);

        if (!data.edges.length) {
            this.renderEmptyTrend('Select neurons to inspect edge trajectories.');
            return;
        }

        const filteredEntries = this.getTrendFilteredEntries(data);
        if (!filteredEntries.length) {
            this.renderEmptyTrend('No edges match the selected Pre/Post filters.');
            return;
        }

        const shouldAggregate = !this.trendPreFilter || !this.trendPostFilter;
        let trendSeries = null;
        if (shouldAggregate) {
            trendSeries = this.buildTrendSeriesFromEntries(filteredEntries);
            this.selectedEdgeIndex = null;
        } else {
            let selectedEntry = null;
            if (this.trendPreFilter && this.trendPostFilter) {
                selectedEntry = filteredEntries.find(({ edge }) => (
                    edge.pre === this.trendPreFilter && edge.post === this.trendPostFilter
                )) || null;
            }
            if (!selectedEntry && this.selectedEdgeIndex !== null) {
                selectedEntry = filteredEntries.find(({ index }) => index === this.selectedEdgeIndex) || null;
            }
            if (!selectedEntry) {
                selectedEntry = filteredEntries[0];
            }

            trendSeries = this.buildTrendSeriesFromEdge(selectedEntry.edge);
            this.selectedEdgeIndex = selectedEntry.index;
        }
        const stageTickLabels = STAGES.map((stage) => stageTickLabel(stage));
        const stageHoverData = STAGES.map((stage, index) => [
            stageHoverLabel(stage),
            formatCount(trendSeries.stageValues[index]),
        ]);
        const stageValuesX = STAGES.map((_, index) => index);
        const l4Index = STAGES.length - 1;
        const errorUpper = new Array(STAGES.length).fill(null);
        const errorLower = new Array(STAGES.length).fill(null);

        const l4Upper = trendSeries.stageMaxs[6] - trendSeries.stageValues[6];
        const l4Lower = trendSeries.stageValues[6] - trendSeries.stageMins[6];
        errorUpper[l4Index] = l4Upper;
        errorLower[l4Index] = l4Lower;

        Plotly.react(this.trendElement, [
            {
                type: 'scatter',
                mode: 'lines+markers',
                x: stageValuesX,
                y: trendSeries.stageValues,
                customdata: stageHoverData,
                name: trendSeries.label,
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
                y: [trendSeries.listCount[6], trendSeries.listCount[7]],
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

        const datasetCountRows = trendSeries.listCount
            .map((count, index) => (
                `<div class="development-trend-stat"><span>${DATASET_COUNT_LABELS[index] || `Dataset ${index + 1}`}</span><span>${formatCount(count)}</span></div>`
            ))
            .join('');

        const aggregateNote = trendSeries.isAggregated
            ? `<div class="small text-muted mb-2">Summed across ${trendSeries.edgeCount} edge${trendSeries.edgeCount === 1 ? '' : 's'}</div>`
            : '';

        this.trendDetailsElement.innerHTML = `
            <div class="development-trend-title mb-2"><strong>${escapeHtml(trendSeries.label)}</strong></div>
            ${aggregateNote}
            ${datasetCountRows}
        `;
    }

    renderSmallMultiples(data) {
        this.stageGraphs.forEach((graph, stageIndex) => {
            const graphVisible = this.isGraphContainerVisible(graph);
            const shouldFit = graphVisible && !this.stageGraphsHasBeenFit[stageIndex];
            this.applyStageElementsToGraph(
                graph,
                stageIndex,
                this.basePositionsSmall,
                this.edgeScaleFactorSmall,
                shouldFit,
                true,
            );
            if (graphVisible && shouldFit) {
                this.stageGraphsHasBeenFit[stageIndex] = true;
            }
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

        const sliderVisible = this.isGraphContainerVisible(this.sliderGraph);
        const shouldFit = sliderVisible && !this.sliderHasBeenFit;
        this.applyStageElementsToGraph(
            this.sliderGraph,
            this.sliderStageIndex,
            this.getSliderRenderPositions(),
            this.edgeScaleFactorSlider,
            shouldFit,
            false,
        );
        if (sliderVisible) {
            this.sliderHasBeenFit = true;
        }
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
                const graphVisible = this.isGraphContainerVisible(graph);
                const shouldFit = graphVisible && !this.stageGraphsHasBeenFit[stageIndex];
                this.applyStageElementsToGraph(
                    graph,
                    stageIndex,
                    this.basePositionsSmall,
                    this.edgeScaleFactorSmall,
                    shouldFit,
                    true,
                );
                if (graphVisible && shouldFit) {
                    this.stageGraphsHasBeenFit[stageIndex] = true;
                }
            }
        });

        if (this.sliderGraph) {
            this.sliderGraph.resize();
            if (this.currentData?.edges?.length) {
                const sliderVisible = this.isGraphContainerVisible(this.sliderGraph);
                const shouldFit = sliderVisible && !this.sliderHasBeenFit;
                this.applyStageElementsToGraph(
                    this.sliderGraph,
                    this.sliderStageIndex,
                    this.getSliderRenderPositions(),
                    this.edgeScaleFactorSlider,
                    shouldFit,
                    false,
                );
                if (sliderVisible && shouldFit) {
                    this.sliderHasBeenFit = true;
                }
            }
        }
    }

    renderNoSelectionState() {
        this.stopAutoplay();
        this.currentData = null;
        this.latestResponseData = null;
        this.basePositionsSmall = {};
        this.basePositionsSlider = {};
        this.stageGraphsHasBeenFit = STAGES.map(() => false);
        this.sliderUserPositions = {};
        this.trendPreFilter = '';
        this.trendPostFilter = '';
        this.syncTrendFilterControls(null);
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
        if (this.heatmapRowOrderElement) {
            this.heatmapRowOrderElement.disabled = true;
        }

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
                text: wrapAnnotationText(message, 38),
                x: 0.5,
                y: 0.5,
                xref: 'paper',
                yref: 'paper',
                showarrow: false,
                xanchor: 'center',
                yanchor: 'middle',
                align: 'center',
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
        const citationElements = document.querySelectorAll('.development-citation');
        if (!citationElements.length) return;

        const citations = [...new Set(
            (datasets || [])
                .flatMap((dataset) => (dataset.citation || '').split('$'))
                .map((citation) => citation.trim())
                .filter(Boolean)
        )];

        const citationText = citations.join(', ') || 'Witvliet et al., 2021';
        citationElements.forEach((element) => {
            element.textContent = citationText;
        });
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
