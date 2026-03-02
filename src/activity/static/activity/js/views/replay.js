import {
    getLocalFloat,
    getLocalBool,
    getLocalInt,
    getLocalStr,
    setLocalFloat,
    setLocalBool,
    setLocalInt,
    setLocalStr,
    debounce,
    updateCitation,
} from "/static/core/js/utility.js";
import { getCycleColor } from "/static/activity/js/plot_data.js";
import { getNodeColor, PLOTLY_COLOR_SCALES } from "/static/core/js/colorscale.js";

const STORAGE_ACTIVITY_DATASET = "replay_activity_dataset";
const STORAGE_CONNECTOME_DATASET = "replay_connectome_dataset";
const STORAGE_MIN_SYNAPSE_C = "replay_min_synapse_chemical";
const STORAGE_MIN_SYNAPSE_E = "replay_min_synapse_electrical";
const STORAGE_LAYOUT = "replay_layout";
const STORAGE_EDGE_SIZE_MODE = "replay_edge_size_mode";
const STORAGE_EDGE_COLOR_MODE = "replay_edge_color_mode";
const STORAGE_EDGE_TYPE = "replay_edge_type";
const STORAGE_SHOW_CONNECTED = "replay_show_connected";
const STORAGE_EDGE_COLORMAP = "replay_edge_colormap";
const STORAGE_SPEED = "replay_speed";
const STORAGE_SPACING = "replay_spacing";
const STORAGE_EDGE_SCALE = "replay_edge_scale";
const STORAGE_NODE_SIZE_MODE = "replay_node_size_mode";
const STORAGE_NODE_COLOR_MODE = "replay_node_color_mode";
const STORAGE_NODE_COLORMAP = "replay_node_colormap";
const STORAGE_BEHAVIOR_SHOW_REVERSAL = "replay_behavior_show_reversal";
const STORAGE_BEHAVIOR_SHOW_EVENT = "replay_behavior_show_event";
const STORAGE_TOUR_REPLAY = "tour-activity-replay";
const DEFAULT_CONNECTOME_DATASET_ID = "cook_jarrell_2019_h";
const EDGE_SCALE_MIN = 0.1;
const EDGE_SCALE_MAX = 3.0;
const EDGE_WIDTH_FACTOR_MIN = 0.45;
const EDGE_WIDTH_FACTOR_MAX = 1.65;
const EDGE_WIDTH_MIN_PX = 0.5;

const DEFAULTS = {
    minSynapseChemical: 3,
    minSynapseElectrical: 2,
    layout: "concentric",
    edgeSizeMode: "weighted_source",
    edgeColorMode: "count",
    edgeType: "all",
    showConnected: false,
    edgeColormap: "YlGnBu",
    speed: 1,
    fps: 10,
    spacing: 1.15,
    edgeScale: 1.5,
    nodeSizeMode: "degree_total",
    nodeColorMode: "activity",
    nodeColormap: "RdBu",
    showReversal: true,
    showEvent: false,
};
const REPLAY_REQUEST_CACHE_MAX_ENTRIES = 8;
const NODE_BEHAVIOR_MODE_PREFIX = "behavior_corr__";
const NEURON_FILTER_DEBOUNCE_MS = 500;
const STATIC_NODE_MODE_OPTIONS = [
    { value: "activity", label: "Neural activity" },
    { value: "degree_total", label: "Degree total" },
    { value: "degree_in", label: "Degree in" },
    { value: "degree_out", label: "Degree out" },
    { value: "pagerank", label: "PageRank centrality" },
    { value: "eigenvector", label: "Eigenvector centrality" },
];
const BEHAVIOR_REVERSAL_FILL_COLOR = "rgba(255, 0, 0, 0.15)";
const BEHAVIOR_EVENT_STYLE_BY_KEY = {
    heat: { color: "rgba(255, 0, 0, 1)", width: 2 },
    patchEncounter: { color: "rgba(255, 0, 0, 1)", width: 2 },
};

let selectors = {};
let rawReplayPayload = null;
let replayPayload = null;
let selectedNodeIds = new Set();
let currentBehaviorKeys = [];
let behaviorColorIndexByKey = new Map();
let cy = null;
let isPlaying = false;
let currentFrame = 0;
let timerId = null;
let signalYMax = 1;
let behaviorYMin = -1;
let behaviorYMax = 1;
let showBehaviorReversal = getLocalBool(STORAGE_BEHAVIOR_SHOW_REVERSAL, DEFAULTS.showReversal);
let showBehaviorEvent = getLocalBool(STORAGE_BEHAVIOR_SHOW_EVENT, DEFAULTS.showEvent);
let behaviorEventAvailable = false;
let selectedEdgeId = null;
let selectedNodeInfoId = null;
let appliedSpacing = DEFAULTS.spacing;
let appliedEdgeScale = DEFAULTS.edgeScale;
let appliedEdgeType = DEFAULTS.edgeType;
let advancedSettingsCollapse = null;
const replayRequestCache = new Map();
const replayRequestInFlight = new Map();
let nodeAutoRanges = {
    activity: { vmin: -1, vmax: 1, abs95: 1 },
    connectome: { vmin: 0, vmax: 1, abs95: 1 },
};
let edgeAutoRanges = {
    count: { vmin: 0, vmax: 1 },
    source_only: { vmin: -1, vmax: 1 },
    weighted_source: { vmin: -1, vmax: 1 },
};
let pendingInitialNodeModes = null;
let debouncedNeuronFilterApply = null;
let isReplayLoading = false;
let isNeuronFilterPending = false;
let isNeuronFilterApplying = false;
let pendingUrlState = {
    active: false,
    neuronIds: [],
    neuronIndices: [],
    behaviors: [],
    frame: null,
};

function normalizeEdgeType(value) {
    if (value === "chemical" || value === "electrical") return value;
    return "all";
}

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

function parseTomSelectValues(value) {
    if (Array.isArray(value)) {
        return value.filter((item) => item);
    }
    if (typeof value === "string") {
        if (!value) return [];
        return value.split(",").map((item) => item.trim()).filter((item) => item);
    }
    return [];
}

function parseCsvParam(value) {
    if (!value) return [];
    return value
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item);
}

function parseNeuronIndexParam(value) {
    if (!value) return [];
    const output = [];
    const seen = new Set();
    value.split(/[-,]/).forEach((item) => {
        const parsed = Number.parseInt(String(item).trim(), 10);
        if (!Number.isInteger(parsed) || parsed < 1) return;
        if (seen.has(parsed)) return;
        seen.add(parsed);
        output.push(parsed);
    });
    return output;
}

function parseIntParam(value) {
    if (value === null || value === undefined || value === "") return null;
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) ? parsed : null;
}

function parseFloatParam(value) {
    if (value === null || value === undefined || value === "") return null;
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function parseBoolParam(value) {
    if (value === null || value === undefined || value === "") return null;
    const normalized = String(value).trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
    return null;
}

function parseReplayStateFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const nParam = params.get("n");
    const neuronsParam = params.get("neurons");
    const neuronIndices = parseNeuronIndexParam(nParam || neuronsParam || "");
    return {
        activityDataset: params.get("activity_dataset") || "",
        connectomeDataset: params.get("connectome_dataset") || "",
        neuronIndices: neuronIndices,
        neuronIds: parseCsvParam(neuronsParam),
        behaviors: parseCsvParam(params.get("behaviors")),
        frame: parseIntParam(params.get("tp") ?? params.get("frame")),
        layout: params.get("layout") || "",
        edgeType: params.get("edge_type") || "",
        showConnected: parseBoolParam(params.get("show_connected")),
        minSynapseChemical: parseIntParam(params.get("min_synapse_chemical")),
        minSynapseElectrical: parseIntParam(params.get("min_synapse_electrical")),
        spacing: parseFloatParam(params.get("spacing")),
        edgeScale: parseFloatParam(params.get("edge_scale")),
        edgeSizeMode: params.get("edge_size_mode") || "",
        edgeColorMode: params.get("edge_color_mode") || "",
        edgeColormap: params.get("edge_colormap") || "",
        edgeVMin: parseFloatParam(params.get("edge_vmin")),
        edgeVMax: parseFloatParam(params.get("edge_vmax")),
        nodeSizeMode: params.get("node_size_mode") || "",
        nodeColorMode: params.get("node_color_mode") || "",
        nodeColormap: params.get("node_colormap") || "",
        nodeVMin: parseFloatParam(params.get("node_vmin")),
        nodeVMax: parseFloatParam(params.get("node_vmax")),
        speed: parseFloatParam(params.get("speed")),
        showReversal: parseBoolParam(params.get("show_reversal")),
        showEvent: parseBoolParam(params.get("show_event")),
    };
}

function setUrlParam(params, key, value) {
    if (value === null || value === undefined || value === "") return;
    params.set(key, String(value));
}

function isBehaviorCorrelationMode(mode) {
    return String(mode || "").startsWith(NODE_BEHAVIOR_MODE_PREFIX);
}

function normalizeNodeMode(mode) {
    if (!mode) return DEFAULTS.nodeColorMode;
    if (isBehaviorCorrelationMode(mode)) return mode;
    if (mode === "connectome") return "degree_total";
    const allowed = new Set(STATIC_NODE_MODE_OPTIONS.map((option) => option.value));
    return allowed.has(mode) ? mode : DEFAULTS.nodeColorMode;
}

function getBehaviorKeyFromNodeMode(mode) {
    if (!isBehaviorCorrelationMode(mode)) return "";
    return String(mode).slice(NODE_BEHAVIOR_MODE_PREFIX.length);
}

function getBehaviorNodeModeOptions(behaviorData) {
    const traces = behaviorData?.traces || {};
    return Object.keys(traces)
        .map((behaviorKey, idx) => {
            const behavior = traces[behaviorKey] || {};
            const behaviorName = behavior.name || behaviorKey;
            return {
                value: `${NODE_BEHAVIOR_MODE_PREFIX}${behaviorKey}`,
                label: `Behavior corr: ${behaviorName}`,
                order: getBehaviorColorIndex(behaviorKey, idx),
                name: behaviorName,
            };
        })
        .sort((a, b) => {
            if (a.order !== b.order) return a.order - b.order;
            return a.name.localeCompare(b.name);
        });
}

function rebuildNodeModeSelectorOptions(selectElement, behaviorData, preferredValue) {
    if (!selectElement) return DEFAULTS.nodeColorMode;

    const currentValue = normalizeNodeMode(selectElement.value);
    const normalizedPreferred = normalizeNodeMode(preferredValue);
    const options = [
        ...STATIC_NODE_MODE_OPTIONS,
        ...getBehaviorNodeModeOptions(behaviorData),
    ];
    const availableValues = new Set(options.map((option) => option.value));
    const nextValue = availableValues.has(normalizedPreferred)
        ? normalizedPreferred
        : (availableValues.has(currentValue) ? currentValue : DEFAULTS.nodeColorMode);

    selectElement.innerHTML = "";
    options.forEach((option) => {
        const element = document.createElement("option");
        element.value = option.value;
        element.textContent = option.label;
        if (option.value === nextValue) {
            element.selected = true;
        }
        selectElement.appendChild(element);
    });

    selectElement.value = nextValue;
    return nextValue;
}

function syncNodeModeSelectors(behaviorData, preferredModes = {}) {
    const sizeSelect = document.getElementById("select-node-size-mode");
    const colorSelect = document.getElementById("select-node-color-mode");
    const sizeMode = rebuildNodeModeSelectorOptions(
        sizeSelect,
        behaviorData,
        preferredModes.sizeMode || sizeSelect?.value || DEFAULTS.nodeSizeMode
    );
    const colorMode = rebuildNodeModeSelectorOptions(
        colorSelect,
        behaviorData,
        preferredModes.colorMode || colorSelect?.value || DEFAULTS.nodeColorMode
    );
    return { sizeMode, colorMode };
}

function buildReplayRequestCacheKey({
    activityDataset,
    connectomeDataset,
    includeElectrical,
    showConnected,
    minSynapseChemical,
    minSynapseElectrical,
}) {
    return [
        activityDataset || "",
        connectomeDataset || "",
        includeElectrical ? "1" : "0",
        showConnected ? "1" : "0",
        String(minSynapseChemical),
        String(minSynapseElectrical),
    ].join("|");
}

function getCachedReplayPayload(cacheKey) {
    if (!replayRequestCache.has(cacheKey)) return null;
    const payload = replayRequestCache.get(cacheKey);
    // Refresh insertion order to keep a simple LRU cache.
    replayRequestCache.delete(cacheKey);
    replayRequestCache.set(cacheKey, payload);
    return payload;
}

function cacheReplayPayload(cacheKey, payload) {
    if (!cacheKey || !payload) return;
    if (replayRequestCache.has(cacheKey)) {
        replayRequestCache.delete(cacheKey);
    }
    replayRequestCache.set(cacheKey, payload);
    while (replayRequestCache.size > REPLAY_REQUEST_CACHE_MAX_ENTRIES) {
        const oldestKey = replayRequestCache.keys().next().value;
        replayRequestCache.delete(oldestKey);
    }
}

async function fetchReplayPayloadWithCache(cacheKey, params) {
    const cachedPayload = getCachedReplayPayload(cacheKey);
    if (cachedPayload) {
        return { payload: cachedPayload, source: "memory-cache" };
    }

    if (replayRequestInFlight.has(cacheKey)) {
        const inFlightPayload = await replayRequestInFlight.get(cacheKey);
        return { payload: inFlightPayload, source: "memory-cache" };
    }

    const requestPromise = (async () => {
        const response = await fetch(`/activity/api/data/replay/?${params.toString()}`);
        const payload = await response.json();
        if (!response.ok) {
            throw new Error(payload.message || "Failed to load replay data.");
        }
        cacheReplayPayload(cacheKey, payload);
        return payload;
    })();

    replayRequestInFlight.set(cacheKey, requestPromise);
    try {
        const payload = await requestPromise;
        return { payload: payload, source: "network" };
    } finally {
        replayRequestInFlight.delete(cacheKey);
    }
}

function getColorScale(colormapName, fallbackName = DEFAULTS.nodeColormap) {
    return PLOTLY_COLOR_SCALES[colormapName]
        || PLOTLY_COLOR_SCALES[fallbackName]
        || PLOTLY_COLOR_SCALES[DEFAULTS.nodeColormap]
        || PLOTLY_COLOR_SCALES.RdBu;
}

function buildHorizontalGradient(scale) {
    const stops = scale.map(([t, color]) => `${color} ${(t * 100).toFixed(1)}%`);
    return `linear-gradient(to right, ${stops.join(", ")})`;
}

function updateSingleColorBar(barId, minId, maxId, colormapName, vmin, vmax, fallbackName) {
    const bar = document.getElementById(barId);
    const minLabel = document.getElementById(minId);
    const maxLabel = document.getElementById(maxId);
    if (!bar || !minLabel || !maxLabel) return;

    const scale = getColorScale(colormapName, fallbackName);
    bar.style.background = buildHorizontalGradient(scale);

    const minValue = Number.parseFloat(vmin);
    const maxValue = Number.parseFloat(vmax);
    minLabel.textContent = Number.isFinite(minValue) ? minValue.toFixed(2) : "n/a";
    maxLabel.textContent = Number.isFinite(maxValue) ? maxValue.toFixed(2) : "n/a";
}

function getSelectLabel(selectId, fallbackText) {
    const select = document.getElementById(selectId);
    if (!select) return fallbackText;
    const option = select.options?.[select.selectedIndex];
    const text = option?.textContent?.trim();
    return text || fallbackText;
}

