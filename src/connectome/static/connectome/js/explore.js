import { SelectorDatasetNeuron } from './connectome_selector.js';
import { ConnectomeGraph } from './connectome_graph.js';

document.addEventListener('DOMContentLoaded', () => {
    const tooltipTriggerList = document.querySelectorAll('[data-bs-toggle="tooltip"]')
    const tooltipList = [...tooltipTriggerList].map(tooltipTriggerEl => new bootstrap.Tooltip(tooltipTriggerEl))

    const connectomeGraph = new ConnectomeGraph("connectome-graph");
    const selectorDatasetNeuron = new SelectorDatasetNeuron("select-dataset", "select-neuron", connectomeGraph, true);    
});