//
// localStorage
//
export function getLocalJSON(key, fallback=null) {
    const item = localStorage.getItem(key)
    if (item === null) {
        return fallback === null ? null : fallback;
    }
    else {
        return JSON.parse(item)
    }
}

export function setLocalJSON(key, data) {
    localStorage.setItem(key, JSON.stringify(data))
}

export function getLocalStr(key, fallback=null) {
    const str = localStorage.getItem(key)
    if (str === null) {
        return fallback === null ? null : fallback;
    }
    else {
        return str
    }
}

export function setLocalStr(key, str) {
    localStorage.setItem(key, str)
}

export function setLocalBool(key, boolean) {
    localStorage.setItem(key, boolean ? "true" : "false")
}

export function getLocalBool(key, fallback=null) {
    const value = localStorage.getItem(key);

    // Return fallback if the key doesn't exist
    if (value === null) {
        return fallback;
    }

    // Parse and return the boolean value
    return parseBoolStr(value);
}

function parseBoolStr(str) {
    return str === "true" ? true : str === "false" ? false : null;
}

export function getLocalInt(key, fallback=null) {
    const str = localStorage.getItem(key)
    if (str === null) {
        return fallback === null ? null : fallback;
    }
    else {
        return parseInt(str)
    }
}

export function setLocalInt(key, str) {
    localStorage.setItem(key, str.toString())
}

export function getLocalFloat(key, fallback=null) {
    const str = localStorage.getItem(key)
    if (str === null) {
        return fallback === null ? null : fallback;
    }
    else {
        return parseFloat(str)
    }
}

export function setLocalFloat(key, str) {
    localStorage.setItem(key, str.toString())
}

//
// function utility
//
// Debounce function to delay execution (delay in ms)
export function debounce(func, delay) {
    let timeout;
    return function (...args) {
        clearTimeout(timeout); // Clear the previous timeout
        timeout = setTimeout(() => {
            func.apply(this, args); // Execute the function after the delay
        }, delay);
    };
}

//
// api
//
export function getCSRFToken() {
    // const meta = document.querySelector('meta[name="csrf-token"]');
    // return meta ? meta.getAttribute('content') : '';

    const cookieValue = document.cookie
        .split('; ')
        .find(row => row.startsWith('csrftoken='))
        ?.split('=')[1];
    return cookieValue || '';
}

//
// swicth
//
export function initSwitch(elementId, actionOn, actionOff, stateTarget, localStorageKey, defaultState) {
    const switchElement = document.getElementById(elementId);
    switchElement.checked = getLocalBool(localStorageKey, defaultState)

    switchElement.addEventListener('change', (event) => {
        if (event.target.checked) {
            // Action when the switch is turned on
            setLocalBool(localStorageKey, true)
            stateTarget.value = true
            actionOn()
        } else {
            // Action when the switch is turned off
            setLocalBool(localStorageKey, false)
            stateTarget.value = false
            actionOff()
        }
    });
}

//
// slider
//
export function initSlider(sliderId, stateTarget, localStorageKey, fallback, callback) {
    const slider = document.getElementById(sliderId);
    slider.value = getLocalFloat(localStorageKey, fallback)
    slider.addEventListener("input", (e) => {
        const value = e.target.value;
        if (stateTarget !== null) {
            stateTarget.value = value
        }
        setLocalFloat(localStorageKey, value);
        callback(value)
    });

    return slider.value
}

//
// dropdown
//
export function initDropdown(dropdownId, callback, changeText, initialValue=null) {
    // Find the dropdown menu using the `aria-labelledby` attribute
    const dropdownMenu = document.querySelector(
        `.dropdown-menu[aria-labelledby="${dropdownId}"]`
    );

    if (!dropdownMenu) {
        console.error(`Dropdown menu associated with ID '${dropdownId}' not found.`);
        return null;
    }

    // Select all dropdown items within the dropdown menu
    const dropdownItems = dropdownMenu.querySelectorAll('.dropdown-item');
    const dropdownButton = dropdownMenu.closest(".dropdown").querySelector(".dropdown-toggle");

    // Set the initial selection if provided
    if (initialValue !== null) {
        const initialItem = Array.from(dropdownItems).find(
            (item) => item.dataset.value === initialValue
        );

        if (initialItem) {
            // Update the active class
            dropdownItems.forEach((i) => i.classList.remove("active"));
            initialItem.classList.add("active");

            // Update the dropdown button text
            if (changeText) {
                dropdownButton.textContent = initialItem.textContent.trim();
            }
        } else {
            console.warn(`No dropdown item found with value '${initialValue}'.`);
        }
    }

    // Add event listeners to each dropdown item
    dropdownItems.forEach((item) => {
        item.addEventListener("click", (event) => {
            event.preventDefault(); // Prevent default behavior

            const selectedValue = item.dataset.value;

            // Handle active class
            dropdownItems.forEach((i) => i.classList.remove("active"));
            if (selectedValue !== "custom") {
                item.classList.add("active");
            }

            // Update dropdown button text if enabled
            if (changeText) {
                dropdownButton.textContent = item.textContent.trim();
            }

            // Call the callback function with the selected value
            if (typeof callback === "function") {
                callback(selectedValue);
            }
        });
    });
}