function updateTitleTooltip(titleElement, text) {
    if (!titleElement) return;
    titleElement.setAttribute("title", text);
    titleElement.setAttribute("data-bs-title", text);

    const BootstrapTooltip = window.bootstrap && window.bootstrap.Tooltip;
    if (!BootstrapTooltip) return;

    const existing = BootstrapTooltip.getInstance(titleElement);
    if (existing) {
        existing.dispose();
    }
    BootstrapTooltip.getOrCreateInstance(titleElement);
}

function updateColorBarTitle(titleId, prefix, selectId, fallbackText) {
    const title = document.getElementById(titleId);
    if (!title) return;
    const selectedLabel = getSelectLabel(selectId, fallbackText);
    const text = `${prefix}: ${selectedLabel}`;
    title.textContent = text;
    updateTitleTooltip(title, text);
}

function updateColorBars() {
    const nodeSettings = getNodeColorSettings();
    const edgeSettings = getEdgeColorSettings();
    updateSingleColorBar(
        "replay-node-colorbar",
        "replay-node-colorbar-min",
        "replay-node-colorbar-max",
        nodeSettings.colormap,
        nodeSettings.vmin,
        nodeSettings.vmax,
        DEFAULTS.nodeColormap
    );
    updateSingleColorBar(
        "replay-edge-colorbar",
        "replay-edge-colorbar-min",
        "replay-edge-colorbar-max",
        edgeSettings.colormap,
        edgeSettings.vmin,
        edgeSettings.vmax,
        DEFAULTS.edgeColormap
    );
    updateColorBarTitle(
        "replay-node-colorbar-title",
        "Node color",
        "select-node-color-mode",
        "Neural activity"
    );
    updateColorBarTitle(
        "replay-edge-colorbar-title",
        "Edge color",
        "select-edge-color-mode",
        "Connectome counts"
    );
}

function updateRangeLabel(labelId, value) {
    const element = document.getElementById(labelId);
    if (!element) return;
    const numeric = Number.parseFloat(value);
    if (!Number.isFinite(numeric)) {
        element.textContent = "n/a";
        return;
    }
    element.textContent = numeric.toFixed(2);
}

function updateSettingsToggleButton(isVisible) {
    const button = document.getElementById("button-toggle-settings");
    if (!button) return;
    button.setAttribute("aria-expanded", isVisible ? "true" : "false");
    button.classList.toggle("btn-outline-secondary", !isVisible);
    button.classList.toggle("btn-secondary", isVisible);
    const label = isVisible ? "Hide settings" : "Show settings";
    button.setAttribute("aria-label", label);
    button.setAttribute("title", label);
    const hiddenLabel = button.querySelector(".visually-hidden");
    if (hiddenLabel) hiddenLabel.textContent = label;
}

function setAdvancedSettingsVisible(isVisible) {
    const container = document.getElementById("replay-advanced-settings");
    if (!container) return;
    if (advancedSettingsCollapse) {
        if (isVisible) {
            advancedSettingsCollapse.show();
        } else {
            advancedSettingsCollapse.hide();
        }
        return;
    }
    container.classList.toggle("show", isVisible);
    updateSettingsToggleButton(isVisible);
}

function waitMs(milliseconds) {
    return new Promise((resolve) => {
        window.setTimeout(resolve, milliseconds);
    });
}

async function runReplayTour() {
    if (!getLocalBool(STORAGE_TOUR_REPLAY, true)) return;
    if (!window.Shepherd) return;

    const settingsElement = document.getElementById("replay-advanced-settings");
    const settingsInitiallyVisible = Boolean(settingsElement?.classList.contains("show"));

    const ensureSettingsVisible = async () => {
        if (!settingsElement) return;
        if (settingsElement.classList.contains("show")) return;
        setAdvancedSettingsVisible(true);
        await waitMs(260);
    };

    const restoreSettingsState = () => {
        if (settingsInitiallyVisible) return;
        setAdvancedSettingsVisible(false);
    };

    const tour = new window.Shepherd.Tour({
        useModalOverlay: true,
        defaultStepOptions: {
            classes: "shadow-md bg-white",
            scrollTo: true,
            cancelIcon: {
                enabled: true,
            },
        },
    });

    tour.addStep({
        id: "replay-tour-intro",
        text: '<strong>Quick tour</strong><br>Click the "X" icon to skip anytime.',
        buttons: [
            { text: "Next", action: tour.next },
        ],
    });

    tour.addStep({
        id: "replay-tour-activity-dataset",
        text: "Choose the NeuroPAL activity dataset used for replay.",
        attachTo: {
            element: "#select-activity-dataset",
            on: "bottom",
        },
        buttons: [
            { text: "Next", action: tour.next },
        ],
    });

    tour.addStep({
        id: "replay-tour-connectome-dataset",
        text: "Pick the connectome dataset to pair with activity.",
        attachTo: {
            element: "#select-connectome-dataset",
            on: "bottom",
        },
        buttons: [
            { text: "Next", action: tour.next },
        ],
    });

    tour.addStep({
        id: "replay-tour-neurons",
        text: "Filter neurons here. Clear resets the neuron selection quickly.",
        attachTo: {
            element: ".replay-neuron-controls",
            on: "bottom",
        },
        buttons: [
            { text: "Next", action: tour.next },
        ],
    });

    tour.addStep({
        id: "replay-tour-settings",
        text: "Open advanced settings for layout, edge/node encodings, and color ranges.",
        attachTo: {
            element: "#button-toggle-settings",
            on: "left",
        },
        buttons: [
            { text: "Next", action: tour.next },
        ],
        beforeShowPromise: ensureSettingsVisible,
    });

    tour.addStep({
        id: "replay-tour-advanced-controls",
        text: "These controls define edge type thresholds, visual mappings, colormaps, and vmin/vmax ranges.",
        attachTo: {
            element: "#replay-advanced-settings",
            on: "top",
        },
        buttons: [
            { text: "Next", action: tour.next },
        ],
        beforeShowPromise: ensureSettingsVisible,
    });

    tour.addStep({
        id: "replay-tour-load-replay",
        text: "Press Load Replay after changing config so graph layout, filters, and ranges are applied.",
        attachTo: {
            element: "#button-load-replay",
            on: "top",
        },
        buttons: [
            { text: "Next", action: tour.next },
        ],
    });

    tour.addStep({
        id: "replay-tour-graph",
        text: "Connectome Dynamics: click a node to inspect its trace, Cmd/Ctrl-click to multi-select, and click edges for mode-specific values.",
        attachTo: {
            element: "#replay-graph",
            on: "top",
        },
        buttons: [
            { text: "Next", action: tour.next },
        ],
    });

    tour.addStep({
        id: "replay-tour-behavior",
        text: "Behavior traces stay synchronized with replay time; select one or more behaviors from the selector.",
        attachTo: {
            element: "#replay-behavior-plot",
            on: "top",
        },
        buttons: [
            { text: "Next", action: tour.next },
        ],
    });

    tour.addStep({
        id: "replay-tour-timeline",
        text: "Use playback controls and the timeline slider to step through time points.",
        attachTo: {
            element: ".replay-timeline-row",
            on: "top",
        },
        buttons: [
            { text: "Next", action: tour.next },
        ],
    });

    tour.addStep({
        id: "replay-tour-open-explore",
        text: "Open the current selection in Activity Plot for deeper trace/behavior inspection.",
        attachTo: {
            element: "#button-open-explore",
            on: "top",
        },
        buttons: [
            { text: "Complete", action: tour.complete },
        ],
    });

    const markTourDone = () => {
        setLocalBool(STORAGE_TOUR_REPLAY, false);
        restoreSettingsState();
        window.scrollTo(0, 0);
    };

    tour.on("complete", markTourDone);
    tour.on("cancel", markTourDone);

    tour.start();
}

