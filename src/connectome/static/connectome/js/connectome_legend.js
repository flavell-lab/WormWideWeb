export class ConnectomeLegend {
    constructor(graph, legendId = "connectome-legend", legendItemsId = "connectome-legend-items") {
        this.graph = graph; // Cytoscape instance
        this.legendId = legendId;
        this.legendItemsId = legendItemsId;

        // Get the legend containers
        this.legendContainer = document.getElementById(legendId);
        this.legendItemsContainer = document.getElementById(legendItemsId);

        // Validate DOM elements
        if (!this.legendContainer || !this.legendItemsContainer) {
            console.warn("Legend container elements not found. Check the provided IDs.");
            return;
        }

        // Default color scheme
        this.colorScheme = [
            'rgb(221,221,221)', // 0 Light Gray
            'rgb(46,37,133)',   // 1 Dark Blue
            'rgb(51,117,56)',   // 2 Green
            'rgb(93,168,153)',  // 3 Teal
            'rgb(148,203,236)', // 4 Light Blue
            'rgb(220,205,125)', // 5 Yellow
            'rgb(194,106,119)', // 6 Red
            'rgb(159,74,150)',  // 7 Purple
            'rgb(126,41,84)'    // 8 Dark Maroon
        ];
    }

    /**
     * Get legend data based on the selected color set
     * @param {string} colorsetUI - The type of colorset ('type', 'nt', etc.)
     * @returns {Array} - Array of legend items with label, color, and shape
     */
    getLegendData(colorsetUI) {
        const legendMappings = {
            type: [
                { label: "Sensory neuron", color: this.colorScheme[2], shape: "circle" },
                { label: "Interneuron", color: this.colorScheme[4], shape: "circle" },
                { label: "Motor neuron", color: this.colorScheme[8], shape: "circle" },
                { label: "Modulatory", color: this.colorScheme[5], shape: "circle" },
                { label: "Muscle", color: "rgb(75,75,75)", shape: "square" },
                { label: "Others", color: "rgb(210,210,210)", shape: "square" }
            ],
            nt: [
                { label: "Acetylcholine", color: this.colorScheme[5], shape: "circle" },
                { label: "GABA", color: this.colorScheme[1], shape: "circle" },
                { label: "Glutamate", color: this.colorScheme[2], shape: "circle" },
                { label: "Dopamine", color: this.colorScheme[4], shape: "circle" },
                { label: "Octopamine", color: this.colorScheme[3], shape: "circle" },
                { label: "Serotonin", color: this.colorScheme[7], shape: "circle" },
                { label: "Tyramine", color: this.colorScheme[8], shape: "circle" },
                { label: "Unknown", color: "rgb(210,210,210)", shape: "circle" },
                { label: "Non-neuron", color: "rgb(75,75,75)", shape: "square" }
            ],
            gcamp: [
                { label: "In plot", color: this.colorScheme[4], shape: "circle" },
                { label: "Available", color: this.colorScheme[5], shape: "circle" },
                { label: "Not labeled", color: this.colorScheme[0], shape: "circle" },
        ]
        };

        return legendMappings[colorsetUI] || [];
    }

    /**
     * Render the legend items dynamically
     * @param {Array} legendData - Array of legend items
     */
    renderLegend(legendData) {
        if (!this.legendContainer || !this.legendItemsContainer) {
            console.warn("Legend containers not available. Rendering skipped.");
            return;
        }

        // Display the legend container
        this.legendContainer.style.display = "block";

        // Clear previous legend items
        this.legendItemsContainer.innerHTML = '';

        // Render each legend item
        legendData.forEach(item => {
            const legendItem = document.createElement('div');
            legendItem.className = 'legend-item';

            // Create color box with dynamic shape
            const colorBox = document.createElement('div');
            colorBox.className = 'legend-color';
            colorBox.style.background = item.color;
            colorBox.style.borderRadius = item.shape === 'circle' ? '50%' : '0';

            // Add label text
            const label = document.createElement('span');
            label.textContent = item.label;

            // Append elements
            legendItem.appendChild(colorBox);
            legendItem.appendChild(label);
            this.legendItemsContainer.appendChild(legendItem);
        });
    }
}