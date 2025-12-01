import { SelectorDatasetNeuron, getNeuronClassProperty } from '/static/connectome/js/connectome_selector.js';
import { ConnectomeGraph } from '/static/connectome/js/connectome_graph.js';
import { EncodingFeatureManager } from '../encoding_feature_manager.js';
import { setLocalStr, setLocalBool, getLocalBool, toggleFullscreen, handleFullscreenElement } from "/static/core/js/utility.js"

document.addEventListener('DOMContentLoaded', () => {
  const tooltipTriggerList = document.querySelectorAll('[data-bs-toggle="tooltip"]')
  const tooltipList = [...tooltipTriggerList].map(tooltipTriggerEl => new bootstrap.Tooltip(tooltipTriggerEl))

  // default options
  const defaultDataset = localStorage.getItem("encoding_connectome_selected_dataset_str")
  if (defaultDataset === null) {
    setLocalStr("encoding_connectome_selected_dataset_str", "white_1986_whole,witvliet_2020_7,witvliet_2020_8")
  }

  const connectomeLayout = localStorage.getItem("encoding_connectome_layout")
  if (connectomeLayout === null) {
    setLocalStr("encoding_connectome_layout", "grid")
  }

  const splitLR = localStorage.getItem("encoding_connectome_show_individual_neuron")
  if (splitLR === null) {
    setLocalBool("encoding_connectome_show_individual_neuron", true)
  }

  // init
  const connectomeGraph = new ConnectomeGraph("connectome-graph", "encoding");
  const selectorDatasetNeuron = new SelectorDatasetNeuron("select-dataset", "select-neuron", connectomeGraph);
  const featureManager = new EncodingFeatureManager(connectomeGraph, "select-feature", matchData)

  // fullscreen
  // button
  const connectomeContainer = document.getElementById("connectome-container");
  const buttonConnectomeFullscreen = document.getElementById("buttonConnectomeFullscreen");
  const connectomeFullscreenIcon = document.getElementById("connectomeFullscreenIcon");
  const connectomeFullscreenLabel = document.getElementById("connectomeFullscreenLabel");
  buttonConnectomeFullscreen.addEventListener("click", () => {
    toggleFullscreen(connectomeContainer);
  });

  const fullscreenMap = {
    "connectome-container": {
      icon: connectomeFullscreenIcon,
      label: connectomeFullscreenLabel,
      // connectome doesn't need a special callback, so we can omit it
    }
  };

  document.addEventListener("fullscreenchange", () => {
    handleFullscreenElement(fullscreenMap, "connectome-container");
  });

  // select all
  function selectAllLabeledNeuron(tomSelectInstance) {
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

  // select all neurons
  const buttonAllNeurons = document.getElementById("buttonAllNeurons")
  buttonAllNeurons.addEventListener('click', () => {
    selectAllLabeledNeuron(selectorDatasetNeuron.selectorNeuron)
  });

// clear neurons
const buttonClearNeurons = document.getElementById("clearNeurons")
buttonClearNeurons.addEventListener('click', ()=>{
  selectorDatasetNeuron.selectorNeuron.clear();
})

  /*
      Tour
  */
  const tourEncoding = getLocalBool("tour-connectome-encoding", true)

  if (tourEncoding) {
    const tour = new Shepherd.Tour({
      useModalOverlay: true,
      defaultStepOptions: {
        classes: 'shadow-md bg-white',
        scrollTo: true,
        cancelIcon: {
          enabled: true
        },
      },
    });

    tour.addStep({
      id: "init",
      text: '<strong>Tutorial</strong><br>Click the "X" button on the top right of this modal to skip',
      buttons: [
        { text: 'Next', action: tour.next }
      ],
    })

    tour.addStep({
      id: 'step-selector',
      text: '<strong>Select neurons</strong> to add to the diagram.',
      attachTo: {
        element: '#selectNeuronContainer',
        on: 'top',
      },
      buttons: [
        { text: 'Next', action: tour.next }
      ],
    });

    tour.addStep({
      id: 'step-nodes',
      text: 'Neurons and synapses are displayed in the diagram.<br><br>You can <strong>scroll to zoom in/out</strong> and click the background and move to pan around.<br><br>You can select to color the displayed nodes with an encoding feature such as forwardness, as displayed here.',
      attachTo: {
        element: '#connectome-graph',
        on: 'top'
      },
      buttons: [
        { text: 'Next', action: tour.next }
      ],
      beforeShowPromise: () => {
        selectorDatasetNeuron.selectorNeuron.addItems(["AVEL", "AVBL", "RIBL"])
        return Promise.resolve();
      }
    });

    tour.addStep({
      id: 'step-node-select',
      text: 'Select a neuron/node to highlght its connections.',
      attachTo: {
        element: '#connectome-graph',
        on: 'top'
      },
      buttons: [
        { text: 'Next', action: tour.next }
      ],
      beforeShowPromise: () => {
        const node = connectomeGraph.graph.getElementById("AVBL"); // Get the node by ID
        node.trigger('select');
        return Promise.resolve();
      }
    });

    tour.addStep({
      id: 'step-node-info',
      text: 'Node info is displayed here, along with the links to select external resources.',
      attachTo: {
        element: '.info-panel',
        on: 'right'
      },
      buttons: [
        { text: 'Next', action: tour.next }
      ],
      beforeShowPromise: () => {
        const node = connectomeGraph.graph.getElementById("AVBL"); // Get the node by ID
        node.trigger('tap');
        return Promise.resolve();
      }
    });

    tour.addStep({
      id: 'step-node-find',
      text: 'Find and plot neural activity data of this neuron class.',
      attachTo: {
        element: '#buttonFindActivity',
        on: 'right'
      },
      buttons: [
        { text: 'Next', action: tour.next }
      ],
    });

    tour.addStep({
      id: 'step-5-connectome-layout',
      text: 'Change the connectome diagram layout.',
      attachTo: {
        element: '#dropdownLayoutContainer',
        on: 'right'
      },
      buttons: [
        { text: 'Next', action: tour.next }
      ],
      beforeShowPromise: () => {
        const node = connectomeGraph.graph.getElementById("AVBL"); // Get the node by ID
        node.trigger('unselect');
        connectomeGraph.infoPanel.hidePanel();

        const layoutGrid = document.querySelector('.dropdown-item[data-value="concentric"]');
        layoutGrid.click();
        return Promise.resolve();
      },
    });

    tour.addStep({
      id: 'step-encoding-button',
      text: 'Change the encoding feature to display and adjust the color scale.',
      attachTo: {
        element: '#encodingFeatureButton',
        on: 'right'
      },
      buttons: [
        { text: 'Complete', action: tour.complete }
      ],
    });

    tour.on('complete', () => {
      setLocalBool("tour-connectome-encoding", false);
    });

    tour.on('cancel', () => {
      setLocalBool("tour-connectome-encoding", false);
    });

    tour.start()
  }
});