function escapeHtml(str) {
    return str
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function getPercentile(values, percentile, fallback = 0) {
    const clean = values
        .filter((value) => Number.isFinite(value))
        .sort((a, b) => a - b);
    if (clean.length === 0) return fallback;
    if (clean.length === 1) return clean[0];

    const p = clamp(percentile, 0, 1);
    const index = (clean.length - 1) * p;
    const low = Math.floor(index);
    const high = Math.ceil(index);
    if (low === high) return clean[low];
    const ratio = index - low;
    return clean[low] * (1 - ratio) + clean[high] * ratio;
}

function normalizeRange(vmin, vmax, fallback = { vmin: -1, vmax: 1 }) {
    let minValue = Number.isFinite(vmin) ? vmin : fallback.vmin;
    let maxValue = Number.isFinite(vmax) ? vmax : fallback.vmax;
    if (maxValue <= minValue) {
        const pad = Math.max(Math.abs(minValue) * 0.01, 1e-6);
        maxValue = minValue + pad;
    }
    return { vmin: minValue, vmax: maxValue };
}

function getNodeModeFallback(mode) {
    const normalizedMode = normalizeNodeMode(mode);
    if (normalizedMode === "activity" || isBehaviorCorrelationMode(normalizedMode)) {
        return { vmin: -1, vmax: 1, byAbs: true };
    }
    return { vmin: 0, vmax: 1, byAbs: false };
}

function getNodeDegreeMetric(node, mode) {
    const normalizedMode = normalizeNodeMode(mode);
    if (normalizedMode === "degree_in") {
        return Number(node?.degree_in_full ?? node?.degree_in ?? 0);
    }
    if (normalizedMode === "degree_out") {
        return Number(node?.degree_out_full ?? node?.degree_out ?? 0);
    }
    return Number(node?.degree_total_full ?? node?.degree_out_full ?? node?.degree_out ?? 0);
}

function getNodeMetricValue(node, mode, activityValue) {
    const normalizedMode = normalizeNodeMode(mode);
    const safeActivity = Number.isFinite(activityValue) ? activityValue : 0;
    switch (normalizedMode) {
        case "activity":
            return safeActivity;
        case "degree_total":
        case "degree_in":
        case "degree_out":
            return getNodeDegreeMetric(node, normalizedMode);
        case "pagerank":
            return Number(node?.pagerank_centrality ?? 0);
        case "eigenvector":
            return Number(node?.eigenvector_centrality ?? 0);
        default:
            if (isBehaviorCorrelationMode(normalizedMode)) {
                const behaviorKey = getBehaviorKeyFromNodeMode(normalizedMode);
                return Number(node?.behavior_correlations?.[behaviorKey] ?? 0);
            }
            return safeActivity;
    }
}

function computeNodeAutoRanges(payload) {
    const nodes = payload?.nodes || [];
    const behaviorKeys = Object.keys(payload?.behavior?.traces || {});
    const valuesByMode = {
        activity: [],
        degree_total: [],
        degree_in: [],
        degree_out: [],
        pagerank: [],
        eigenvector: [],
    };
    behaviorKeys.forEach((behaviorKey) => {
        valuesByMode[`${NODE_BEHAVIOR_MODE_PREFIX}${behaviorKey}`] = [];
    });

    nodes.forEach((node) => {
        const trace = node.trace || [];
        trace.forEach((value) => {
            if (Number.isFinite(value)) {
                valuesByMode.activity.push(value);
            }
        });
        valuesByMode.degree_total.push(getNodeMetricValue(node, "degree_total", 0));
        valuesByMode.degree_in.push(getNodeMetricValue(node, "degree_in", 0));
        valuesByMode.degree_out.push(getNodeMetricValue(node, "degree_out", 0));
        valuesByMode.pagerank.push(getNodeMetricValue(node, "pagerank", 0));
        valuesByMode.eigenvector.push(getNodeMetricValue(node, "eigenvector", 0));
        behaviorKeys.forEach((behaviorKey) => {
            const mode = `${NODE_BEHAVIOR_MODE_PREFIX}${behaviorKey}`;
            valuesByMode[mode].push(getNodeMetricValue(node, mode, 0));
        });
    });

    const nextRanges = {};
    Object.entries(valuesByMode).forEach(([mode, values]) => {
        const fallback = getNodeModeFallback(mode);
        const vmin = getPercentile(values, 0.05, fallback.vmin);
        const vmax = getPercentile(values, 0.95, fallback.vmax);
        const abs95 = Math.max(getPercentile(values.map((value) => Math.abs(value)), 0.95, 1), 1e-6);
        nextRanges[mode] = {
            ...normalizeRange(vmin, vmax, { vmin: fallback.vmin, vmax: fallback.vmax }),
            abs95: abs95,
        };
    });
    nodeAutoRanges = nextRanges;
}

function setNodeColorRangeForMode(mode) {
    const normalizedMode = normalizeNodeMode(mode);
    const modeFallback = getNodeModeFallback(normalizedMode);
    const range = nodeAutoRanges[normalizedMode]
        || { vmin: modeFallback.vmin, vmax: modeFallback.vmax };
    const inputVMin = document.getElementById("input-node-vmin");
    const inputVMax = document.getElementById("input-node-vmax");
    inputVMin.value = Number(range.vmin).toFixed(3);
    inputVMax.value = Number(range.vmax).toFixed(3);
    updateColorBars();
}

function getNodeColorSettings() {
    const colorMode = normalizeNodeMode(document.getElementById("select-node-color-mode").value);
    const colormap = document.getElementById("select-node-colormap").value;
    const inputVMin = Number.parseFloat(document.getElementById("input-node-vmin").value);
    const inputVMax = Number.parseFloat(document.getElementById("input-node-vmax").value);
    const modeFallback = getNodeModeFallback(colorMode);
    const fallback = { vmin: modeFallback.vmin, vmax: modeFallback.vmax };
    const { vmin, vmax } = normalizeRange(inputVMin, inputVMax, fallback);

    return {
        colorMode,
        colormap,
        vmin,
        vmax,
    };
}

function getNodeColorValue(node, activityValue, colorMode) {
    return getNodeMetricValue(node, colorMode, activityValue);
}

function getNodeSizeValue(node, activityValue, sizeMode) {
    return getNodeMetricValue(node, sizeMode, activityValue);
}

function getNodeSizeNormalization(sizeMode) {
    const normalizedMode = normalizeNodeMode(sizeMode);
    const modeFallback = getNodeModeFallback(normalizedMode);
    const autoRange = nodeAutoRanges[normalizedMode];
    if (modeFallback.byAbs) {
        return { min: 0, max: autoRange?.abs95 ?? 1, byAbs: true };
    }
    return {
        min: autoRange?.vmin ?? modeFallback.vmin,
        max: autoRange?.vmax ?? modeFallback.vmax,
        byAbs: false,
    };
}

function mapValueToNodeSize(value, normalization) {
    if (normalization.byAbs) {
        const scaled = clamp(Math.abs(value) / Math.max(normalization.max, 1e-6), 0, 1);
        return 18 + scaled * 26;
    }

    const denom = Math.max(normalization.max - normalization.min, 1e-6);
    const scaled = clamp((value - normalization.min) / denom, 0, 1);
    return 18 + scaled * 26;
}

function mapValueToNodeBorder(size) {
    const normalizedSize = clamp((size - 18) / 26, 0, 1);
    return 1.1 + normalizedSize * 1.8;
}

function parseRgbChannels(color) {
    if (typeof color !== "string") return null;
    const match = color.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
    if (!match) return null;
    return [
        Number.parseFloat(match[1]),
        Number.parseFloat(match[2]),
        Number.parseFloat(match[3]),
    ];
}

function getNodeLabelColorForFill(fillColor) {
    const channels = parseRgbChannels(fillColor);
    if (!channels) return "#0f172a";
    const [r, g, b] = channels.map((value) => clamp(value, 0, 255));
    const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    return luminance < 0.52 ? "#f8fafc" : "#0f172a";
}

function valueToNodeColor(value, settings) {
    try {
        return getNodeColor(value, settings.vmin, settings.vmax, settings.colormap);
    } catch (error) {
        return getNodeColor(value, settings.vmin, settings.vmax, DEFAULTS.nodeColormap);
    }
}

function normalizeEdgeMode(mode) {
    if (mode === "source_only" || mode === "count") return mode;
    return "weighted_source";
}

function getEdgeBaseWidth(weight, scaleFactor) {
    const numericWeight = Number.isFinite(Number(weight)) ? Number(weight) : 0;
    const numericScale = Number.isFinite(Number(scaleFactor)) ? Number(scaleFactor) : 1;
    // Match other connectome viewers: log(count + 1) * edge scaling factor.
    return Math.log(numericWeight + 1) * clamp(numericScale, EDGE_SCALE_MIN, EDGE_SCALE_MAX);
}

function computeEdgeAutoRanges(payload) {
    const edges = payload?.edges || [];
    const nodes = payload?.nodes || [];

    const countValues = [];
    const sourceOnlyValues = [];
    const weightedSourceValues = [];

    const tracesByNode = new Map();
    nodes.forEach((node) => {
        const trace = Array.isArray(node.trace) ? node.trace : [];
        tracesByNode.set(node.id, trace);
        trace.forEach((value) => {
            if (Number.isFinite(value)) {
                sourceOnlyValues.push(value);
            }
        });
    });

    edges.forEach((edge) => {
        const weight = Number(edge.weight);
        if (!Number.isFinite(weight)) return;
        countValues.push(weight);

        const sourceTrace = tracesByNode.get(edge.source);
        if (!sourceTrace) return;

        sourceTrace.forEach((sourceActivity) => {
            if (!Number.isFinite(sourceActivity)) return;
            weightedSourceValues.push(sourceActivity * weight);
        });
    });

    const buildEdgeRange = (values, fallback) => {
        const range = normalizeRange(
            getPercentile(values, 0.05, fallback.vmin),
            getPercentile(values, 0.95, fallback.vmax),
            fallback
        );
        return {
            ...range,
            abs95: Math.max(
                getPercentile(values.map((value) => Math.abs(value)), 0.95, Math.max(Math.abs(fallback.vmin), Math.abs(fallback.vmax), 1)),
                1e-6
            ),
        };
    };

    edgeAutoRanges = {
        count: buildEdgeRange(countValues, { vmin: 0, vmax: 1 }),
        source_only: buildEdgeRange(sourceOnlyValues, { vmin: -1, vmax: 1 }),
        weighted_source: buildEdgeRange(weightedSourceValues, { vmin: -1, vmax: 1 }),
    };
}

function setEdgeColorRangeForMode(mode) {
    const modeKey = normalizeEdgeMode(mode);
    const fallback = modeKey === "count" ? { vmin: 0, vmax: 1 } : { vmin: -1, vmax: 1 };
    const range = edgeAutoRanges[modeKey] || fallback;
    const inputVMin = document.getElementById("input-edge-vmin");
    const inputVMax = document.getElementById("input-edge-vmax");
    inputVMin.value = Number(range.vmin).toFixed(3);
    inputVMax.value = Number(range.vmax).toFixed(3);
    updateColorBars();
}

function getEdgeColorSettings() {
    const mode = normalizeEdgeMode(document.getElementById("select-edge-color-mode").value);
    const colormap = document.getElementById("select-edge-colormap").value;
    const inputVMin = Number.parseFloat(document.getElementById("input-edge-vmin").value);
    const inputVMax = Number.parseFloat(document.getElementById("input-edge-vmax").value);
    const fallback = mode === "count" ? { vmin: 0, vmax: 1 } : { vmin: -1, vmax: 1 };
    const { vmin, vmax } = normalizeRange(inputVMin, inputVMax, fallback);

    return {
        mode,
        colormap,
        vmin,
        vmax,
    };
}

function getEdgeSizeNormalization(mode) {
    const modeKey = normalizeEdgeMode(mode);
    const fallback = modeKey === "count"
        ? { vmin: 0, vmax: 1, abs95: 1 }
        : { vmin: -1, vmax: 1, abs95: 1 };
    const range = edgeAutoRanges[modeKey] || fallback;
    if (modeKey === "count") {
        return {
            byAbs: false,
            min: range.vmin,
            max: range.vmax,
        };
    }
    return {
        byAbs: true,
        max: Math.max(range.abs95, 1e-6),
    };
}

function normalizeEdgeSizeValue(value, normalization) {
    const numericValue = Number.isFinite(value) ? value : 0;
    if (normalization.byAbs) {
        return clamp(Math.abs(numericValue) / Math.max(normalization.max, 1e-6), 0, 1);
    }
    const minValue = Number.isFinite(normalization.min) ? normalization.min : 0;
    const maxValue = Number.isFinite(normalization.max) ? normalization.max : 1;
    const denom = Math.max(maxValue - minValue, 1e-6);
    return clamp((numericValue - minValue) / denom, 0, 1);
}

function valueToEdgeColor(value, settings) {
    try {
        return getNodeColor(value, settings.vmin, settings.vmax, settings.colormap);
    } catch (error) {
        return getNodeColor(value, settings.vmin, settings.vmax, DEFAULTS.edgeColormap);
    }
}

function formatReplayTimeLabel(minutesValue, frameIndex) {
    const minutes = Number.isFinite(minutesValue) ? minutesValue : 0;
    const totalSeconds = Math.max(0, Math.round(minutes * 60));
    const mm = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
    const ss = String(totalSeconds % 60).padStart(2, "0");
    return `${mm}:${ss} (t=${frameIndex + 1})`;
}

function syncLoadingUi() {
    const spinner = document.getElementById("replay-spinner");
    const isBusy = isReplayLoading || isNeuronFilterPending || isNeuronFilterApplying;
    if (spinner) {
        spinner.style.visibility = isBusy ? "visible" : "hidden";
    }
    const loadButton = document.getElementById("button-load-replay");
    if (loadButton) {
        loadButton.disabled = isReplayLoading;
    }
}

function setLoading(isLoading) {
    isReplayLoading = Boolean(isLoading);
    syncLoadingUi();
}

function setNeuronFilterPending(isPending) {
    isNeuronFilterPending = Boolean(isPending);
    syncLoadingUi();
}

function setNeuronFilterApplying(isApplying) {
    isNeuronFilterApplying = Boolean(isApplying);
    syncLoadingUi();
}

function getDebouncedNeuronFilterApply() {
    if (!debouncedNeuronFilterApply) {
        debouncedNeuronFilterApply = debounce(() => {
            setNeuronFilterPending(false);
            if (isReplayLoading || !rawReplayPayload) return;

            setNeuronFilterApplying(true);
            const runFilter = () => {
                try {
                    applyNeuronFilter();
                } finally {
                    setNeuronFilterApplying(false);
                }
            };
            if (typeof window.requestAnimationFrame === "function") {
                window.requestAnimationFrame(runFilter);
            } else {
                runFilter();
            }
        }, NEURON_FILTER_DEBOUNCE_MS);
    }
    return debouncedNeuronFilterApply;
}

function queueNeuronFilterApply() {
    if (isReplayLoading || !rawReplayPayload) return;
    stopPlayback();
    setNeuronFilterPending(true);
    getDebouncedNeuronFilterApply()();
}

function renderError(message) {
    const element = document.getElementById("replay-error");
    if (!message) {
        element.style.display = "none";
        element.textContent = "";
        return;
    }
    element.style.display = "block";
    element.textContent = message;
}

function renderWarnings(warnings) {
    const element = document.getElementById("replay-warnings");
    if (!warnings || warnings.length === 0) {
        element.style.display = "none";
        element.innerHTML = "";
        return;
    }
    element.style.display = "block";
    element.innerHTML = warnings.map((warning) => `<div>${escapeHtml(warning)}</div>`).join("");
}

function renderMeta() {
    const element = document.getElementById("replay-meta");
    if (!rawReplayPayload || !replayPayload) {
        element.textContent = "";
        return;
    }

    const activityOverlap = Number(rawReplayPayload.meta?.n_activity_nodes ?? rawReplayPayload.meta?.n_nodes ?? 0);
    const connectedOnly = Number(rawReplayPayload.meta?.n_connected_only_nodes ?? 0);
    const connectedText = connectedOnly > 0 ? `, connected-only ${connectedOnly}` : "";
    element.textContent = `Filtered ${replayPayload.meta.n_nodes} neurons / ${replayPayload.meta.n_edges} edges (activity overlap ${activityOverlap}${connectedText})`;
}

function updateReplayConnectomeCitation() {
    const citationElement = document.getElementById("replay-connectome-citation");
    if (!citationElement) return;

    const datasetId = selectors.connectomeSelector?.getValue?.() || "";
    const options = selectors.connectomeSelector?.options || {};
    if (!datasetId || !options[datasetId]) {
        citationElement.textContent = "N/A";
        return;
    }
    updateCitation([datasetId], "replay-connectome-citation", options);
}

function updateElectricalInputState() {
    const edgeType = normalizeEdgeType(document.getElementById("select-edge-type").value);
    const inputE = document.getElementById("input-min-synapse-e");
    inputE.disabled = edgeType === "chemical";
}

function getBehaviorColorIndex(behaviorKey, fallbackIndex) {
    if (behaviorColorIndexByKey.has(behaviorKey)) {
        return behaviorColorIndexByKey.get(behaviorKey);
    }
    return fallbackIndex;
}

function getSelectedBehaviorKeys(traces) {
    return currentBehaviorKeys.filter((key) => key in traces);
}

function buildExploreUrl() {
    const activityDataset = selectors.activitySelector?.getValue?.() || "";
    if (!activityDataset) return null;

    const params = new URLSearchParams();
    const selectedBehaviorKeys = currentBehaviorKeys.filter((key) => key);
    if (selectedBehaviorKeys.length > 0) {
        params.set("b", selectedBehaviorKeys.join("-"));
    }

    const hasMatchingReplay = rawReplayPayload
        && rawReplayPayload.meta?.activity_dataset_id === activityDataset;
    if (hasMatchingReplay) {
        const indexedNodes = [
            ...(replayPayload?.nodes || []),
            ...(rawReplayPayload?.nodes || []),
        ];
        const nodeById = new Map(indexedNodes.map((node) => [node.id, node]));
        const selectedNeuronIdx = Array.from(selectedNodeIds)
            .map((nodeId) => nodeById.get(nodeId)?.representative_idx_neuron)
            .filter((idx) => Number.isInteger(idx));
        let deduped = Array.from(new Set(selectedNeuronIdx)).sort((a, b) => a - b);

        if (deduped.length === 0) {
            const firstNode = (replayPayload?.nodes || rawReplayPayload?.nodes || [])
                .find((node) => Number.isInteger(node.representative_idx_neuron));
            if (firstNode) {
                deduped = [firstNode.representative_idx_neuron];
            }
        }

        if (deduped.length > 0) {
            params.set("n", deduped.join("-"));
        }
    }

    const query = params.toString();
    return `/activity/explore/${encodeURIComponent(activityDataset)}/${query ? `?${query}` : ""}`;
}

function updateExploreLink() {
    const buttons = [
        document.getElementById("button-open-explore"),
        document.getElementById("button-open-explore-top"),
    ].filter((button) => Boolean(button));
    if (buttons.length === 0) return;

    const href = buildExploreUrl();
    if (!href) {
        buttons.forEach((button) => {
            button.href = "#";
            button.classList.add("disabled");
            button.setAttribute("aria-disabled", "true");
        });
        return;
    }

    buttons.forEach((button) => {
        button.href = href;
        button.classList.remove("disabled");
        button.setAttribute("aria-disabled", "false");
    });
}

function updateReplayUrlState(options = {}) {
    const includeFrame = options.includeFrame !== false;
    if (!selectors.activitySelector || !selectors.connectomeSelector) return;

    const activityDataset = selectors.activitySelector.getValue();
    const connectomeDataset = selectors.connectomeSelector.getValue();
    if (!activityDataset || !connectomeDataset) return;

    const params = new URLSearchParams();
    setUrlParam(params, "activity_dataset", activityDataset);
    setUrlParam(params, "connectome_dataset", connectomeDataset);

    setUrlParam(params, "layout", document.getElementById("select-layout")?.value || DEFAULTS.layout);
    setUrlParam(params, "edge_type", document.getElementById("select-edge-type")?.value || DEFAULTS.edgeType);
    setUrlParam(
        params,
        "show_connected",
        document.getElementById("switch-replay-show-connected")?.checked ? 1 : 0
    );
    setUrlParam(
        params,
        "min_synapse_chemical",
        document.getElementById("input-min-synapse-c")?.value || DEFAULTS.minSynapseChemical
    );
    setUrlParam(
        params,
        "min_synapse_electrical",
        document.getElementById("input-min-synapse-e")?.value || DEFAULTS.minSynapseElectrical
    );
    setUrlParam(params, "spacing", document.getElementById("slider-spacing")?.value || DEFAULTS.spacing);
    setUrlParam(params, "edge_scale", document.getElementById("slider-edge-scale")?.value || DEFAULTS.edgeScale);
    setUrlParam(
        params,
        "edge_size_mode",
        document.getElementById("select-edge-size-mode")?.value || DEFAULTS.edgeSizeMode
    );
    setUrlParam(
        params,
        "edge_color_mode",
        document.getElementById("select-edge-color-mode")?.value || DEFAULTS.edgeColorMode
    );
    setUrlParam(
        params,
        "edge_colormap",
        document.getElementById("select-edge-colormap")?.value || DEFAULTS.edgeColormap
    );
    setUrlParam(params, "edge_vmin", document.getElementById("input-edge-vmin")?.value);
    setUrlParam(params, "edge_vmax", document.getElementById("input-edge-vmax")?.value);
    setUrlParam(
        params,
        "node_size_mode",
        document.getElementById("select-node-size-mode")?.value || DEFAULTS.nodeSizeMode
    );
    setUrlParam(
        params,
        "node_color_mode",
        document.getElementById("select-node-color-mode")?.value || DEFAULTS.nodeColorMode
    );
    setUrlParam(
        params,
        "node_colormap",
        document.getElementById("select-node-colormap")?.value || DEFAULTS.nodeColormap
    );
    setUrlParam(params, "node_vmin", document.getElementById("input-node-vmin")?.value);
    setUrlParam(params, "node_vmax", document.getElementById("input-node-vmax")?.value);
    setUrlParam(params, "speed", document.getElementById("select-speed")?.value || DEFAULTS.speed);
    setUrlParam(params, "show_reversal", showBehaviorReversal ? 1 : 0);
    setUrlParam(params, "show_event", showBehaviorEvent ? 1 : 0);

    const neuronItems = selectors.neuronSelector?.items?.slice() || [];
    const neuronOptionCount = selectors.neuronSelector
        ? Object.keys(selectors.neuronSelector.options || {}).length
        : 0;
    if (neuronItems.length > 0 && neuronItems.length < neuronOptionCount) {
        const idxById = new Map([
            ...((replayPayload?.nodes || []).map((node) => [node.id, node.representative_idx_neuron])),
            ...((rawReplayPayload?.nodes || []).map((node) => [node.id, node.representative_idx_neuron])),
        ]);
        const selectedIndices = neuronItems
            .map((nodeId) => idxById.get(nodeId))
            .filter((idx) => Number.isInteger(idx) && idx >= 1);
        const dedupedIndices = Array.from(new Set(selectedIndices)).sort((a, b) => a - b);
        if (dedupedIndices.length > 0) {
            setUrlParam(params, "n", dedupedIndices.join("-"));
        }
    }

    const behaviorItems = currentBehaviorKeys.filter((item) => item);
    if (behaviorItems.length > 0) {
        setUrlParam(params, "behaviors", behaviorItems.join(","));
    }

    if (includeFrame && Number.isInteger(currentFrame) && currentFrame >= 0) {
        setUrlParam(params, "tp", currentFrame);
    }

    const query = params.toString();
    const newUrl = `${window.location.pathname}${query ? `?${query}` : ""}`;
    const currentUrl = `${window.location.pathname}${window.location.search}`;
    if (newUrl !== currentUrl) {
        window.history.replaceState({}, "", newUrl);
    }
}

function formatEdgeInfoNumber(value, digits = 4) {
    if (!Number.isFinite(value)) return "n/a";
    return Number(value).toFixed(digits);
}

function getEdgeModeLabel(mode) {
    if (mode === "weighted_source") return "Outgoing source activity x synapse";
    if (mode === "source_only") return "Outgoing source activity only";
    return "Connectome counts";
}

function renderEdgeInfo(message) {
    const element = document.getElementById("replay-edge-info");
    if (!element) return;
    element.innerHTML = message;
}

function setNodeInfoMoreButtonVisible(isVisible) {
    const button = document.getElementById("button-node-info-more");
    if (!button) return;
    const visible = Boolean(isVisible);
    button.classList.toggle("is-visible", visible);
    button.disabled = !visible;
}

function clearEdgeInfo() {
    selectedEdgeId = null;
    selectedNodeInfoId = null;
    renderEdgeInfo("Click a node or edge to inspect mode-specific values.");
    setNodeInfoMoreButtonVisible(false);
}

function getNodeInfoLabel(node) {
    const nodeId = node?.id?.() || "";
    const idx = node?.data?.("representative_idx_neuron");
    if (Number.isInteger(idx) && idx >= 1) {
        return `${idx} (${nodeId})`;
    }
    return nodeId;
}

function renderSelectedNodeInfo(node) {
    if (!node || node.empty()) {
        clearEdgeInfo();
        return;
    }

    const sizeModeLabel = getSelectLabel("select-node-size-mode", "Node size");
    const colorModeLabel = getSelectLabel("select-node-color-mode", "Node color");
    const sizeMode = normalizeNodeMode(document.getElementById("select-node-size-mode").value);
    const colorMode = normalizeNodeMode(document.getElementById("select-node-color-mode").value);
    const trace = node.data("trace") || [];
    const nodeData = node.data();
    const hasActivity = Boolean(nodeData.has_activity);
    const activityValue = hasActivity ? trace[currentFrame] : null;
    const sizeValue = getNodeSizeValue(nodeData, activityValue, sizeMode);
    const colorValue = getNodeColorValue(nodeData, activityValue, colorMode);
    const label = escapeHtml(getNodeInfoLabel(node));
    const degreeTotal = formatEdgeInfoNumber(getNodeDegreeMetric(nodeData, "degree_total"), 2);
    const activityText = hasActivity
        ? formatEdgeInfoNumber(activityValue, 4)
        : "n/a (no activity trace)";
    const sizeText = formatEdgeInfoNumber(sizeValue, 4);
    const colorText = formatEdgeInfoNumber(colorValue, 4);

    renderEdgeInfo(
        `<strong>${label}</strong><br>`
        + `<span><strong>Activity:</strong> ${activityText}</span> `
        + `<span class="text-muted">| </span>`
        + `<span><strong>Size (${escapeHtml(sizeModeLabel)}):</strong> ${sizeText}</span> `
        + `<span class="text-muted">| </span>`
        + `<span><strong>Color (${escapeHtml(colorModeLabel)}):</strong> ${colorText}</span> `
        + `<span class="text-muted">| degree total=${degreeTotal}</span>`
    );
    setNodeInfoMoreButtonVisible(false);
}

function getSelectedNodeElementsSorted() {
    if (!cy || selectedNodeIds.size === 0) return [];
    const nodes = Array.from(selectedNodeIds)
        .map((nodeId) => cy.getElementById(nodeId))
        .filter((node) => node && !node.empty());
    nodes.sort((a, b) => {
        const aIdx = a.data("representative_idx_neuron");
        const bIdx = b.data("representative_idx_neuron");
        const aHasIdx = Number.isInteger(aIdx);
        const bHasIdx = Number.isInteger(bIdx);
        if (aHasIdx && bHasIdx && aIdx !== bIdx) return aIdx - bIdx;
        if (aHasIdx && !bHasIdx) return -1;
        if (!aHasIdx && bHasIdx) return 1;
        return a.id().localeCompare(b.id());
    });
    return nodes;
}

function buildTruncatedNodeLabelList(labels, maxChars = 84) {
    if (!labels || labels.length === 0) {
        return { text: "", truncated: false };
    }
    const full = labels.join(", ");
    if (full.length <= maxChars) {
        return { text: full, truncated: false };
    }

    const kept = [];
    let usedChars = 0;
    for (let i = 0; i < labels.length; i++) {
        const part = labels[i];
        const separator = kept.length > 0 ? 2 : 0;
        const projected = usedChars + separator + part.length;
        if (projected > maxChars && kept.length > 0) break;
        if (projected > maxChars) {
            kept.push(part.slice(0, Math.max(0, maxChars - 3)) + "...");
            usedChars = maxChars;
            break;
        }
        kept.push(part);
        usedChars = projected;
    }
    const remaining = Math.max(0, labels.length - kept.length);
    let text = kept.join(", ");
    if (remaining > 0) {
        text = `${text} ... (+${remaining})`;
    }
    return { text: text, truncated: true };
}

function renderSelectedNodesSummary() {
    const selectedNodes = getSelectedNodeElementsSorted();
    if (selectedNodes.length <= 1) {
        if (selectedNodes.length === 1) {
            renderSelectedNodeInfo(selectedNodes[0]);
            return;
        }
        clearEdgeInfo();
        return;
    }

    const labels = selectedNodes.map((node) => getNodeInfoLabel(node));
    const summary = buildTruncatedNodeLabelList(labels);
    renderEdgeInfo(escapeHtml(summary.text));
    setNodeInfoMoreButtonVisible(true);
}

function renderSelectedNodesModalContent() {
    const modalTitle = document.getElementById("replay-node-info-modal-label");
    const modalBody = document.getElementById("replay-node-info-modal-body");
    if (!modalTitle || !modalBody) return;

    const selectedNodes = getSelectedNodeElementsSorted();
    if (selectedNodes.length === 0) {
        modalTitle.textContent = "Selected Neuron Details";
        modalBody.textContent = "No selected neurons.";
        return;
    }

    const sizeModeLabel = getSelectLabel("select-node-size-mode", "Node size");
    const colorModeLabel = getSelectLabel("select-node-color-mode", "Node color");
    const sizeMode = normalizeNodeMode(document.getElementById("select-node-size-mode").value);
    const colorMode = normalizeNodeMode(document.getElementById("select-node-color-mode").value);
    const timeValue = replayPayload?.timeline?.time_minutes?.[currentFrame];
    const timeLabel = formatReplayTimeLabel(timeValue, currentFrame);

    const rows = selectedNodes
        .map((node) => {
            const nodeData = node.data();
            const trace = nodeData.trace || [];
            const hasActivity = Boolean(nodeData.has_activity);
            const activityValue = hasActivity ? trace[currentFrame] : null;
            const sizeValue = getNodeSizeValue(nodeData, activityValue, sizeMode);
            const colorValue = getNodeColorValue(nodeData, activityValue, colorMode);
            const degreeTotal = getNodeDegreeMetric(nodeData, "degree_total");
            const activityText = hasActivity
                ? formatEdgeInfoNumber(activityValue, 4)
                : "n/a";
            return (
                `<tr>`
                + `<td>${escapeHtml(getNodeInfoLabel(node))}</td>`
                + `<td>${activityText}</td>`
                + `<td>${formatEdgeInfoNumber(sizeValue, 4)}</td>`
                + `<td>${formatEdgeInfoNumber(colorValue, 4)}</td>`
                + `<td>${formatEdgeInfoNumber(degreeTotal, 2)}</td>`
                + `</tr>`
            );
        })
        .join("");

    modalTitle.textContent = `Selected Neuron Details (${selectedNodes.length})`;
    modalBody.innerHTML = (
        `<div class="text-muted mb-2">Time point ${escapeHtml(timeLabel)}</div>`
        + `<div class="text-muted mb-2">Size mode: ${escapeHtml(sizeModeLabel)} | Color mode: ${escapeHtml(colorModeLabel)}</div>`
        + `<div class="table-responsive">`
        + `<table class="table table-sm align-middle mb-0">`
        + `<thead><tr><th>Neuron</th><th>Activity</th><th>Size</th><th>Color</th><th>Degree total</th></tr></thead>`
        + `<tbody>${rows}</tbody>`
        + `</table>`
        + `</div>`
    );
}

function renderSelectedEdgeInfo(edge) {
    if (!edge || edge.empty()) {
        clearEdgeInfo();
        return;
    }

    const sizeMode = normalizeEdgeMode(document.getElementById("select-edge-size-mode").value);
    const colorMode = normalizeEdgeMode(document.getElementById("select-edge-color-mode").value);
    const source = escapeHtml(edge.data("source"));
    const target = escapeHtml(edge.data("target"));
    const edgeType = edge.data("edge_type") === "electrical" ? "Electrical" : "Chemical";
    const weight = formatEdgeInfoNumber(edge.data("weight"), 2);
    const sourceActivity = formatEdgeInfoNumber(edge.data("frame_source_activity"), 4);
    const sizeValue = formatEdgeInfoNumber(edge.data("frame_size_value"), 4);
    const colorValue = formatEdgeInfoNumber(edge.data("frame_color_value"), 4);
    const intensity = formatEdgeInfoNumber(edge.data("frame_signal"), 4);

    renderEdgeInfo(
        `<strong>${source} → ${target}</strong> `
        + `<span class="text-muted">(${edgeType}, count=${weight})</span><br>`
        + `<span><strong>Size (${escapeHtml(getEdgeModeLabel(sizeMode))}):</strong> ${sizeValue}</span> `
        + `<span class="text-muted">| </span>`
        + `<span><strong>Color (${escapeHtml(getEdgeModeLabel(colorMode))}):</strong> ${colorValue}</span> `
        + `<span class="text-muted">| source activity=${sourceActivity}, visual intensity=${intensity}</span>`
    );
    setNodeInfoMoreButtonVisible(false);
}

function refreshSelectedEdgeInfo() {
    if (!cy || !selectedEdgeId) return;
    const edge = cy.getElementById(selectedEdgeId);
    if (!edge || edge.empty()) {
        clearEdgeInfo();
        return;
    }
    renderSelectedEdgeInfo(edge);
}

function refreshSelectedNodeInfo() {
    if (selectedNodeIds.size > 1) {
        renderSelectedNodesSummary();
        return;
    }
    if (!cy || !selectedNodeInfoId) return;
    const node = cy.getElementById(selectedNodeInfoId);
    if (!node || node.empty()) {
        selectedNodeInfoId = null;
        if (!selectedEdgeId) {
            renderEdgeInfo("Click a node or edge to inspect mode-specific values.");
            setNodeInfoMoreButtonVisible(false);
        }
        return;
    }
    renderSelectedNodeInfo(node);
}

function buildDatasetSelectors() {
    const activitySelector = new TomSelect("#select-activity-dataset", {
        options: replayActivityDatasets.map((dataset) => ({
            value: dataset.dataset_id,
            name: dataset.dataset_name,
            paper: dataset.paper_title,
        })),
        maxItems: 1,
        valueField: "value",
        labelField: "name",
        searchField: ["value", "name", "paper"],
        sortField: [{ field: "name" }],
        plugins: ["dropdown_input"],
        render: {
            option: (data, escape) => {
                const paper = data.paper ? `<span class="text-muted ms-1">${escape(data.paper)}</span>` : "";
                return `<div><strong>${escape(data.name)}</strong>${paper}</div>`;
            },
            item: (data, escape) => {
                const paper = data.paper ? `<span class="text-muted ms-1">${escape(data.paper)}</span>` : "";
                return `<div><strong>${escape(data.name)}</strong>${paper}</div>`;
            },
        },
    });

    const groups = [];
    const seenGroup = new Set();
    replayConnectomeDatasets.forEach((dataset) => {
        const group = dataset.dataset_type || "other";
        if (!seenGroup.has(group)) {
            seenGroup.add(group);
            groups.push({
                value: group,
                label: group.charAt(0).toUpperCase() + group.slice(1),
            });
        }
    });

    const connectomeSelector = new TomSelect("#select-connectome-dataset", {
        options: replayConnectomeDatasets.map((dataset) => ({
            ...dataset,
            value: dataset.dataset_id,
        })),
        optgroups: groups,
        optgroupField: "dataset_type",
        maxItems: 1,
        valueField: "value",
        labelField: "name",
        searchField: ["dataset_id", "name", "description"],
        sortField: [{ field: "name" }],
        plugins: ["dropdown_input"],
        render: {
            option: (data, escape) => {
                const description = data.description
                    ? `<span class="text-muted ms-1">${escape(data.description)}</span>`
                    : "";
                return `<div><strong>${escape(data.name)}</strong>${description}</div>`;
            },
            optgroup_header: (data, escape) => `<div class="optgroup-header"><strong>${escape(data.label)}</strong></div>`,
        },
    });

    return { activitySelector, connectomeSelector };
}

function buildNeuronAndBehaviorSelectors() {
    const neuronSelector = new TomSelect("#select-neurons", {
        plugins: ["n_items", "checkbox_options", "dropdown_input"],
        persist: false,
        create: false,
        maxOptions: null,
        valueField: "value",
        labelField: "name",
        searchField: ["name"],
        sortField: [{ field: "idx" }, { field: "name" }],
        onChange: () => {
            queueNeuronFilterApply();
        },
    });

    const behaviorSelector = new TomSelect("#select-behavior", {
        plugins: ["n_items", "checkbox_options", "dropdown_input"],
        persist: false,
        create: false,
        maxItems: null,
        valueField: "value",
        labelField: "name",
        searchField: ["name"],
        sortField: [{ field: "order" }, { field: "name" }],
        onChange: (value) => {
            currentBehaviorKeys = parseTomSelectValues(value);
            renderBehaviorPlot();
            updateBehaviorCursor();
            updateExploreLink();
            updateReplayUrlState();
        },
    });

    return { neuronSelector, behaviorSelector };
}

function resetNeuronSelectorOptions(nodes, preferredSelection = [], preferredIsAll = false) {
    const selector = selectors.neuronSelector;
    selector.clear(true);
    selector.clearOptions();
    selector.clearCache();

    const options = nodes
        .map((node) => {
            const idx = Number.isInteger(node.representative_idx_neuron)
                ? node.representative_idx_neuron
                : null;
            const baseLabel = idx !== null ? `${idx} (${node.id})` : node.id;
            const hasActivity = Boolean(node.has_activity);
            const label = hasActivity ? baseLabel : `${baseLabel} (connected only)`;
            return {
                value: node.id,
                name: label,
                idx: idx || Number.MAX_SAFE_INTEGER,
                neuronName: node.id,
            };
        })
        .sort((a, b) => {
            if (a.idx !== b.idx) return a.idx - b.idx;
            return a.neuronName.localeCompare(b.neuronName);
        });
    selector.addOptions(options);

    const available = new Set(options.map((option) => option.value));
    const preferred = parseTomSelectValues(preferredSelection)
        .filter((value) => available.has(value));
    const selectedValues = preferredIsAll
        ? options.map((option) => option.value)
        : (preferred.length > 0 ? preferred : options.map((option) => option.value));
    selector.setValue(selectedValues, true);
}

function resetBehaviorSelectorOptions(behaviorData, preferredSelection = []) {
    const selector = selectors.behaviorSelector;
    selector.clear(true);
    selector.clearOptions();
    selector.clearCache();
    behaviorColorIndexByKey = new Map();

    const traces = behaviorData?.traces || {};
    const options = Object.keys(traces)
        .map((key, idx) => {
            const colorIndex = Number.isFinite(Number(traces[key]?.i))
                ? Number(traces[key].i)
                : idx;
            behaviorColorIndexByKey.set(key, colorIndex);
            return {
                value: key,
                name: traces[key].name || key,
                order: colorIndex,
            };
        })
        .sort((a, b) => {
            if (a.order !== b.order) return a.order - b.order;
            return a.name.localeCompare(b.name);
        });

    if (options.length === 0) {
        currentBehaviorKeys = [];
        return;
    }

    selector.addOptions(options);
    const available = new Set(options.map((opt) => opt.value));
    const preferredList = parseTomSelectValues(preferredSelection).filter((value) => available.has(value));
    if (preferredList.length > 0) {
        selector.setValue(preferredList, true);
        currentBehaviorKeys = preferredList;
        updateExploreLink();
        return;
    }

    const preferred = behaviorData.default_behavior;
    const defaultValue = options.some((opt) => opt.value === preferred) ? preferred : options[0].value;
    selector.setValue([defaultValue], true);
    currentBehaviorKeys = [defaultValue];
    updateExploreLink();
}

function filterReplayPayload(rawPayload, selectedNeuronIds, edgeType) {
    const selectedSet = new Set(selectedNeuronIds);
    const selectedNodesForSignal = rawPayload.nodes.filter(
        (node) => selectedSet.has(node.id) && Boolean(node.has_activity)
    );
    const edgeTypeFilter = normalizeEdgeType(edgeType);
    const candidateEdges = edgeTypeFilter === "all"
        ? rawPayload.edges
        : rawPayload.edges.filter((edge) => edge.edge_type === edgeTypeFilter);
    const edges = candidateEdges.filter(
        (edge) => selectedSet.has(edge.source) || selectedSet.has(edge.target)
    );

    const nodeIds = new Set(selectedNeuronIds);
    edges.forEach((edge) => {
        nodeIds.add(edge.source);
        nodeIds.add(edge.target);
    });
    const nodes = rawPayload.nodes.filter((node) => nodeIds.has(node.id));

    const traceLength = rawPayload.meta.trace_length;
    const globalSignal = Array(traceLength).fill(0);
    if (selectedNodesForSignal.length > 0) {
        for (let i = 0; i < traceLength; i++) {
            let sumAbs = 0;
            selectedNodesForSignal.forEach((node) => {
                const value = Number(node.trace?.[i]);
                if (Number.isFinite(value)) {
                    sumAbs += Math.abs(value);
                }
            });
            globalSignal[i] = sumAbs / selectedNodesForSignal.length;
        }
    }

    const maxEdgeWeight = edges.reduce(
        (maxValue, edge) => Math.max(maxValue, edge.weight),
        0
    );

    return {
        ...rawPayload,
        nodes: nodes,
        edges: edges,
        meta: {
            ...rawPayload.meta,
            n_nodes: nodes.length,
            n_edges: edges.length,
            max_edge_weight: maxEdgeWeight,
        },
        timeline: {
            ...rawPayload.timeline,
            global_signal: globalSignal,
        },
    };
}

function getLayoutConfig(name, spacingFactor = appliedSpacing) {
    const safeSpacing = clamp(spacingFactor, 0.25, 1.5);
    switch (name) {
        case "grid":
            return {
                name: "grid",
                animate: true,
                avoidOverlap: true,
                avoidOverlapPadding: 5,
                spacingFactor: safeSpacing,
            };
        case "circle":
            return { name: "circle", animate: true, spacingFactor: safeSpacing };
        case "breadthfirst":
            return {
                name: "breadthfirst",
                animate: true,
                directed: true,
                spacingFactor: safeSpacing,
            };
        case "dagre":
            return {
                name: "dagre",
                animate: true,
                rankDir: "TB",
                nodeSep: 12 * safeSpacing,
                rankSep: 32 * safeSpacing,
            };
        case "cose":
            return {
                name: "cose",
                animate: true,
                nodeRepulsion: 9000,
                edgeElasticity: 35,
                idealEdgeLength: 90,
                spacingFactor: safeSpacing,
            };
        case "concentric":
        default:
            return {
                name: "concentric",
                animate: true,
                spacingFactor: safeSpacing,
                minNodeSpacing: 5 * safeSpacing,
            };
    }
}

function applyGraphLayout(layoutName) {
    if (!cy) return;
    const config = getLayoutConfig(layoutName, appliedSpacing);
    cy.layout(config).run();
}

function initGraph(payload) {
    if (cy) {
        cy.destroy();
    }
    selectedEdgeId = null;
    selectedNodeInfoId = null;
    clearEdgeInfo();

    const maxEdgeWeight = payload.meta.max_edge_weight > 0 ? payload.meta.max_edge_weight : 1.0;
    const elements = [];

    payload.nodes.forEach((node) => {
        elements.push({
            group: "nodes",
            data: {
                id: node.id,
                trace: node.trace,
                degree_out: node.degree_out,
                degree_in: node.degree_in,
                degree_in_full: node.degree_in_full,
                degree_out_full: node.degree_out_full,
                degree_total_full: node.degree_total_full,
                pagerank_centrality: node.pagerank_centrality,
                eigenvector_centrality: node.eigenvector_centrality,
                behavior_correlations: node.behavior_correlations || {},
                representative_idx_neuron: node.representative_idx_neuron,
                has_activity: node.has_activity ? 1 : 0,
            },
        });
    });

    payload.edges.forEach((edge, idx) => {
        const baseWidth = getEdgeBaseWidth(edge.weight, appliedEdgeScale);
        elements.push({
            group: "edges",
            data: {
                id: `${edge.source}-${edge.target}-${edge.edge_type}-${idx}`,
                source: edge.source,
                target: edge.target,
                edge_type: edge.edge_type,
                weight: edge.weight,
                weight_norm: edge.weight / maxEdgeWeight,
                base_width: baseWidth,
                frame_width: baseWidth,
                frame_opacity: 0.2,
                frame_source_activity: 0,
                frame_signal: edge.weight / maxEdgeWeight,
                frame_size_value: edge.weight,
                frame_color_value: edge.weight,
                frame_mode_value: edge.weight,
            },
        });
    });

    cy = cytoscape({
        container: document.getElementById("replay-graph"),
        elements: elements,
        style: [
            {
                selector: "node",
                style: {
                    label: "data(id)",
                    "text-wrap": "wrap",
                    "font-size": 10,
                    color: "#0f172a",
                    "text-halign": "center",
                    "text-valign": "center",
                    "background-color": "#dbeafe",
                    width: 24,
                    height: 24,
                    "border-width": 1.2,
                    "border-color": "#f8fafc",
                    "border-style": "solid",
                    shape: "ellipse",
                    opacity: 1,
                },
            },
            {
                selector: "edge",
                style: {
                    width: "data(base_width)",
                    "line-color": "#cbd5e1",
                    opacity: 0.25,
                    "curve-style": "bezier",
                    "target-arrow-shape": "triangle",
                    "target-arrow-color": "#cbd5e1",
                    "arrow-scale": 0.75,
                },
            },
            {
                selector: 'edge[edge_type="electrical"]',
                style: {
                    "line-style": "dashed",
                    "target-arrow-shape": "none",
                },
            },
        ],
        minZoom: 0.2,
        maxZoom: 3.0,
    });

    cy.on("tap", "node", (event) => {
        const nodeId = event.target.id();
        const originalEvent = event.originalEvent || {};
        const additive = Boolean(originalEvent.metaKey || originalEvent.ctrlKey);

        if (additive) {
            if (selectedNodeIds.has(nodeId)) {
                selectedNodeIds.delete(nodeId);
            } else {
                selectedNodeIds.add(nodeId);
            }
        } else {
            selectedNodeIds = new Set([nodeId]);
        }
        selectedEdgeId = null;
        if (selectedNodeIds.size > 1) {
            selectedNodeInfoId = null;
        } else if (selectedNodeIds.size === 1) {
            selectedNodeInfoId = Array.from(selectedNodeIds)[0];
        } else {
            selectedNodeInfoId = null;
        }

        renderSignalPlot();
        applySelectionStyles();
        if (selectedNodeIds.size > 1) {
            renderSelectedNodesSummary();
        } else if (selectedNodeInfoId) {
            const selectedNode = cy.getElementById(selectedNodeInfoId);
            renderSelectedNodeInfo(selectedNode);
        } else {
            renderEdgeInfo("Click a node or edge to inspect mode-specific values.");
            setNodeInfoMoreButtonVisible(false);
        }
        updateExploreLink();
        updateReplayUrlState();
    });

    cy.on("tap", "edge", (event) => {
        selectedEdgeId = event.target.id();
        selectedNodeInfoId = null;
        selectedNodeIds.clear();
        renderSignalPlot();
        applySelectionStyles();
        renderSelectedEdgeInfo(event.target);
        updateExploreLink();
        updateReplayUrlState();
    });

    cy.on("tap", (event) => {
        if (event.target !== cy) return;

        const originalEvent = event.originalEvent || {};
        const additive = Boolean(originalEvent.metaKey || originalEvent.ctrlKey);
        if (!additive) {
            selectedNodeIds.clear();
            renderSignalPlot();
            applySelectionStyles();
            clearEdgeInfo();
            updateExploreLink();
            updateReplayUrlState();
        }
    });

    const layoutName = getLocalStr(STORAGE_LAYOUT, DEFAULTS.layout);
    applyGraphLayout(layoutName);
}

function applySelectionStyles() {
    if (!cy) return;

    if (selectedNodeIds.size === 0) {
        cy.startBatch();
        cy.nodes().forEach((node) => {
            const border = node.data("frame_border") || 1.2;
            const baseBorderColor = node.data("has_activity") ? "#f8fafc" : "#4b5563";
            node.style({
                opacity: 1,
                "border-color": baseBorderColor,
                "border-width": border,
            });
        });
        cy.edges().forEach((edge) => {
            edge.style({
                opacity: edge.data("frame_opacity") || 0.2,
                width: edge.data("frame_width") || edge.data("base_width"),
            });
        });
        cy.endBatch();
        return;
    }

    const selectedEdges = new Set();
    const selectedAndConnectedNodes = new Set([...selectedNodeIds]);

    selectedNodeIds.forEach((nodeId) => {
        const node = cy.getElementById(nodeId);
        if (!node || node.empty()) return;
        node.connectedEdges().forEach((edge) => {
            selectedEdges.add(edge.id());
            selectedAndConnectedNodes.add(edge.source().id());
            selectedAndConnectedNodes.add(edge.target().id());
        });
    });

    cy.startBatch();
    cy.nodes().forEach((node) => {
        const nodeId = node.id();
        const border = node.data("frame_border") || 1.2;
        const baseBorderColor = node.data("has_activity") ? "#f8fafc" : "#4b5563";

        if (selectedNodeIds.has(nodeId)) {
            node.style({
                opacity: 1,
                "border-color": "#0f172a",
                "border-width": border + 0.6,
            });
        } else if (selectedAndConnectedNodes.has(nodeId)) {
            node.style({
                opacity: 1,
                "border-color": baseBorderColor,
                "border-width": border,
            });
        } else {
            node.style({
                opacity: 0.15,
                "border-color": baseBorderColor,
                "border-width": border,
            });
        }
    });

    cy.edges().forEach((edge) => {
        const frameOpacity = edge.data("frame_opacity") || 0.2;
        const frameWidth = edge.data("frame_width") || edge.data("base_width");
        if (selectedEdges.has(edge.id())) {
            edge.style({
                opacity: Math.max(frameOpacity, 0.95),
                width: frameWidth * 0.92,
            });
        } else {
            edge.style({
                opacity: Math.min(frameOpacity * 0.2, 0.1),
                width: frameWidth,
            });
        }
    });
    cy.endBatch();
}

function getReplayAverageTimestep() {
    const avgTimestep = Number.parseFloat(replayPayload?.meta?.avg_timestep);
    return Number.isFinite(avgTimestep) && avgTimestep > 0 ? avgTimestep : 0;
}

function hasReplayEventData(behaviorData) {
    const events = behaviorData?.events;
    if (!events || typeof events !== "object") return false;
    return Object.values(events).some((values) => (
        Array.isArray(values) && values.length > 0
    ));
}

function syncBehaviorOptionsUI(behaviorData = replayPayload?.behavior) {
    const reversalSwitch = document.getElementById("switch-replay-show-reversal");
    const eventSwitch = document.getElementById("switch-replay-show-event");
    const eventOptionGroup = document.getElementById("replay-event-option-group");
    const eventOptionNote = document.getElementById("replay-event-option-note");

    behaviorEventAvailable = hasReplayEventData(behaviorData);
    if (!behaviorEventAvailable) {
        showBehaviorEvent = false;
        setLocalBool(STORAGE_BEHAVIOR_SHOW_EVENT, false);
    }
    if (reversalSwitch) {
        reversalSwitch.checked = Boolean(showBehaviorReversal);
    }

    if (eventSwitch) {
        eventSwitch.disabled = !behaviorEventAvailable;
        eventSwitch.checked = behaviorEventAvailable && Boolean(showBehaviorEvent);
    }
    if (eventOptionGroup) {
        eventOptionGroup.classList.toggle("text-muted", !behaviorEventAvailable);
    }
    if (eventOptionNote) {
        eventOptionNote.classList.toggle("d-none", behaviorEventAvailable);
    }
}

function getBehaviorEventLineStyle(eventKey, fallbackIndex) {
    if (BEHAVIOR_EVENT_STYLE_BY_KEY[eventKey]) {
        return BEHAVIOR_EVENT_STYLE_BY_KEY[eventKey];
    }
    return {
        color: getCycleColor(fallbackIndex, ["C"]),
        width: 1.8,
    };
}

function buildBehaviorShapes(xValues, yMin, yMax) {
    const shapes = [];
    const avgTimestep = getReplayAverageTimestep();
    const behaviorData = replayPayload?.behavior || {};

    if (showBehaviorReversal) {
        const reversals = Array.isArray(behaviorData.reversal_events)
            ? behaviorData.reversal_events
            : [];
        reversals.forEach((reversal, index) => {
            if (!Array.isArray(reversal) || reversal.length < 2) return;
            const startFrame = Number.parseFloat(reversal[0]);
            const endFrame = Number.parseFloat(reversal[1]);
            if (!Number.isFinite(startFrame) || !Number.isFinite(endFrame) || avgTimestep <= 0) return;
            const x0 = Math.max(0, (startFrame - 1) * avgTimestep);
            const x1 = Math.max(x0, (endFrame - 1) * avgTimestep);
            shapes.push({
                type: "rect",
                x0: x0,
                x1: x1,
                y0: yMin,
                y1: yMax,
                line: { width: 0 },
                fillcolor: BEHAVIOR_REVERSAL_FILL_COLOR,
                opacity: 1,
                name: `rev_${index}`,
            });
        });
    }

    if (showBehaviorEvent && behaviorEventAvailable) {
        const events = behaviorData.events || {};
        Object.entries(events).forEach(([eventKey, eventFrames], eventTypeIndex) => {
            if (!Array.isArray(eventFrames)) return;
            const style = getBehaviorEventLineStyle(eventKey, eventTypeIndex);
            eventFrames.forEach((eventFrame, eventIndex) => {
                const frameIndex = Number.parseFloat(eventFrame);
                if (!Number.isFinite(frameIndex) || avgTimestep <= 0) return;
                const xPos = Math.max(0, frameIndex * avgTimestep);
                shapes.push({
                    type: "line",
                    x0: xPos,
                    x1: xPos,
                    y0: yMin,
                    y1: yMax,
                    line: {
                        color: style.color,
                        width: style.width,
                    },
                    name: `event_${eventKey}_${eventIndex}`,
                });
            });
        });
    }

    const cursorX = xValues[currentFrame] ?? xValues[0];
    if (Number.isFinite(cursorX)) {
        shapes.push({
            type: "line",
            x0: cursorX,
            x1: cursorX,
            y0: yMin,
            y1: yMax,
            line: { color: "#ef4444", width: 2, dash: "dot" },
            name: "cursor",
        });
    }
    return shapes;
}

function renderBehaviorPlot() {
    const traces = replayPayload?.behavior?.traces || {};
    const x = replayPayload?.timeline?.time_minutes || [];
    const selectedKeys = getSelectedBehaviorKeys(traces);

    if (selectedKeys.length === 0 || x.length === 0) {
        Plotly.react(
            "replay-behavior-plot",
            [],
            {
                template: "plotly_white",
                margin: { l: 45, r: 15, t: 28, b: 36 },
                annotations: [{
                    text: "No behavior data available",
                    showarrow: false,
                    x: 0.5,
                    y: 0.5,
                    xref: "paper",
                    yref: "paper",
                    font: { color: "#64748b" },
                }],
                xaxis: { title: { text: "Time (min)" }, color: "#000000" },
                yaxis: { title: { text: "Behavior" }, color: "#000000" },
                shapes: buildBehaviorShapes(x, -1, 1),
                height: 380,
            },
            { responsive: true, displaylogo: false }
        );
        behaviorYMin = -1;
        behaviorYMax = 1;
        return;
    }

    const tracesToPlot = [];
    let yMin = Number.POSITIVE_INFINITY;
    let yMax = Number.NEGATIVE_INFINITY;

    selectedKeys.forEach((behaviorKey, idx) => {
        const behavior = traces[behaviorKey];
        if (!behavior) return;

        const label = behavior.unit
            ? `${behavior.name} (${behavior.unit})`
            : behavior.name;

        const y = behavior.data || [];
        y.forEach((value) => {
            yMin = Math.min(yMin, value);
            yMax = Math.max(yMax, value);
        });

        tracesToPlot.push({
            type: "scatter",
            mode: "lines",
            x: x,
            y: y,
            line: {
                color: getCycleColor(getBehaviorColorIndex(behaviorKey, idx)),
                width: 2,
            },
            name: label,
        });
    });

    if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) {
        yMin = -1;
        yMax = 1;
    }
    const pad = Math.max((yMax - yMin) * 0.1, 0.1);
    behaviorYMin = yMin - pad;
    behaviorYMax = yMax + pad;
    const showLegend = tracesToPlot.length > 1;

    Plotly.react(
        "replay-behavior-plot",
        tracesToPlot,
        {
            template: "plotly_white",
            margin: { l: 45, r: 15, t: showLegend ? 104 : 32, b: 40 },
            xaxis: { title: { text: "Time (min)" }, color: "#000000" },
            yaxis: {
                title: { text: "Behavior" },
                color: "#000000",
                range: [behaviorYMin, behaviorYMax],
            },
            shapes: buildBehaviorShapes(x, behaviorYMin, behaviorYMax),
            showlegend: showLegend,
            legend: {
                orientation: "h",
                yanchor: "bottom",
                y: 1.14,
                x: 0,
            },
            height: 380,
        },
        { responsive: true, displaylogo: false }
    );
}

