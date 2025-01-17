import { SelectorDatasetNeuron, getNeuronClassProperty } from '/static/connectome/js/connectome_selector.js';
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
        const listNeuronOptions = []
        Object.keys(tomSelectInstance.options).forEach(optionKey => {
          let option = tomSelectInstance.options[optionKey]
          let cellType = getNeuronClassProperty(option.value, "encoding_neuron_data")["cell_type"]

          if (option.value in featureManager.matchData) {
            listNeuronOptions.push(option.value)
          }
        });

        tomSelectInstance.setValue(listNeuronOptions);
    }

    const buttonAllNeurons = document.getElementById("buttonAllNeurons")
    buttonAllNeurons.addEventListener('click', () => {
      selectAllOptions(selectorDatasetNeuron.selectorNeuron)
    });
});