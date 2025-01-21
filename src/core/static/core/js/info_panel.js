export class InfoPanel {
    constructor(connectomeGraph) {
        this.connectomeGraph = connectomeGraph;
        this.injectInfoPanelHTML()
    }

    injectInfoPanelHTML(id="info-panel", targetElement=null) {
        const infoPanelHTML = `<div id=${id} class="info-panel position-fixed start-0 top-0 h-100 bg-white shadow"
            style="width: 300px; transform: translateX(-100%); transition: transform 0.3s ease;">
            <div class="p-3 border-bottom d-flex justify-content-between align-items-center">
                <h5 class="m-0" id="panel-title">Information</h5>
                <button type="button" class="btn-close" aria-label="Close"></button>
            </div>
            <div class="p-3" id="info-panel-content"></div>
        </div>`
        
        if (targetElement) {
            targetElement.insertAdjacentHTML('beforeend', infoPanelHTML);
        } else {
            document.body.insertAdjacentHTML("beforeend", infoPanelHTML);
        }

        document.getElementById(id).offsetWidth; // reflow

        this.infoPanel = document.getElementById("info-panel");
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