function renderSignalPlot() {
    const titleElement = document.getElementById("signal-plot-title");
    if (!replayPayload) return;

    const x = replayPayload.timeline.time_minutes;
    const traces = [];
    let showLegend = false;

    if (selectedNodeIds.size === 0) {
        titleElement.textContent = "Global Activity";
        const y = replayPayload.timeline.global_signal;
        signalYMax = Math.max(...y, 0.2) * 1.1;
        traces.push({
            type: "scatter",
            mode: "lines",
            x: x,
            y: y,
            line: { color: "#000000", width: 2 },
            name: "Mean |activity|",
        });
    } else {
        const nodeMap = new Map(replayPayload.nodes.map((node) => [node.id, node]));
        const selected = Array.from(selectedNodeIds).filter((nodeId) => nodeMap.has(nodeId));
        const selectedWithActivity = selected
            .filter((nodeId) => Boolean(nodeMap.get(nodeId)?.has_activity))
            .slice(0, 10);
        titleElement.textContent = selectedWithActivity.length > 1
            ? `Selected Neuron Activity (${selectedWithActivity.length})`
            : "Selected Neuron Activity";
        showLegend = selectedWithActivity.length > 1;

        let yMax = 0.2;
        selectedWithActivity.forEach((nodeId, idx) => {
            const node = nodeMap.get(nodeId);
            yMax = Math.max(yMax, ...node.trace.map((v) => Math.abs(v)));
            const idxNeuron = Number.isInteger(node.representative_idx_neuron)
                ? node.representative_idx_neuron
                : null;
            const traceName = idxNeuron !== null ? `${idxNeuron} (${nodeId})` : nodeId;
            traces.push({
                type: "scatter",
                mode: "lines",
                x: x,
                y: node.trace,
                line: { color: getCycleColor(idx, ["C"]), width: 2 },
                name: traceName,
            });
        });
        if (selectedWithActivity.length > 0) {
            signalYMax = yMax * 1.1;
        } else {
            signalYMax = 1;
        }
    }

    Plotly.react(
        "replay-signal-plot",
        traces,
        {
            template: "plotly_white",
            margin: { l: 45, r: 20, t: showLegend ? 80 : 20, b: 46 },
            xaxis: { title: { text: "Time (min)" }, color: "#000000" },
            yaxis: {
                title: { text: "Neuron GCaMP (z-scored)" },
                color: "#000000",
                range: [-signalYMax, signalYMax],
            },
            shapes: [
                {
                    type: "line",
                    x0: x[currentFrame] || x[0],
                    x1: x[currentFrame] || x[0],
                    y0: -signalYMax,
                    y1: signalYMax,
                    line: { color: "#ef4444", width: 2, dash: "dot" },
                },
            ],
            showlegend: showLegend,
            legend: {
                orientation: "h",
                yanchor: "bottom",
                y: 1.12,
                x: 0,
            },
            height: 320,
        },
        { responsive: true, displaylogo: false }
    );
}

