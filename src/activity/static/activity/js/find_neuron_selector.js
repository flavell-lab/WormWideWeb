export class DatasetNeuronSelector {
    constructor(selectorNeuronId, table) {
        // Retrieve the selector element by ID and ensure it exists
        this.selectorNeuronElement = document.getElementById(selectorNeuronId);
        if (!this.selectorNeuronElement) {
            throw new Error(`Element with ID "${selectorNeuronId}" not found.`);
        }

        this.tableManager = table
        this.dataMatch = table.data.match
        this.dataClass = table.data.class
        // console.log(this.tableManager.data)

        // generate options
        const options = [];
        const optionGroups = [];
        Object.keys(this.dataClass).forEach((neuronClass) => {
            // group
            optionGroups.push({label: neuronClass, value: neuronClass})

            // class all
            if (this.dataClass[neuronClass].length > 1) {
                options.push(this.generateNeuronClassOption(neuronClass))
            }

            options.push(this.generateNeuronOptions(neuronClass, this.dataClass[neuronClass]))
        });

        // Initialize the TomSelect selector
        this.selector = this.initSelector(optionGroups);
        this.selector.addOptions(options)
    }

    generateNeuronClassOption(neuronClass) {
        return {value: `${neuronClass}*`, name: neuronClass, class: neuronClass, dv: '', lr: '', classq: true}
    }

    generateNeuronOptions(neuronClass, neuronsData) {
        const options = [];
        neuronsData.forEach(neuron => {
            const dv = neuron[0] != 'x' ? neuron[0] : ''
            const lr = neuron[1] != 'x' ? neuron[1] : ''
            const neuronName = (`${neuronClass}${dv.toUpperCase()}${lr.toUpperCase()}`)
            options.push({value: neuronName, name: neuronName, class: neuronClass, dv: dv, lr: lr, classq: false})
        });

        return options
    }

    getRenderConfig() {
        return {
            option: (data, escape) =>
                data.classq ? `<div>${escape(data.name)} (any)</div>` : `<div>${escape(data.name)}</div>`,
            optgroup_header: (data, escape) =>
                `<div style="color:black;" class="optgroup-header"><strong>${escape(data.label)}</strong></div>`,
        };
    }

    initSelector(optionGroups) {
        return new TomSelect(this.selectorNeuronElement, {
            plugins: ['n_items', 'checkbox_options', 'dropdown_input'],
            persist: false,
            create: false,
            maxOptions: null,
            optgroups: optionGroups,
            optgroupField: "class",
            sortField: [{ field: "class" }, { field: "dv" }, { field: "lr"}, { field: "name" }],
            valueField: "value",
            labelField: "name",
            searchField: ["name"],
            disabledField: "disabled",
            render: this.getRenderConfig(),
            onItemAdd: this.selectorNeuronAdd.bind(this),    
            onItemRemove: this.selectorNeuronRemove.bind(this),
            onChange: this.selectorNeuronChange.bind(this),
            // onClear: () => this.selectorDataset.close(),
        });    
    }

    stringNeuronKey(neuronClass, dv, lr) {
        return `${neuronClass}_${lr === '' ? 'x' : lr}_${dv === '' ? 'x' : dv}`
    }

    addMatchDictClass(thisOption) {
        const neuronClass = thisOption.class
        const lrdvCombination = this.dataClass[neuronClass]

        const classMatch = {}
        lrdvCombination.forEach((combi) => {
            const [dv,lr] = combi
            const neuronKey = this.stringNeuronKey(neuronClass, dv, lr)
            const matches = this.dataMatch[neuronKey]
            for (const [datasetId, idxNeuronList] of Object.entries(matches)) {
                if (datasetId in classMatch) {
                    classMatch[datasetId] = idxNeuronList.concat(classMatch[datasetId])
                } else {
                    classMatch[datasetId] = idxNeuronList
                }
            }
        })

        if (Object.keys(this.matchAll).length === 0) {
            // empty dict, init
            for (const [datasetId, idxNeuronList] of Object.entries(classMatch)) {
                this.matchAll[datasetId] = idxNeuronList
            }            
        } else {
            // add
            for (const [datasetId, idxNeuronList] of Object.entries(this.matchAll)) {
                // if both neurons are present then add
                if (datasetId in classMatch) {
                    this.matchAll[datasetId] = idxNeuronList.concat(classMatch[datasetId])
                } else {
                    delete this.matchAll[datasetId]
                }
            }
        }
    }

    addMatchDictNeuron(thisOption) {
        const neuronClass = thisOption.class
        const neuronKey = this.stringNeuronKey(neuronClass, thisOption.dv, thisOption.lr)
        
        if (Object.keys(this.matchAll).length === 0) {
            // empty dict, init
            for (const [datasetId, idxNeuronList] of Object.entries(this.dataMatch[neuronKey])) {
                this.matchAll[datasetId] = idxNeuronList
            }
        } else {
            const matches = this.dataMatch[neuronKey]
            for (const [datasetId, idxNeuronList] of Object.entries(this.matchAll)) {
                // if both neurons are present then add
                if (datasetId in matches) {
                    this.matchAll[datasetId] = idxNeuronList.concat(matches[datasetId])
                } else {
                    // delete non-intersecting match
                    delete this.matchAll[datasetId]
                }
            }
        }
    }

    selectorNeuronChange(value) {
        this.matchAll = {}
        if (value) {
            const listNeuronSelected = value.split(',')
            listNeuronSelected.forEach(value => {
                const thisOption = this.selector.options[value];
                const neuronClass = thisOption.class
                
                if (thisOption.classq)
                {
                    // class selected
                    this.addMatchDictClass(thisOption)
                } else {
                    // single neuron selected
                    this.addMatchDictNeuron(thisOption)
                }
            })
        }
        this.tableManager.updateMatch(this.matchAll)
    }

    selectorNeuronAdd(value, item) {
        // if class is selected remove, neuron instances. if a neuron, remove the class
        const thisOption = this.selector.options[value];
        const neuronClass = thisOption.class
        if (thisOption.classq) {
            const neuronsData = data.class[neuronClass]
            const options = this.generateNeuronOptions(neuronClass, neuronsData)
            options.forEach(option => {
                this.selector.removeOption(option.value)
            })
        } else {
            // is instances/individual neurons
            this.selector.removeOption(`${neuronClass}*`)
        }
    }

    selectorNeuronRemove(value, item) {
        // add back neurons or neuron class
        const selectorOptions = this.selector.options;
        const thisOption = selectorOptions[value];
        const neuronClass = thisOption.class
        const neuronsData = data.class[neuronClass]
        const options = this.generateNeuronOptions(neuronClass, neuronsData)
        const selectionStr = this.selector.getValue()

        if (thisOption.classq) {
            // class removed, add neurons
            this.selector.addOptions(options)
        } else {
            // skip if class has only one option
            if (options.length < 2) { return }

            // check to see if there's no individual neuron and add class
            if (
                !selectorOptions[neuronClass] &&
                options.every((option) => !selectionStr.includes(option.value))
            ) {
                this.selector.addOption(this.generateNeuronClassOption(neuronClass))
            }
        }
    }

    clearSelector() {
        this.selector.clear();
    }
}
