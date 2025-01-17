import { SelectorDatasetNeuron } from '/static/connectome/js/connectome_selector.js';
import { ConnectomeGraph } from '/static/connectome/js/connectome_graph.js';
import { EncodingFeatureManager } from '../encoding_feature_manager.js';
import { setLocalStr } from '/static/core/js/utility.js'

document.addEventListener('DOMContentLoaded', () => {
    const tooltipTriggerList = document.querySelectorAll('[data-bs-toggle="tooltip"]')
    const tooltipList = [...tooltipTriggerList].map(tooltipTriggerEl => new bootstrap.Tooltip(tooltipTriggerEl))

    const defaultDataset = localStorage.getItem("encoding_connectome_selected_dataset_str")
    if (defaultDataset === null) {
      setLocalStr("encoding_connectome_selected_dataset_str", "white_1986_whole,witvliet_2020_7,witvliet_2020_8")
    }

    const connectomeGraph = new ConnectomeGraph("connectome-graph", "encoding");
    const selectorDatasetNeuron = new SelectorDatasetNeuron("select-dataset", "select-neuron", connectomeGraph);
    const featureManager = new EncodingFeatureManager(connectomeGraph, "select-feature", matchData)

    function selectAllOptions(tomSelectInstance) {
        // Collect all option values
        const allValues = Object.keys(tomSelectInstance.options).map(
          key => tomSelectInstance.options[key].value
        );
        // Update the selection
        tomSelectInstance.setValue(allValues);
    }
});