function updateBehaviorCursor() {
    if (!replayPayload) return;
    const x = replayPayload.timeline.time_minutes;
    if (!x.length) return;

    Plotly.relayout("replay-behavior-plot", {
        shapes: buildBehaviorShapes(x, behaviorYMin, behaviorYMax),
    });
}

function updateSignalCursor() {
    if (!replayPayload) return;
    const x = replayPayload.timeline.time_minutes;
    if (!x.length) return;

    Plotly.relayout("replay-signal-plot", {
        shapes: [
            {
                type: "line",
                x0: x[currentFrame],
                x1: x[currentFrame],
                y0: -signalYMax,
                y1: signalYMax,
                line: { color: "#ef4444", width: 2, dash: "dot" },
            },
        ],
    });
}

function updateFrame(frame) {
    if (!replayPayload || !cy) return;

    currentFrame = clamp(frame, 0, replayPayload.meta.trace_length - 1);
    document.getElementById("replay-slider").value = String(currentFrame);
    const t = replayPayload.timeline.time_minutes[currentFrame];
    document.getElementById("replay-time-label").textContent = formatReplayTimeLabel(t, currentFrame);

    const edgeSizeMode = normalizeEdgeMode(document.getElementById("select-edge-size-mode").value);
    const edgeColorMode = normalizeEdgeMode(document.getElementById("select-edge-color-mode").value);
    const nodeSizeMode = document.getElementById("select-node-size-mode").value;
    const colorSettings = getNodeColorSettings();
    const edgeColorSettings = getEdgeColorSettings();
    const edgeSizeNormalization = getEdgeSizeNormalization(edgeSizeMode);
    const sizeNormalization = getNodeSizeNormalization(nodeSizeMode);

    cy.startBatch();
    cy.nodes().forEach((node) => {
        const trace = node.data("trace");
        const nodeData = node.data();
        const hasActivity = Boolean(nodeData.has_activity);
        const activityValue = hasActivity
            ? (Number.isFinite(Number(trace?.[currentFrame])) ? Number(trace[currentFrame]) : 0)
            : 0;
        const sizeValue = getNodeSizeValue(nodeData, activityValue, nodeSizeMode);
        const size = mapValueToNodeSize(sizeValue, sizeNormalization);
        const border = mapValueToNodeBorder(size);
        const colorValue = getNodeColorValue(nodeData, activityValue, colorSettings.colorMode);
        const fillColor = hasActivity ? valueToNodeColor(colorValue, colorSettings) : "#d1d5db";
        const labelColor = hasActivity ? getNodeLabelColorForFill(fillColor) : "#111827";
        const borderColor = hasActivity ? "#f8fafc" : "#4b5563";
        node.data("frame_border", border);
        node.style({
            "background-color": fillColor,
            color: labelColor,
            width: size,
            height: size,
            "border-width": hasActivity ? border : Math.max(border, 1.4),
            "border-style": hasActivity ? "solid" : "dashed",
            "border-color": borderColor,
            shape: hasActivity ? "ellipse" : "diamond",
            opacity: 1,
        });
    });

    cy.edges().forEach((edge) => {
        const sourceTrace = edge.source().data("trace");
        const sourceActivity = Number.isFinite(Number(sourceTrace?.[currentFrame]))
            ? Number(sourceTrace[currentFrame])
            : 0;
        const weight = edge.data("weight");
        const weightNorm = edge.data("weight_norm");
        const baseWidth = edge.data("base_width");

        const modeValues = {
            count: weight,
            source_only: sourceActivity,
            weighted_source: sourceActivity * weight,
        };

        const frameSizeValue = modeValues[edgeSizeMode];
        const normalizedSize = normalizeEdgeSizeValue(frameSizeValue, edgeSizeNormalization);
        const widthFactor = EDGE_WIDTH_FACTOR_MIN
            + normalizedSize * (EDGE_WIDTH_FACTOR_MAX - EDGE_WIDTH_FACTOR_MIN);
        const frameWidth = Math.max(EDGE_WIDTH_MIN_PX, baseWidth * widthFactor);
        const frameOpacity = 0.08 + 0.82 * normalizedSize;
        const frameColorValue = modeValues[edgeColorMode];
        const frameSignal = normalizedSize;
        const lineColor = valueToEdgeColor(frameColorValue, edgeColorSettings);

        edge.data("frame_width", frameWidth);
        edge.data("frame_opacity", frameOpacity);
        edge.data("frame_source_activity", sourceActivity);
        edge.data("frame_signal", frameSignal);
        edge.data("frame_size_value", frameSizeValue);
        edge.data("frame_color_value", frameColorValue);
        edge.data("frame_mode_value", frameSizeValue);
        edge.style({
            width: frameWidth,
            opacity: frameOpacity,
            "line-color": lineColor,
            "target-arrow-color": lineColor,
        });
    });
    cy.endBatch();

    applySelectionStyles();
    updateBehaviorCursor();
    updateSignalCursor();
    if (selectedEdgeId) {
        refreshSelectedEdgeInfo();
    } else if (selectedNodeInfoId || selectedNodeIds.size > 1) {
        refreshSelectedNodeInfo();
    }
    if (!isPlaying) {
        updateReplayUrlState({ includeFrame: true });
    }
}

