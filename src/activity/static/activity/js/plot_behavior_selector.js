export class BehaviorSelector {
    constructor(selectorBehaviorId, plotManager) {
        this.selectorBehaviorElement = document.getElementById(selectorBehaviorId);
        this.plotManager = plotManager;

        const behavior = plotManager.data.behavior.traces;
        this.behaviorMeta = {}

        Object.keys(behavior).forEach((b)=>{
            this.behaviorMeta[b] = {"name": behavior[b].name, "unit": behavior[b].unit, "nameShort": b}
        })

        this.initSelector();
    }

    initSelector() {
        this.selector =  new TomSelect(this.selectorBehaviorElement, {
            plugins: ['n_items','checkbox_options','dropdown_input'],
            persist: false,
            create: false,
            valueField: "nameShort",
            labelField: "name",
            searchField: ["name"],
            onItemAdd: (value, item) => this.selectorAdd(value, item),
            onItemRemove: (value, item) => this.selectorRemove(value, item),
        });

        this.selector.addOptions(this.behaviorMeta)
    }

    selectorAdd(value, item) {
        // console.log(`behavior ${value} added`)
        const optionData = this.selector.options[value]
        const nameShort = optionData.nameShort
        const label = `${optionData.name}<br>(${optionData.unit})`;
        this.plotManager.plotBehavior(nameShort, label)
    }

    selectorRemove(value, item) {
        // console.log(`behavior ${value} removed`)
        const optionData = this.selector.options[value]
        const nameShort = optionData.nameShort
        this.plotManager.removeBehavior(nameShort)
    }

    clearSelector() {
        this.selector.clear();
    }

    plot_behavior() {

    }
}