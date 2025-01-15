import { PathSelector } from './path_selector.js';
import { PathGraph } from './path_graph.js';

document.addEventListener('DOMContentLoaded', () => {
    const tooltipTriggerList = document.querySelectorAll('[data-bs-toggle="tooltip"]')
    const tooltipList = [...tooltipTriggerList].map(tooltipTriggerEl => new bootstrap.Tooltip(tooltipTriggerEl))

    const connectomeGraph = new PathGraph("path-graph");
    const pathSelector = new PathSelector("select-dataset", "select-start-neuron", "select-end-neuron", connectomeGraph);    
})