function stopPlayback() {
    isPlaying = false;
    if (timerId) {
        clearInterval(timerId);
        timerId = null;
    }
    document.getElementById("button-play-pause").innerHTML = '<i class="bi bi-play-fill"></i> Play';
}

function startPlayback() {
    if (!replayPayload) return;
    stopPlayback();
    isPlaying = true;
    document.getElementById("button-play-pause").innerHTML = '<i class="bi bi-pause-fill"></i> Pause';

    const speed = parseFloat(document.getElementById("select-speed").value) || 1;
    const interval = Math.max(20, Math.round(1000 / (DEFAULTS.fps * speed)));
    timerId = setInterval(() => {
        if (!replayPayload) return;
        const next = currentFrame + 1;
        if (next >= replayPayload.meta.trace_length) {
            updateFrame(0);
        } else {
            updateFrame(next);
        }
    }, interval);
}

function applyNeuronFilter() {
    if (!rawReplayPayload) return;

    const selectedNeurons = selectors.neuronSelector.items.slice();
    if (selectedNeurons.length === 0) {
        renderError("Select at least one neuron.");
        updateExploreLink();
        return;
    }

    replayPayload = filterReplayPayload(
        rawReplayPayload,
        selectedNeurons,
        appliedEdgeType
    );
    if (replayPayload.meta.n_nodes === 0) {
        renderError("No matching neurons available for replay.");
        updateExploreLink();
        return;
    }
    renderError(null);
    computeEdgeAutoRanges(replayPayload);
    setEdgeColorRangeForMode(document.getElementById("select-edge-color-mode").value);

    selectedNodeIds = new Set(
        Array.from(selectedNodeIds).filter((nodeId) =>
            replayPayload.nodes.some((node) => node.id === nodeId)
        )
    );

    initGraph(replayPayload);
    renderMeta();

    const slider = document.getElementById("replay-slider");
    slider.max = String(Math.max(replayPayload.meta.trace_length - 1, 1));
    currentFrame = clamp(currentFrame, 0, replayPayload.meta.trace_length - 1);

    renderBehaviorPlot();
    renderSignalPlot();
    updateFrame(currentFrame);
    updateExploreLink();
    updateReplayUrlState({ includeFrame: true });
}

