export class InfoPanel {
    constructor(connectomeGraph) {
        this.connectomeGraph = connectomeGraph;
        this.infoPanel = document.querySelector('.info-panel');
        this.infoPanel.style.zIndex = '1000';
        this.infoPanel.style.overflowY = 'auto';

        // Close button event listener
        this.closeButton = this.infoPanel.querySelector('.btn-close');
        this.closeButton.addEventListener('click', () => this.hidePanel());
    }

    // Show panel
    showPanel() {
        // Translate to 0 to show from the left
        this.infoPanel.style.transform = 'translateX(0)';
    }
    
    // Hide panel
    hidePanel() {
        // Translate -100% to hide back to the left
        this.infoPanel.style.transform = 'translateX(-100%)';
    }
}