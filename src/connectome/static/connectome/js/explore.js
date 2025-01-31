import Shepherd from 'https://cdn.jsdelivr.net/npm/shepherd.js@13.0.0/dist/esm/shepherd.mjs';
import { SelectorDatasetNeuron } from './connectome_selector.js';
import { ConnectomeGraph } from './connectome_graph.js';
import { setLocalBool, getLocalBool, toggleFullscreen, handleFullscreenElement } from "/static/core/js/utility.js"

document.addEventListener('DOMContentLoaded', () => {
    const tooltipTriggerList = document.querySelectorAll('[data-bs-toggle="tooltip"]')
    const tooltipList = [...tooltipTriggerList].map(tooltipTriggerEl => new bootstrap.Tooltip(tooltipTriggerEl))

    const connectomeGraph = new ConnectomeGraph("connectome-graph", null);
    const selectorDatasetNeuron = new SelectorDatasetNeuron("select-dataset", "select-neuron", connectomeGraph, true);

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

    if (getLocalBool("tour-connectome-general", true)) {
        const tour = new Shepherd.Tour({
            useModalOverlay: true,
            defaultStepOptions: {
                classes: 'shadow-md bg-white',
                scrollTo: false,
                cancelIcon: {
                    enabled: true
                }
            }
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
            text: 'Select neurons or neuron classes to add to the diagram.',
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
            text: 'Neurons and synapses are displayed in the diagram.<br><br>You can scroll to zoom in/out and click the background and move to pan around.',
            attachTo: {
                element: '#connectome-graph',
                on: 'top'
            },
            buttons: [
                { text: 'Next', action: tour.next }
            ],
            beforeShowPromise: () => {
                selectorDatasetNeuron.selectorNeuron.addItems(["AVA", "RIM"])
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
                const node = connectomeGraph.graph.getElementById("AVA"); // Get the node by ID
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
                const node = connectomeGraph.graph.getElementById("AVA"); // Get the node by ID
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
                { text: 'Complete', action: tour.complete }
            ],
            beforeShowPromise: () => {
                const node = connectomeGraph.graph.getElementById("AVA"); // Get the node by ID
                node.trigger('unselect');
                connectomeGraph.infoPanel.hidePanel();

                const layoutGrid = document.querySelector('.dropdown-item[data-value="grid"]');
                layoutGrid.click();
                return Promise.resolve();
            },
        });

        tour.on('complete', () => {
            //     selectorDatasetNeuron.clearNeuronSelector();

            //     const layoutConcentric = document.querySelector('.dropdown-item[data-value="concentric"]');
            //     const colorType = document.querySelector('.dropdown-item[data-value="type"]');
            //     layoutConcentric.click();
            //     colorType.click();

            setLocalBool("tour-connectome-general", false);
        });

        tour.on('cancel', () => {
            //     selectorDatasetNeuron.clearNeuronSelector();

            //     const layoutConcentric = document.querySelector('.dropdown-item[data-value="concentric"]');
            //     const colorType = document.querySelector('.dropdown-item[data-value="type"]');
            //     layoutConcentric.click();
            //     colorType.click();

            setLocalBool("tour-connectome-general", false);
        });

        tour.start()
    }
});