async function loadReplayData() {
    const activityDataset = selectors.activitySelector.getValue();
    const connectomeDataset = selectors.connectomeSelector.getValue();
    const nodeSizeModeSelect = document.getElementById("select-node-size-mode");
    const nodeColorModeSelect = document.getElementById("select-node-color-mode");
    const edgeType = normalizeEdgeType(document.getElementById("select-edge-type").value);
    const showConnected = Boolean(document.getElementById("switch-replay-show-connected")?.checked);
    const includeElectrical = true;
    const spacingValue = parseFloat(document.getElementById("slider-spacing").value);
    const edgeScaleValue = parseFloat(document.getElementById("slider-edge-scale").value);
    const minSynapseChemical = parseInt(
        document.getElementById("input-min-synapse-c").value,
        10
    );
    const minSynapseElectrical = parseInt(
        document.getElementById("input-min-synapse-e").value,
        10
    );

    if (!activityDataset || !connectomeDataset) {
        renderError("Please select both activity and connectome datasets.");
        return;
    }
    if (!Number.isInteger(minSynapseChemical) || minSynapseChemical < 1) {
        renderError("Min chemical synapse must be an integer >= 1.");
        return;
    }
    if (!Number.isInteger(minSynapseElectrical) || minSynapseElectrical < 1) {
        renderError("Min electrical synapse must be an integer >= 1.");
        return;
    }
    if (!Number.isFinite(spacingValue) || spacingValue < 0.25 || spacingValue > 1.5) {
        renderError("Spacing must be a number between 0.25 and 1.5.");
        return;
    }
    if (!Number.isFinite(edgeScaleValue) || edgeScaleValue < EDGE_SCALE_MIN || edgeScaleValue > EDGE_SCALE_MAX) {
        renderError(`Scale must be a number between ${EDGE_SCALE_MIN} and ${EDGE_SCALE_MAX}.`);
        return;
    }

    setLocalStr(STORAGE_ACTIVITY_DATASET, activityDataset);
    setLocalStr(STORAGE_CONNECTOME_DATASET, connectomeDataset);
    setLocalStr(STORAGE_EDGE_TYPE, edgeType);
    setLocalBool(STORAGE_SHOW_CONNECTED, showConnected);
    setLocalInt(STORAGE_MIN_SYNAPSE_C, minSynapseChemical);
    setLocalInt(STORAGE_MIN_SYNAPSE_E, minSynapseElectrical);
    setLocalFloat(STORAGE_SPACING, spacingValue);
    setLocalFloat(STORAGE_EDGE_SCALE, edgeScaleValue);

    appliedSpacing = spacingValue;
    appliedEdgeScale = edgeScaleValue;
    appliedEdgeType = edgeType;

    const previousNeuronSelection = selectors.neuronSelector?.items?.slice() || [];
    const previousOptionCount = selectors.neuronSelector
        ? Object.keys(selectors.neuronSelector.options || {}).length
        : 0;
    const previousSelectionWasAll = previousOptionCount > 0
        && previousNeuronSelection.length >= previousOptionCount;
    const previousNodeSizeMode = nodeSizeModeSelect?.value || DEFAULTS.nodeSizeMode;
    const previousNodeColorMode = nodeColorModeSelect?.value || DEFAULTS.nodeColorMode;
    const usePendingUrlState = pendingUrlState.active;

    const params = new URLSearchParams({
        activity_dataset: activityDataset,
        connectome_dataset: connectomeDataset,
        include_electrical: includeElectrical ? "1" : "0",
        show_connected: showConnected ? "1" : "0",
        min_synapse_chemical: String(minSynapseChemical),
        min_synapse_electrical: String(minSynapseElectrical),
    });
    const requestCacheKey = buildReplayRequestCacheKey({
        activityDataset: activityDataset,
        connectomeDataset: connectomeDataset,
        includeElectrical: includeElectrical,
        showConnected: showConnected,
        minSynapseChemical: minSynapseChemical,
        minSynapseElectrical: minSynapseElectrical,
    });

    stopPlayback();
    setNeuronFilterPending(false);
    setNeuronFilterApplying(false);
    setLoading(true);
    renderError(null);
    renderWarnings([]);
    clearEdgeInfo();

    try {
        const replayResult = await fetchReplayPayloadWithCache(requestCacheKey, params);
        const payload = replayResult.payload;

        rawReplayPayload = payload;
        replayPayload = payload;
        syncBehaviorOptionsUI(payload.behavior);
        computeNodeAutoRanges(payload);
        currentFrame = 0;
        selectedNodeIds.clear();
        selectedEdgeId = null;
        renderWarnings(payload.warnings);

        let preferredNeuronSelection = previousNeuronSelection;
        if (usePendingUrlState) {
            if ((pendingUrlState.neuronIndices || []).length > 0) {
                const nodeIdByIndex = new Map(
                    payload.nodes
                        .filter((node) => Number.isInteger(node.representative_idx_neuron))
                        .map((node) => [node.representative_idx_neuron, node.id])
                );
                preferredNeuronSelection = pendingUrlState.neuronIndices
                    .map((idx) => nodeIdByIndex.get(idx))
                    .filter((nodeId) => Boolean(nodeId));
            } else {
                preferredNeuronSelection = pendingUrlState.neuronIds || [];
            }
        }

        resetNeuronSelectorOptions(
            payload.nodes,
            preferredNeuronSelection,
            usePendingUrlState ? false : previousSelectionWasAll
        );
        resetBehaviorSelectorOptions(
            payload.behavior,
            usePendingUrlState ? pendingUrlState.behaviors : []
        );
        const preferredNodeModes = pendingInitialNodeModes || {
            sizeMode: previousNodeSizeMode,
            colorMode: previousNodeColorMode,
        };
        const syncedNodeModes = syncNodeModeSelectors(payload.behavior, preferredNodeModes);
        setLocalStr(STORAGE_NODE_SIZE_MODE, syncedNodeModes.sizeMode);
        setLocalStr(STORAGE_NODE_COLOR_MODE, syncedNodeModes.colorMode);
        setNodeColorRangeForMode(syncedNodeModes.colorMode);
        pendingInitialNodeModes = null;

        applyNeuronFilter();

        if (usePendingUrlState && replayPayload) {
            if (Number.isInteger(pendingUrlState.frame)) {
                currentFrame = clamp(pendingUrlState.frame, 0, replayPayload.meta.trace_length - 1);
                updateFrame(currentFrame);
            }
            pendingUrlState.active = false;
        }
    } catch (error) {
        renderError(error.message);
    } finally {
        setLoading(false);
        updateExploreLink();
        updateReplayUrlState({ includeFrame: true });
    }
}

