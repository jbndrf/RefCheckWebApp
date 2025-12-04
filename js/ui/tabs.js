/**
 * Tab and mode switching UI
 */

/**
 * Switch to a specific tab
 */
export function switchTab(tabName, elements) {
    const { panelTabs, windowsTabContent, extractionsTabContent } = elements;

    panelTabs.forEach(tab => {
        if (tab.dataset.tab === tabName) {
            tab.classList.add('active');
        } else {
            tab.classList.remove('active');
        }
    });

    if (tabName === 'windows') {
        windowsTabContent.classList.add('active');
        extractionsTabContent.classList.remove('active');
    } else {
        windowsTabContent.classList.remove('active');
        extractionsTabContent.classList.add('active');
    }
}

/**
 * Switch to read-only mode (after processing)
 */
export function switchToReadOnlyMode(elements) {
    const { inputTextarea, markersDisplay, editInputBtn, collapseAllBtn } = elements;

    inputTextarea.classList.add('hidden');
    markersDisplay.classList.add('visible');
    editInputBtn.style.display = 'inline-block';
    collapseAllBtn.disabled = false;

    switchTab('extractions', elements);
}

/**
 * Switch to edit mode
 */
export function switchToEditMode(elements, onClear) {
    const { inputTextarea, markersDisplay, editInputBtn, collapseAllBtn } = elements;

    markersDisplay.classList.remove('visible');
    inputTextarea.classList.remove('hidden');
    editInputBtn.style.display = 'none';
    collapseAllBtn.disabled = true;

    if (onClear) {
        onClear();
    }

    switchTab('windows', elements);
    inputTextarea.focus();
}

/**
 * Clear display placeholders
 */
export function clearDisplays(elements) {
    elements.extractionsDisplay.innerHTML = '<span class="placeholder">Extractions will appear here after processing...</span>';
    elements.markersDisplay.innerHTML = '<span class="placeholder">Processed text with markers will appear here...</span>';
    elements.extractionCountSpan.textContent = '';
}

/**
 * Sync scroll between textarea and display
 */
export function syncScroll(inputTextarea, textDisplay) {
    textDisplay.scrollTop = inputTextarea.scrollTop;
    textDisplay.scrollLeft = inputTextarea.scrollLeft;
}