//
// color
//

/**
 * Parse RGB(A) color string into an object {r, g, b}.
 * @param {String} color - CSS color string (e.g., 'rgb(0,0,0)' or 'rgba(0,0,0,1)')
 * @returns {Object|null} Parsed RGB values {r, g, b}
 */
export function parseRGB(color) {
    const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (match) {
        return {
            r: parseInt(match[1], 10),
            g: parseInt(match[2], 10),
            b: parseInt(match[3], 10),
        };
    }
    return null;
}

/**
 * Calculate the relative luminance of a color.
 * @param {Number} r - Red value (0-255)
 * @param {Number} g - Green value (0-255)
 * @param {Number} b - Blue value (0-255)
 * @returns {Number} Luminance value (0 to 1)
 */
export function calculateLuminance(r, g, b) {
    const toLinear = (value) => {
        const v = value / 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };

    const rLinear = toLinear(r);
    const gLinear = toLinear(g);
    const bLinear = toLinear(b);

    return 0.2126 * rLinear + 0.7152 * gLinear + 0.0722 * bLinear;
}

//
// math
//
export function sumArray(array) {
    return array.reduce((accumulator, currentValue) => accumulator + currentValue, 0);
}

export function minArray(x) {
    return x.reduce((accumulator, currentValue) => Math.min(accumulator, currentValue))
}

export function maxArray(x) {
    return x.reduce((accumulator, currentValue) => Math.max(accumulator, currentValue))
}

export function roundNull(x, n) {
    if (x == null) {
        return null
    } else {
        return x.toFixed(n)
    }
}

//
// node style
//
export function isNodeRectangle(node) {
    return ['b','u'].includes(node.data('cell_type'))
}

//
// array
//
export function removeFromList(list, element) {
    let index = list.findIndex(e => e === element);

    if (index !== -1) {
        list.splice(index, 1);
    }
}


export function getDatasetTypePill(datasettype) {
    let color;
    let type_str;
    switch (datasettype) {
        case "baseline":
            type_str = "Baseline";
            color = "secondary";
            break;
        case "neuropal":
            type_str = "NeuroPAL";
            color = "primary";
            break;
        case "gfp":
            type_str = "GFP"
            color = "success";
            break;
        case "heat":
            type_str = "Heat"
            color = "danger";
            break;
        case "patchEncounter":
            type_str = "Patch"
            color = "info";
            break;
        case "reFed":
            type_str = "Re-fed"
            color = "light";
            break;
        case "sickness":
            type_str = "Sickness"
            color = "dark";
            break;
        default:
            color = "text-bg-danger";
    }
    
    return '<span class="badge rounded-pill text-bg-' + color + ` dtype="${datasettype}">` +
        type_str + '</span>'
}

export function toggleFullscreen(element) {
    // if not in full screen
    if (!document.fullscreenElement) {
      element.requestFullscreen().catch((err) => {
        console.error(`Error attempting to enable fullscreen: ${err.message}`);
      });
    } else {
      // exit full screen
      document.exitFullscreen();
    }
}

export function toggleFullscreenLabelText(label, textFullscreen = "Fullscreen", textExit = "Exit") {
    // Switches label between "Fullscreen" and "Exit"
    label.textContent = (label.textContent === textFullscreen) ? textExit : textFullscreen;
}

export function toggleFullscreenIcons(icon) {
    // Toggles between two Bootstrap icon classes
    icon.classList.toggle("bi-fullscreen");
    icon.classList.toggle("bi-fullscreen-exit");
}

export function handleFullscreenElement(fullscreenMap, elementId) {
    const entry = fullscreenMap[elementId];
    if (!entry) return; // if the element isn't in our map, do nothing
    
    // Toggle the icon class (bi-fullscreen <-> bi-fullscreen-exit)
    toggleFullscreenIcons(entry.icon);
    // Toggle label text (e.g. "Fullscreen" <-> "Exit")
    toggleFullscreenLabelText(entry.label);
  
    // If there's a custom callback (like adjusting width), call it
    if (typeof entry.onToggle === "function") {
      entry.onToggle();
    }
}