document.addEventListener("DOMContentLoaded", () => {
    const { activitySelector, connectomeSelector } = buildDatasetSelectors();
    const { neuronSelector, behaviorSelector } = buildNeuronAndBehaviorSelectors();
    selectors = {
        activitySelector,
        connectomeSelector,
        neuronSelector,
        behaviorSelector,
    };

    const inputMinSynapseC = document.getElementById("input-min-synapse-c");
    const inputMinSynapseE = document.getElementById("input-min-synapse-e");
    const layoutSelect = document.getElementById("select-layout");
    const sliderSpacing = document.getElementById("slider-spacing");
    const sliderEdgeScale = document.getElementById("slider-edge-scale");
    const speedSelect = document.getElementById("select-speed");
    const edgeSizeModeSelect = document.getElementById("select-edge-size-mode");
    const edgeColorModeSelect = document.getElementById("select-edge-color-mode");
    const edgeTypeSelect = document.getElementById("select-edge-type");
    const switchShowConnected = document.getElementById("switch-replay-show-connected");
    const edgeColormapSelect = document.getElementById("select-edge-colormap");
    const edgeVMinInput = document.getElementById("input-edge-vmin");
    const edgeVMaxInput = document.getElementById("input-edge-vmax");
    const nodeSizeModeSelect = document.getElementById("select-node-size-mode");
    const nodeColorModeSelect = document.getElementById("select-node-color-mode");
    const nodeColormapSelect = document.getElementById("select-node-colormap");
    const nodeVMinInput = document.getElementById("input-node-vmin");
    const nodeVMaxInput = document.getElementById("input-node-vmax");
    const buttonOpenExplore = document.getElementById("button-open-explore");
    const buttonOpenExploreTop = document.getElementById("button-open-explore-top");
    const switchBehaviorReversal = document.getElementById("switch-replay-show-reversal");
    const switchBehaviorEvent = document.getElementById("switch-replay-show-event");
    const buttonToggleSettings = document.getElementById("button-toggle-settings");
    const buttonNodeInfoMore = document.getElementById("button-node-info-more");
    const nodeInfoModalElement = document.getElementById("replay-node-info-modal");
    const advancedSettingsElement = document.getElementById("replay-advanced-settings");

    if (advancedSettingsElement && window.bootstrap && window.bootstrap.Collapse) {
        advancedSettingsCollapse = new window.bootstrap.Collapse(advancedSettingsElement, { toggle: false });
        advancedSettingsElement.addEventListener("shown.bs.collapse", () => {
            updateSettingsToggleButton(true);
        });
        advancedSettingsElement.addEventListener("hidden.bs.collapse", () => {
            updateSettingsToggleButton(false);
        });
    }

    setAdvancedSettingsVisible(false);
    setNodeInfoMoreButtonVisible(false);

    const urlState = parseReplayStateFromUrl();
    const localShowReversal = getLocalBool(STORAGE_BEHAVIOR_SHOW_REVERSAL, DEFAULTS.showReversal);
    const localShowEvent = getLocalBool(STORAGE_BEHAVIOR_SHOW_EVENT, DEFAULTS.showEvent);
    showBehaviorReversal = typeof urlState.showReversal === "boolean"
        ? urlState.showReversal
        : localShowReversal;
    showBehaviorEvent = typeof urlState.showEvent === "boolean"
        ? urlState.showEvent
        : localShowEvent;
    setLocalBool(STORAGE_BEHAVIOR_SHOW_REVERSAL, showBehaviorReversal);
    setLocalBool(STORAGE_BEHAVIOR_SHOW_EVENT, showBehaviorEvent);
    syncBehaviorOptionsUI(null);

    const hasSelectValue = (selectElement, value) => (
        Boolean(value)
        && Array.from(selectElement.options || []).some((option) => option.value === value)
    );

    const fallbackActivity = replayActivityDatasets.length
        ? replayActivityDatasets[0].dataset_id
        : "";
    const localActivity = getLocalStr(STORAGE_ACTIVITY_DATASET, fallbackActivity);
    const fallbackConnectome = replayConnectomeDatasets.some(
        (dataset) => dataset.dataset_id === DEFAULT_CONNECTOME_DATASET_ID
    )
        ? DEFAULT_CONNECTOME_DATASET_ID
        : (replayConnectomeDatasets.length ? replayConnectomeDatasets[0].dataset_id : "");

    const initialActivity = replayActivityDatasets.some(
        (dataset) => dataset.dataset_id === urlState.activityDataset
    )
        ? urlState.activityDataset
        : (
            replayActivityDatasets.some(
                (dataset) => dataset.dataset_id === localActivity
            )
                ? localActivity
                : fallbackActivity
        );
    const localConnectome = getLocalStr(STORAGE_CONNECTOME_DATASET, fallbackConnectome);
    const preferredConnectome = replayConnectomeDatasets.some(
        (dataset) => dataset.dataset_id === urlState.connectomeDataset
    )
        ? urlState.connectomeDataset
        : localConnectome;
    const initialConnectome = replayConnectomeDatasets.some(
        (dataset) => dataset.dataset_id === preferredConnectome
    )
        ? preferredConnectome
        : fallbackConnectome;
    if (initialActivity) activitySelector.setValue(initialActivity, true);
    if (initialConnectome) connectomeSelector.setValue(initialConnectome, true);

    const localMinSynapseC = getLocalInt(STORAGE_MIN_SYNAPSE_C, DEFAULTS.minSynapseChemical);
    const localMinSynapseE = getLocalInt(STORAGE_MIN_SYNAPSE_E, DEFAULTS.minSynapseElectrical);
    const minSynapseC = Number.isInteger(urlState.minSynapseChemical) && urlState.minSynapseChemical >= 1
        ? urlState.minSynapseChemical
        : localMinSynapseC;
    const minSynapseE = Number.isInteger(urlState.minSynapseElectrical) && urlState.minSynapseElectrical >= 1
        ? urlState.minSynapseElectrical
        : localMinSynapseE;
    inputMinSynapseC.value = minSynapseC;
    inputMinSynapseE.value = minSynapseE;

    const localSpeed = String(getLocalFloat(STORAGE_SPEED, DEFAULTS.speed));
    const preferredSpeed = Number.isFinite(urlState.speed) ? String(urlState.speed) : localSpeed;
    speedSelect.value = hasSelectValue(speedSelect, preferredSpeed) ? preferredSpeed : String(DEFAULTS.speed);

    const localEdgeSizeMode = normalizeEdgeMode(getLocalStr(STORAGE_EDGE_SIZE_MODE, DEFAULTS.edgeSizeMode));
    const preferredEdgeSizeMode = normalizeEdgeMode(urlState.edgeSizeMode || localEdgeSizeMode);
    edgeSizeModeSelect.value = hasSelectValue(edgeSizeModeSelect, preferredEdgeSizeMode)
        ? preferredEdgeSizeMode
        : DEFAULTS.edgeSizeMode;
    if (!edgeSizeModeSelect.value) {
        edgeSizeModeSelect.value = DEFAULTS.edgeSizeMode;
    }
    const localEdgeColorMode = normalizeEdgeMode(
        getLocalStr(STORAGE_EDGE_COLOR_MODE, DEFAULTS.edgeColorMode)
    );
    const preferredEdgeColorMode = normalizeEdgeMode(urlState.edgeColorMode || localEdgeColorMode);
    edgeColorModeSelect.value = hasSelectValue(edgeColorModeSelect, preferredEdgeColorMode)
        ? preferredEdgeColorMode
        : DEFAULTS.edgeColorMode;
    if (!edgeColorModeSelect.value) {
        edgeColorModeSelect.value = DEFAULTS.edgeColorMode;
    }
    const localEdgeType = normalizeEdgeType(getLocalStr(STORAGE_EDGE_TYPE, DEFAULTS.edgeType));
    const preferredEdgeType = normalizeEdgeType(urlState.edgeType || localEdgeType);
    edgeTypeSelect.value = hasSelectValue(edgeTypeSelect, preferredEdgeType)
        ? preferredEdgeType
        : DEFAULTS.edgeType;
    const localShowConnected = getLocalBool(STORAGE_SHOW_CONNECTED, DEFAULTS.showConnected);
    const initialShowConnected = typeof urlState.showConnected === "boolean"
        ? urlState.showConnected
        : localShowConnected;
    if (switchShowConnected) {
        switchShowConnected.checked = initialShowConnected;
    }
    setLocalBool(STORAGE_SHOW_CONNECTED, initialShowConnected);

    const localEdgeColormap = getLocalStr(STORAGE_EDGE_COLORMAP, DEFAULTS.edgeColormap);
    const preferredEdgeColormap = urlState.edgeColormap || localEdgeColormap;
    edgeColormapSelect.value = hasSelectValue(edgeColormapSelect, preferredEdgeColormap)
        ? preferredEdgeColormap
        : DEFAULTS.edgeColormap;
    if (!edgeColormapSelect.value) {
        edgeColormapSelect.value = DEFAULTS.edgeColormap;
    }
    const localNodeSizeMode = getLocalStr(STORAGE_NODE_SIZE_MODE, DEFAULTS.nodeSizeMode);
    const preferredNodeSizeMode = urlState.nodeSizeMode || localNodeSizeMode;
    nodeSizeModeSelect.value = hasSelectValue(nodeSizeModeSelect, preferredNodeSizeMode)
        ? preferredNodeSizeMode
        : DEFAULTS.nodeSizeMode;

    const localNodeColorMode = getLocalStr(STORAGE_NODE_COLOR_MODE, DEFAULTS.nodeColorMode);
    const preferredNodeColorMode = urlState.nodeColorMode || localNodeColorMode;
    nodeColorModeSelect.value = hasSelectValue(nodeColorModeSelect, preferredNodeColorMode)
        ? preferredNodeColorMode
        : DEFAULTS.nodeColorMode;
    pendingInitialNodeModes = {
        sizeMode: preferredNodeSizeMode || DEFAULTS.nodeSizeMode,
        colorMode: preferredNodeColorMode || DEFAULTS.nodeColorMode,
    };

    const localNodeColormap = getLocalStr(STORAGE_NODE_COLORMAP, DEFAULTS.nodeColormap);
    const preferredNodeColormap = urlState.nodeColormap || localNodeColormap;
    nodeColormapSelect.value = hasSelectValue(nodeColormapSelect, preferredNodeColormap)
        ? preferredNodeColormap
        : DEFAULTS.nodeColormap;

    const localSpacing = getLocalFloat(STORAGE_SPACING, DEFAULTS.spacing);
    const localEdgeScale = getLocalFloat(STORAGE_EDGE_SCALE, DEFAULTS.edgeScale);
    const spacingValue = Number.isFinite(urlState.spacing)
        ? clamp(urlState.spacing, 0.25, 1.5)
        : localSpacing;
    const edgeScaleValue = Number.isFinite(urlState.edgeScale)
        ? clamp(urlState.edgeScale, EDGE_SCALE_MIN, EDGE_SCALE_MAX)
        : localEdgeScale;
    sliderSpacing.value = String(spacingValue);
    sliderEdgeScale.value = String(edgeScaleValue);
    updateRangeLabel("label-spacing", sliderSpacing.value);
    updateRangeLabel("label-edge-scale", sliderEdgeScale.value);
    setNodeColorRangeForMode(nodeColorModeSelect.value);
    setEdgeColorRangeForMode(edgeColorModeSelect.value);

    if (
        Number.isFinite(urlState.edgeVMin)
        && Number.isFinite(urlState.edgeVMax)
        && urlState.edgeVMax > urlState.edgeVMin
    ) {
        edgeVMinInput.value = Number(urlState.edgeVMin).toFixed(3);
        edgeVMaxInput.value = Number(urlState.edgeVMax).toFixed(3);
    }
    if (
        Number.isFinite(urlState.nodeVMin)
        && Number.isFinite(urlState.nodeVMax)
        && urlState.nodeVMax > urlState.nodeVMin
    ) {
        nodeVMinInput.value = Number(urlState.nodeVMin).toFixed(3);
        nodeVMaxInput.value = Number(urlState.nodeVMax).toFixed(3);
    }

    const localLayout = getLocalStr(STORAGE_LAYOUT, DEFAULTS.layout);
    const preferredLayout = urlState.layout || localLayout;
    const validLayout = hasSelectValue(layoutSelect, preferredLayout)
        ? preferredLayout
        : DEFAULTS.layout;
    layoutSelect.value = validLayout;
    setLocalStr(STORAGE_LAYOUT, validLayout);

    pendingUrlState = {
        active: (
            urlState.neuronIndices.length > 0
            || urlState.neuronIds.length > 0
            || urlState.behaviors.length > 0
            || Number.isInteger(urlState.frame)
        ),
        neuronIds: urlState.neuronIds,
        neuronIndices: urlState.neuronIndices,
        behaviors: urlState.behaviors,
        frame: Number.isInteger(urlState.frame) ? urlState.frame : null,
    };

    updateColorBars();
    updateElectricalInputState();
    appliedEdgeType = edgeTypeSelect.value;

    const reloadAfterDatasetChange = () => {
        updateReplayConnectomeCitation();
        if (activitySelector.getValue() && connectomeSelector.getValue()) {
            loadReplayData();
        }
        updateExploreLink();
        updateReplayUrlState({ includeFrame: false });
    };
    activitySelector.on("change", reloadAfterDatasetChange);
    connectomeSelector.on("change", reloadAfterDatasetChange);

    updateReplayConnectomeCitation();

    const rerenderBehaviorOverlays = () => {
        if (!replayPayload) {
            updateReplayUrlState({ includeFrame: false });
            return;
        }
        renderBehaviorPlot();
        updateBehaviorCursor();
        updateReplayUrlState({ includeFrame: true });
    };

    if (switchBehaviorReversal) {
        switchBehaviorReversal.checked = showBehaviorReversal;
        switchBehaviorReversal.addEventListener("change", (event) => {
            showBehaviorReversal = Boolean(event.target.checked);
            setLocalBool(STORAGE_BEHAVIOR_SHOW_REVERSAL, showBehaviorReversal);
            rerenderBehaviorOverlays();
        });
    }

    if (switchBehaviorEvent) {
        switchBehaviorEvent.checked = showBehaviorEvent;
        switchBehaviorEvent.addEventListener("change", (event) => {
            if (!behaviorEventAvailable) {
                event.target.checked = false;
                showBehaviorEvent = false;
                return;
            }
            showBehaviorEvent = Boolean(event.target.checked);
            setLocalBool(STORAGE_BEHAVIOR_SHOW_EVENT, showBehaviorEvent);
            rerenderBehaviorOverlays();
        });
    }

    sliderSpacing.addEventListener("input", (event) => {
        updateRangeLabel("label-spacing", event.target.value);
        setLocalFloat(STORAGE_SPACING, parseFloat(event.target.value));
        updateReplayUrlState({ includeFrame: false });
    });
    sliderEdgeScale.addEventListener("input", (event) => {
        updateRangeLabel("label-edge-scale", event.target.value);
        setLocalFloat(STORAGE_EDGE_SCALE, parseFloat(event.target.value));
        updateReplayUrlState({ includeFrame: false });
    });
    layoutSelect.addEventListener("change", (event) => {
        const layout = event.target.value || DEFAULTS.layout;
        setLocalStr(STORAGE_LAYOUT, layout);
        applyGraphLayout(layout);
        updateReplayUrlState({ includeFrame: false });
    });

    nodeSizeModeSelect.addEventListener("change", (event) => {
        setLocalStr(STORAGE_NODE_SIZE_MODE, event.target.value);
        updateReplayUrlState({ includeFrame: false });
        if (replayPayload) {
            updateFrame(currentFrame);
        }
    });
    nodeColorModeSelect.addEventListener("change", (event) => {
        setLocalStr(STORAGE_NODE_COLOR_MODE, event.target.value);
        setNodeColorRangeForMode(event.target.value);
        updateReplayUrlState({ includeFrame: false });
        if (replayPayload) {
            updateFrame(currentFrame);
        }
    });
    nodeColormapSelect.addEventListener("change", (event) => {
        setLocalStr(STORAGE_NODE_COLORMAP, event.target.value);
        updateReplayUrlState({ includeFrame: false });
        updateColorBars();
        if (replayPayload) {
            updateFrame(currentFrame);
        }
    });

    const updateColorRangeFromInput = () => {
        if (!replayPayload) return;
        const vmin = Number.parseFloat(nodeVMinInput.value);
        const vmax = Number.parseFloat(nodeVMaxInput.value);
        if (!Number.isFinite(vmin) || !Number.isFinite(vmax) || vmax <= vmin) return;
        updateReplayUrlState({ includeFrame: false });
        updateColorBars();
        updateFrame(currentFrame);
    };
    nodeVMinInput.addEventListener("input", updateColorRangeFromInput);
    nodeVMaxInput.addEventListener("input", updateColorRangeFromInput);
    nodeVMinInput.addEventListener("change", updateColorRangeFromInput);
    nodeVMaxInput.addEventListener("change", updateColorRangeFromInput);

    document.getElementById("button-clear-neurons").addEventListener("click", () => {
        neuronSelector.clear();
        selectedNodeIds.clear();
        updateExploreLink();
        updateReplayUrlState({ includeFrame: true });
    });
    document.getElementById("button-select-all-neurons").addEventListener("click", () => {
        const allNeuronValues = Object.keys(neuronSelector.options || {}).filter((value) => Boolean(value));
        if (allNeuronValues.length === 0) return;
        neuronSelector.setValue(allNeuronValues);
        selectedNodeIds.clear();
        updateExploreLink();
        updateReplayUrlState({ includeFrame: true });
    });
    if (buttonToggleSettings) {
        buttonToggleSettings.addEventListener("click", () => {
            const isExpanded = buttonToggleSettings.getAttribute("aria-expanded") === "true";
            setAdvancedSettingsVisible(!isExpanded);
        });
    }

    [buttonOpenExplore, buttonOpenExploreTop]
        .filter((button) => Boolean(button))
        .forEach((button) => {
            button.addEventListener("click", (event) => {
                if (button.classList.contains("disabled")) {
                    event.preventDefault();
                }
            });
        });
    if (buttonNodeInfoMore) {
        buttonNodeInfoMore.addEventListener("click", () => {
            renderSelectedNodesModalContent();
            if (!nodeInfoModalElement || !(window.bootstrap && window.bootstrap.Modal)) return;
            window.bootstrap.Modal.getOrCreateInstance(nodeInfoModalElement).show();
        });
    }

    document.getElementById("button-load-replay").addEventListener("click", () => {
        loadReplayData();
    });

    document.getElementById("button-reset-replay").addEventListener("click", () => {
        inputMinSynapseC.value = DEFAULTS.minSynapseChemical;
        inputMinSynapseE.value = DEFAULTS.minSynapseElectrical;
        edgeSizeModeSelect.value = DEFAULTS.edgeSizeMode;
        edgeColorModeSelect.value = DEFAULTS.edgeColorMode;
        edgeTypeSelect.value = DEFAULTS.edgeType;
        if (switchShowConnected) switchShowConnected.checked = DEFAULTS.showConnected;
        edgeColormapSelect.value = DEFAULTS.edgeColormap;
        setEdgeColorRangeForMode(DEFAULTS.edgeColorMode);
        nodeSizeModeSelect.value = DEFAULTS.nodeSizeMode;
        nodeColorModeSelect.value = DEFAULTS.nodeColorMode;
        nodeColormapSelect.value = DEFAULTS.nodeColormap;
        setNodeColorRangeForMode(DEFAULTS.nodeColorMode);
        speedSelect.value = String(DEFAULTS.speed);
        sliderSpacing.value = String(DEFAULTS.spacing);
        sliderEdgeScale.value = String(DEFAULTS.edgeScale);
        updateRangeLabel("label-spacing", sliderSpacing.value);
        updateRangeLabel("label-edge-scale", sliderEdgeScale.value);
        setLocalStr(STORAGE_EDGE_SIZE_MODE, DEFAULTS.edgeSizeMode);
        setLocalStr(STORAGE_EDGE_COLOR_MODE, DEFAULTS.edgeColorMode);
        setLocalStr(STORAGE_EDGE_TYPE, DEFAULTS.edgeType);
        setLocalBool(STORAGE_SHOW_CONNECTED, DEFAULTS.showConnected);
        setLocalStr(STORAGE_EDGE_COLORMAP, DEFAULTS.edgeColormap);
        setLocalStr(STORAGE_NODE_SIZE_MODE, DEFAULTS.nodeSizeMode);
        setLocalStr(STORAGE_NODE_COLOR_MODE, DEFAULTS.nodeColorMode);
        setLocalStr(STORAGE_NODE_COLORMAP, DEFAULTS.nodeColormap);
        setLocalStr(STORAGE_LAYOUT, DEFAULTS.layout);
        layoutSelect.value = DEFAULTS.layout;
        setLocalFloat(STORAGE_SPACING, DEFAULTS.spacing);
        setLocalFloat(STORAGE_EDGE_SCALE, DEFAULTS.edgeScale);
        showBehaviorReversal = DEFAULTS.showReversal;
        showBehaviorEvent = DEFAULTS.showEvent;
        setLocalBool(STORAGE_BEHAVIOR_SHOW_REVERSAL, showBehaviorReversal);
        setLocalBool(STORAGE_BEHAVIOR_SHOW_EVENT, showBehaviorEvent);
        syncBehaviorOptionsUI(replayPayload?.behavior);
        updateElectricalInputState();
        updateReplayUrlState({ includeFrame: false });
        loadReplayData();
    });

    document.getElementById("button-play-pause").addEventListener("click", () => {
        if (!replayPayload) return;
        if (isPlaying) {
            stopPlayback();
        } else {
            startPlayback();
        }
    });

    document.getElementById("button-step-back").addEventListener("click", () => {
        if (!replayPayload) return;
        stopPlayback();
        updateFrame(currentFrame - 1);
    });

    document.getElementById("button-step-forward").addEventListener("click", () => {
        if (!replayPayload) return;
        stopPlayback();
        updateFrame(currentFrame + 1);
    });

    document.getElementById("replay-slider").addEventListener("input", (event) => {
        if (!replayPayload) return;
        stopPlayback();
        updateFrame(parseInt(event.target.value, 10));
    });

    speedSelect.addEventListener("change", (event) => {
        const speed = parseFloat(event.target.value) || DEFAULTS.speed;
        setLocalFloat(STORAGE_SPEED, speed);
        updateReplayUrlState({ includeFrame: false });
        if (isPlaying) {
            startPlayback();
        }
    });

    edgeSizeModeSelect.addEventListener("change", (event) => {
        const mode = normalizeEdgeMode(event.target.value);
        setLocalStr(STORAGE_EDGE_SIZE_MODE, mode);
        updateReplayUrlState({ includeFrame: false });
        if (replayPayload) {
            updateFrame(currentFrame);
        }
    });
    edgeColorModeSelect.addEventListener("change", (event) => {
        const mode = normalizeEdgeMode(event.target.value);
        setLocalStr(STORAGE_EDGE_COLOR_MODE, mode);
        setEdgeColorRangeForMode(mode);
        updateReplayUrlState({ includeFrame: false });
        if (replayPayload) {
            updateFrame(currentFrame);
        }
    });
    edgeTypeSelect.addEventListener("change", (event) => {
        const edgeType = normalizeEdgeType(event.target.value);
        edgeTypeSelect.value = edgeType;
        updateElectricalInputState();
        setLocalStr(STORAGE_EDGE_TYPE, edgeType);
        appliedEdgeType = edgeType;
        updateReplayUrlState({ includeFrame: false });
        if (rawReplayPayload) {
            stopPlayback();
            applyNeuronFilter();
        }
    });
    if (switchShowConnected) {
        switchShowConnected.addEventListener("change", (event) => {
            const showConnected = Boolean(event.target.checked);
            setLocalBool(STORAGE_SHOW_CONNECTED, showConnected);
            updateReplayUrlState({ includeFrame: false });
            if (activitySelector.getValue() && connectomeSelector.getValue()) {
                loadReplayData();
            }
        });
    }
    edgeColormapSelect.addEventListener("change", (event) => {
        setLocalStr(STORAGE_EDGE_COLORMAP, event.target.value);
        updateReplayUrlState({ includeFrame: false });
        updateColorBars();
        if (replayPayload) {
            updateFrame(currentFrame);
        }
    });

    const updateEdgeColorRangeFromInput = () => {
        if (!replayPayload) return;
        const vmin = Number.parseFloat(edgeVMinInput.value);
        const vmax = Number.parseFloat(edgeVMaxInput.value);
        if (!Number.isFinite(vmin) || !Number.isFinite(vmax) || vmax <= vmin) return;
        updateReplayUrlState({ includeFrame: false });
        updateColorBars();
        updateFrame(currentFrame);
    };
    edgeVMinInput.addEventListener("input", updateEdgeColorRangeFromInput);
    edgeVMaxInput.addEventListener("input", updateEdgeColorRangeFromInput);
    edgeVMinInput.addEventListener("change", updateEdgeColorRangeFromInput);
    edgeVMaxInput.addEventListener("change", updateEdgeColorRangeFromInput);

    updateExploreLink();
    loadReplayData().finally(() => {
        runReplayTour();
    });
});
