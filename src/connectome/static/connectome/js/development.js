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

const STORAGE = {
    selectedValues: 'connectome_development_selected_values',
    scopeMode: 'connectome_development_scope_mode',
    includeElectrical: 'connectome_development_include_electrical',
    sliderStage: 'connectome_development_slider_stage',
};

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

function edgeTypeLabel(edgeType) {
    return edgeType === 'e' ? 'Electrical' : 'Chemical';
}

function buildEdgeLabel(edge) {
    return `${edge.pre} -> ${edge.post} (${edgeTypeLabel(edge.type)})`;
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

class DevelopmentTrajectoryController {
    constructor() {
        this.availableNeuronData = { neurons: {}, neuron_classes: {} };
        this.manifest = {};
        this.currentData = null;
        this.basePositions = {};

        this.neuronSelector = null;
        this.neuronSelectorWasMouseSelect = false;

        this.stageGraphs = [];
        this.sliderGraph = null;
        this.sliderHasBeenFit = false;

        this.selectedEdgeIndex = null;
        this.lastRequestToken = 0;
        this.loadingCount = 0;

        this.scopeMode = getLocalStr(STORAGE.scopeMode, 'within');
        this.includeElectrical = getLocalBool(STORAGE.includeElectrical, false);
        this.sliderStageIndex = clamp(parseInt(getLocalStr(STORAGE.sliderStage, '0'), 10) || 0, 0, STAGES.length - 1);

        this.autoplayTimer = null;

        this.scheduleRefresh = debounce(() => this.refresh(), 350);
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
        this.scopeWithinElement = document.getElementById('development-scope-within');
        this.scopeNeighborsElement = document.getElementById('development-scope-neighbors');
        this.includeElectricalElement = document.getElementById('development-switch-electrical');
        this.clearButton = document.getElementById('development-clear-neurons');
    }

    initTooltips() {
        const tooltipTriggerList = document.querySelectorAll('[data-bs-toggle="tooltip"]');
        [...tooltipTriggerList].forEach((el) => new bootstrap.Tooltip(el));
    }

    initControls() {
        this.initNeuronSelector();

        if (this.scopeMode === 'neighbors') {
            this.scopeNeighborsElement.checked = true;
        } else {
            this.scopeWithinElement.checked = true;
        }

        this.scopeWithinElement.addEventListener('change', () => {
            if (!this.scopeWithinElement.checked) return;
            this.scopeMode = 'within';
            setLocalStr(STORAGE.scopeMode, this.scopeMode);
            this.scheduleRefresh();
        });

        this.scopeNeighborsElement.addEventListener('change', () => {
            if (!this.scopeNeighborsElement.checked) return;
            this.scopeMode = 'neighbors';
            setLocalStr(STORAGE.scopeMode, this.scopeMode);
            this.scheduleRefresh();
        });

        this.includeElectricalElement.checked = this.includeElectrical;
        this.includeElectricalElement.addEventListener('change', () => {
            this.includeElectrical = this.includeElectricalElement.checked;
            setLocalBool(STORAGE.includeElectrical, this.includeElectrical);
            this.scheduleRefresh();
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
                        width: (edge) => {
                            const count = Number(edge.data('count') || 0);
                            const scale = compactMode ? 1.9 : 2.2;
                            return Math.max(0.7, Math.log(count + 1) * scale);
                        },
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
            this.currentData = null;
            this.updateSelectionSummary();
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

            this.currentData = this.transformResponse(responseData);
            this.selectedEdgeIndex = this.resolveSelectedEdgeIndex(this.selectedEdgeIndex);
            this.basePositions = this.computeBasePositions(this.currentData);

            this.updateSelectionSummary();
            this.updateDensityNotice(this.currentData);
            this.renderHeatmap(this.currentData);
            this.renderTrend(this.currentData);
            this.renderSmallMultiples(this.currentData);
            this.updateSliderStageView();
        } catch (error) {
            console.error('Failed refreshing developmental trajectory:', error);
            this.renderErrorState('Could not load connectome trajectory. Please try again.');
        } finally {
            this.setLoading(false);
        }
    }

    async fetchEdgeData() {
        const payload = {
            datasets: WITVLIET_DATASET_IDS,
            neurons: [],
            classes: [],
            show_individual_neuron: false,
            show_connected_neuron: this.scopeMode === 'neighbors',
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
            .filter((synapse) => this.includeElectrical || synapse.type === 'c')
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
                    key: `${synapse.pre}!${synapse.post}!${synapse.type}`,
                    pre: synapse.pre,
                    post: synapse.post,
                    type: synapse.type,
                    stageValues,
                    stageMins,
                    stageMaxs,
                    listCount,
                    total: stageValues.reduce((acc, value) => acc + value, 0),
                };
            })
            .sort((edgeA, edgeB) => {
                if (edgeB.total !== edgeA.total) {
                    return edgeB.total - edgeA.total;
                }
                return buildEdgeLabel(edgeA).localeCompare(buildEdgeLabel(edgeB));
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

        layoutGraph.layout({
            name: 'concentric',
            fit: false,
            avoidOverlap: true,
            minNodeSpacing: 24,
            spacingFactor: 1.05,
            animate: false,
        }).run();

        const positions = {};
        layoutGraph.nodes().forEach((node) => {
            positions[node.id()] = { ...node.position() };
        });

        layoutGraph.destroy();
        return positions;
    }

    getStageEdgeCount(stageIndex) {
        if (!this.currentData?.edges) return 0;
        return this.currentData.edges.filter((edge) => edge.stageValues[stageIndex] > 0).length;
    }

    buildStageElements(stageIndex) {
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

    applyStageElementsToGraph(graph, stageIndex, fitGraph = true) {
        const { nodeElements, edgeElements } = this.buildStageElements(stageIndex);

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
            this.renderEmptyHeatmap('No edges match the current selection and scope.');
            return;
        }

        const yLabels = data.edges.map((edge) => buildEdgeLabel(edge));
        const zValues = data.edges.map((edge) => edge.stageValues);

        Plotly.react(this.heatmapElement, [{
            type: 'heatmap',
            x: STAGES.map((stage) => stage.shortLabel),
            y: yLabels,
            z: zValues,
            colorscale: 'Blues',
            hovertemplate: '<b>%{y}</b><br>%{x}: %{z}<extra></extra>',
            colorbar: {
                title: 'Count',
                thickness: 10,
            },
        }], {
            margin: { t: 10, r: 8, b: 44, l: 210 },
            xaxis: {
                title: 'Development stage',
            },
            yaxis: {
                automargin: true,
                tickfont: { size: 10 },
            },
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

        const l4Upper = edge.stageMaxs[6] - edge.stageValues[6];
        const l4Lower = edge.stageValues[6] - edge.stageMins[6];

        Plotly.react(this.trendElement, [
            {
                type: 'scatter',
                mode: 'lines+markers',
                x: STAGES.map((stage) => stage.shortLabel),
                y: edge.stageValues,
                name: buildEdgeLabel(edge),
                line: {
                    color: '#1d4ed8',
                    width: 2.8,
                },
                marker: {
                    size: 8,
                    color: '#1d4ed8',
                },
                error_y: {
                    type: 'data',
                    symmetric: false,
                    array: [0, 0, 0, 0, 0, 0, l4Upper],
                    arrayminus: [0, 0, 0, 0, 0, 0, l4Lower],
                    color: '#1d4ed8',
                    thickness: 1.5,
                    width: 3,
                    visible: true,
                },
                hovertemplate: '%{x}: %{y}<extra></extra>',
            },
            {
                type: 'scatter',
                mode: 'markers',
                x: ['L4 50h', 'L4 50h'],
                y: [edge.listCount[6], edge.listCount[7]],
                text: ['Dataset 7 raw', 'Dataset 8 raw'],
                marker: {
                    color: '#f59e0b',
                    size: 9,
                    symbol: ['circle-open', 'diamond-open'],
                    line: {
                        color: '#92400e',
                        width: 1,
                    },
                },
                hovertemplate: '%{text}: %{y}<extra></extra>',
                name: 'Datasets 7/8',
            },
        ], {
            margin: { t: 18, r: 8, b: 40, l: 52 },
            xaxis: {
                title: 'Stage',
            },
            yaxis: {
                title: 'Raw synapse count',
                rangemode: 'tozero',
            },
            template: 'plotly_white',
            showlegend: false,
        }, {
            displayModeBar: false,
            responsive: true,
        });

        this.trendDetailsElement.innerHTML = `
            <div class="development-trend-title mb-2"><strong>${escapeHtml(buildEdgeLabel(edge))}</strong></div>
            <div class="development-trend-stat"><span>L4 mean (7+8)</span><span>${stageValueLabel(edge.stageValues[6])}</span></div>
            <div class="development-trend-stat"><span>Dataset 7 raw</span><span>${stageValueLabel(edge.listCount[6])}</span></div>
            <div class="development-trend-stat"><span>Dataset 8 raw</span><span>${stageValueLabel(edge.listCount[7])}</span></div>
            <div class="development-trend-stat"><span>L4 variability</span><span>${formatCount(edge.stageMins[6])} - ${formatCount(edge.stageMaxs[6])}</span></div>
            <div class="development-trend-stat"><span>Total trajectory count</span><span>${stageValueLabel(edge.total)}</span></div>
        `;
    }

    renderSmallMultiples(data) {
        this.stageGraphs.forEach((graph, stageIndex) => {
            this.applyStageElementsToGraph(graph, stageIndex, true);
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
        this.applyStageElementsToGraph(this.sliderGraph, this.sliderStageIndex, shouldFit);
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
                this.applyStageElementsToGraph(graph, stageIndex, true);
            }
        });

        if (this.sliderGraph) {
            this.sliderGraph.resize();
            if (this.currentData?.edges?.length) {
                this.applyStageElementsToGraph(this.sliderGraph, this.sliderStageIndex, false);
            }
        }
    }

    renderNoSelectionState() {
        this.stopAutoplay();
        this.currentData = null;
        this.basePositions = {};
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
    const controller = new DevelopmentTrajectoryController();
    try {
        await controller.init();
    } catch (error) {
        console.error('Failed to initialize development trajectory page:', error);
        controller.renderErrorState('Failed to initialize development trajectory page.');
    }
});
