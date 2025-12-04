/**
 * Main application entry point
 */

import { DEBOUNCE_DELAY } from './config/constants.js';
import { SettingsManager } from './state/settings.js';
import { createExtractionState, clearExtractions, buildLineExtractionMap } from './state/extraction-state.js';
import { processAllWindows } from './services/extraction-processor.js';
import { renderTextDisplay, addWindowHoverListeners, renderStats } from './components/text-display.js';
import { renderMarkersOverlay, addMarkerHoverListeners } from './components/markers.js';
import { renderExtractionCard, renderErrorCard, collapseAllCards } from './components/extraction-cards.js';
import { updateProgress, updateProgressDetails, showProgress } from './components/progress.js';
import { switchTab, switchToReadOnlyMode, switchToEditMode, clearDisplays, syncScroll } from './ui/tabs.js';

// DOM elements
const elements = {};

// State
let state = createExtractionState();
let settingsManager;
let debounceTimer = null;

// UI update batching for performance
let pendingUIUpdate = null;
let pendingExtractions = [];

/**
 * Initialize the application
 */
function init() {
    // Main UI elements
    elements.inputTextarea = document.getElementById('bibliography-input');
    elements.markersDisplay = document.getElementById('markers-display');
    elements.textDisplay = document.getElementById('text-display');
    elements.extractionsDisplay = document.getElementById('extractions-display');
    elements.editInputBtn = document.getElementById('edit-input-btn');
    elements.extractionCountSpan = document.getElementById('extraction-count');
    elements.filterSelect = document.getElementById('filter-select');
    elements.statsPie = document.getElementById('stats-pie');
    elements.collapseAllBtn = document.getElementById('collapse-all-btn');
    elements.windowSizeInput = document.getElementById('window-size');
    elements.overlapInput = document.getElementById('overlap-size');
    elements.statsDisplay = document.getElementById('stats-display');

    // Tab elements
    elements.windowsTabContent = document.getElementById('windows-tab-content');
    elements.extractionsTabContent = document.getElementById('extractions-tab-content');
    elements.panelTabs = document.querySelectorAll('.panel-tab');

    // Settings modal elements
    elements.settingsModal = document.getElementById('settings-modal');
    elements.llmProviderSelect = document.getElementById('llm-provider');
    elements.llmEndpointInput = document.getElementById('llm-endpoint');
    elements.llmApiKeyInput = document.getElementById('llm-api-key');
    elements.llmModelSelect = document.getElementById('llm-model');
    elements.extractionPromptTextarea = document.getElementById('extraction-prompt');
    elements.userEmailInput = document.getElementById('user-email');
    elements.maxLLMRPMInput = document.getElementById('max-llm-rpm');
    elements.maxValidationRPMInput = document.getElementById('max-validation-rpm');

    // Processing elements
    elements.processBtn = document.getElementById('process-btn');
    elements.progressContainer = document.getElementById('progress-container');
    elements.progressText = document.getElementById('progress-text');
    elements.progressFill = document.getElementById('progress-fill');
    elements.progressDetails = document.getElementById('progress-details');

    // Initialize settings manager
    settingsManager = new SettingsManager(elements);
    settingsManager.init();
    settingsManager.onSettingsChange = () => processText();

    // Bind events
    bindEvents();

    // Initial render
    updateOutput();
}

/**
 * Bind all event handlers
 */
function bindEvents() {
    // Main input events
    elements.inputTextarea.addEventListener('input', handleInput);
    elements.inputTextarea.addEventListener('paste', handlePaste);
    elements.inputTextarea.addEventListener('scroll', () => {
        syncScroll(elements.inputTextarea, elements.textDisplay);
    });
    elements.windowSizeInput.addEventListener('input', processText);
    elements.overlapInput.addEventListener('input', processText);

    document.getElementById('clear-btn').addEventListener('click', handleClear);

    // Edit button
    elements.editInputBtn.addEventListener('click', () => {
        switchToEditMode(elements, () => {
            clearExtractions(state);
            clearDisplays(elements);
        });
        updateOutput();
    });

    // Tab switching
    elements.panelTabs.forEach(tab => {
        tab.addEventListener('click', () => switchTab(tab.dataset.tab, elements));
    });

    // Processing events
    elements.processBtn.addEventListener('click', startProcessing);
    document.getElementById('cancel-btn').addEventListener('click', () => {
        state.shouldCancel = true;
    });
    elements.filterSelect.addEventListener('change', applyFilter);
    elements.collapseAllBtn.addEventListener('click', () => {
        collapseAllCards(elements.extractionsDisplay);
    });

    // Settings modal events
    document.getElementById('settings-btn').addEventListener('click', openSettingsModal);
    document.getElementById('settings-close').addEventListener('click', closeSettingsModal);
    document.getElementById('settings-save').addEventListener('click', saveSettings);
    document.getElementById('reset-prompt-btn').addEventListener('click', () => {
        settingsManager.resetPrompt();
    });
    document.getElementById('refresh-models-btn').addEventListener('click', handleFetchModels);

    // Close modal on overlay click
    elements.settingsModal.addEventListener('click', (e) => {
        if (e.target === elements.settingsModal) {
            closeSettingsModal();
        }
    });

    // Close modal on Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && elements.settingsModal.classList.contains('active')) {
            closeSettingsModal();
        }
    });

    // Expandable settings cards
    document.querySelectorAll('.settings-card-header').forEach(header => {
        header.addEventListener('click', () => {
            const card = header.closest('.settings-card');
            card.classList.toggle('expanded');
        });
    });

    // Collapsible explanation sections
    document.querySelectorAll('.collapsible-header').forEach(header => {
        header.addEventListener('click', () => {
            const collapsible = header.closest('.collapsible-explanation');
            collapsible.classList.toggle('expanded');
        });
    });

    // Provider choice options
    document.querySelectorAll('.provider-option').forEach(option => {
        option.addEventListener('click', () => {
            const provider = option.dataset.provider;
            selectProvider(provider);
        });
    });

    // Settings tabs
    document.querySelectorAll('.settings-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const targetTab = tab.dataset.settingsTab;

            // Update active tab button
            document.querySelectorAll('.settings-tab').forEach(t => {
                t.classList.toggle('active', t.dataset.settingsTab === targetTab);
            });

            // Update active tab content
            document.querySelectorAll('.settings-tab-content').forEach(content => {
                content.classList.toggle('active', content.dataset.settingsContent === targetTab);
            });
        });
    });

    // Initialize provider UI based on current settings
    initProviderUI();
}

function handleInput() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(processText, DEBOUNCE_DELAY);
}

function handlePaste() {
    setTimeout(processText, 0);
}

function processText() {
    const text = elements.inputTextarea.value;
    const windowSize = parseInt(elements.windowSizeInput.value) || 2000;
    const overlap = parseInt(elements.overlapInput.value) || 200;

    if (!text.trim()) {
        state.currentWindows = [];
        updateOutput();
        return;
    }

    state.currentWindows = window.Windowing.createWindows(text, windowSize, overlap);
    updateOutput();
}

function updateOutput() {
    const text = elements.inputTextarea.value;

    renderTextDisplay(elements.textDisplay, text, state.currentWindows);
    renderStats(elements.statsDisplay, text, state.currentWindows);
    addWindowHoverListeners(elements.textDisplay);

    // Update process button state
    const canProcess = state.currentWindows.length > 0 && settingsManager.isLLMConfigured();
    elements.processBtn.disabled = !canProcess;
}

function handleClear() {
    elements.inputTextarea.value = '';
    state.currentWindows = [];
    switchToEditMode(elements, () => {
        clearExtractions(state);
        clearDisplays(elements);
    });
    updateOutput();
    // Reset filter and hide pie chart when clearing
    elements.filterSelect.value = 'all';
    elements.statsPie.classList.remove('visible');
    elements.statsPie.innerHTML = '';
}

/**
 * Apply filter to show verified/unverified extractions
 * Optimized with pre-computed verified/unverified ID sets
 */
function applyFilter() {
    const filterValue = elements.filterSelect.value;

    // Pre-compute verified extraction IDs for fast lookup
    const verifiedIds = new Set();
    const unverifiedIds = new Set();
    for (const [id, extraction] of state.extractionMap) {
        if (extraction.validationStatus === 'valid') {
            verifiedIds.add(id);
        } else {
            unverifiedIds.add(id);
        }
    }

    // Filter extraction cards
    const cards = elements.extractionsDisplay.querySelectorAll('.extraction-card');
    cards.forEach(card => {
        const extractionId = card.dataset.extractionId;
        const isVerified = verifiedIds.has(extractionId);

        if (filterValue === 'all') {
            card.classList.remove('filter-hidden');
        } else if (filterValue === 'verified') {
            card.classList.toggle('filter-hidden', !isVerified);
        } else if (filterValue === 'unverified') {
            card.classList.toggle('filter-hidden', isVerified);
        }
    });

    // Filter marked lines in text preview
    const markedLines = elements.markersDisplay.querySelectorAll('.marked-line');
    markedLines.forEach(line => {
        const extractionIdsAttr = line.dataset.extractionIds;

        if (filterValue === 'all') {
            line.classList.remove('filter-hidden');
        } else if (!extractionIdsAttr || !extractionIdsAttr.trim()) {
            // Lines with no extractions - hide for both verified/unverified filters
            line.classList.add('filter-hidden');
        } else {
            const ids = extractionIdsAttr.split(' ');
            let hasVerified = false;
            let hasUnverified = false;

            for (const id of ids) {
                if (!id) continue;
                if (verifiedIds.has(id)) hasVerified = true;
                if (unverifiedIds.has(id)) hasUnverified = true;
                // Early exit if we found both
                if (hasVerified && hasUnverified) break;
            }

            if (filterValue === 'verified') {
                line.classList.toggle('filter-hidden', !hasVerified);
            } else if (filterValue === 'unverified') {
                line.classList.toggle('filter-hidden', !hasUnverified);
            }
        }
    });

    // Update legend active states
    updatePieLegendState();
}

/**
 * Update pie chart statistics
 */
function updatePieChart() {
    if (state.extractions.length === 0) {
        elements.statsPie.classList.remove('visible');
        return;
    }

    const verified = state.extractions.filter(e => e.validationStatus === 'valid').length;
    const unverified = state.extractions.length - verified;
    const total = state.extractions.length;

    // Calculate pie segments (as percentages)
    const verifiedPct = total > 0 ? (verified / total) * 100 : 0;
    const unverifiedPct = total > 0 ? (unverified / total) * 100 : 0;

    // Create SVG pie chart using stroke-dasharray technique
    const circumference = 2 * Math.PI * 8; // radius = 8
    const verifiedDash = (verifiedPct / 100) * circumference;
    const unverifiedDash = (unverifiedPct / 100) * circumference;

    let pieHtml = `
        <svg viewBox="0 0 20 20">
            <circle cx="10" cy="10" r="8" fill="none" stroke="#e2e8f0" stroke-width="4"/>
    `;

    // Only draw segments if there's data
    if (verified > 0) {
        pieHtml += `
            <circle class="pie-segment" data-filter="verified" cx="10" cy="10" r="8" fill="none"
                stroke="#10b981" stroke-width="4"
                stroke-dasharray="${verifiedDash} ${circumference}"
                stroke-dashoffset="0"
                transform="rotate(-90 10 10)"/>
        `;
    }
    if (unverified > 0) {
        pieHtml += `
            <circle class="pie-segment" data-filter="unverified" cx="10" cy="10" r="8" fill="none"
                stroke="#ef4444" stroke-width="4"
                stroke-dasharray="${unverifiedDash} ${circumference}"
                stroke-dashoffset="${-verifiedDash}"
                transform="rotate(-90 10 10)"/>
        `;
    }

    pieHtml += `</svg>`;

    // Add legend with counts
    pieHtml += `
        <div class="pie-legend">
            <span class="legend-item" data-filter="verified" title="Show verified only">
                <span class="legend-dot verified"></span>
                <span>${verified}</span>
            </span>
            <span class="legend-item" data-filter="unverified" title="Show unverified only">
                <span class="legend-dot unverified"></span>
                <span>${unverified}</span>
            </span>
        </div>
    `;

    elements.statsPie.innerHTML = pieHtml;
    elements.statsPie.classList.add('visible');

    // Add click listeners to pie segments and legend items
    elements.statsPie.querySelectorAll('[data-filter]').forEach(el => {
        el.addEventListener('click', (e) => {
            const filter = e.currentTarget.dataset.filter;
            const currentFilter = elements.filterSelect.value;

            // Toggle: if already on this filter, go back to all
            if (currentFilter === filter) {
                elements.filterSelect.value = 'all';
            } else {
                elements.filterSelect.value = filter;
            }
            applyFilter();
        });
    });

    updatePieLegendState();
}

/**
 * Update pie legend active states based on current filter
 */
function updatePieLegendState() {
    const filterValue = elements.filterSelect.value;
    elements.statsPie.querySelectorAll('.legend-item').forEach(item => {
        item.classList.toggle('active', item.dataset.filter === filterValue);
    });
}

/**
 * Reorder extraction cards by their position in the input text
 */
function reorderCardsByTextPosition() {
    const cards = Array.from(elements.extractionsDisplay.querySelectorAll('.extraction-card[data-extraction-id]'));
    if (cards.length === 0) return;

    // Sort cards by absoluteLineStart, falling back to window start position
    cards.sort((a, b) => {
        const extractionA = state.extractionMap.get(a.dataset.extractionId);
        const extractionB = state.extractionMap.get(b.dataset.extractionId);

        // Use absoluteLineStart if available, otherwise use window start position
        const posA = extractionA?.absoluteLineStart
            ?? (state.currentWindows[extractionA?.windowIndex - 1]?.start ?? Infinity);
        const posB = extractionB?.absoluteLineStart
            ?? (state.currentWindows[extractionB?.windowIndex - 1]?.start ?? Infinity);

        return posA - posB;
    });

    // Re-append cards in sorted order
    const fragment = document.createDocumentFragment();
    cards.forEach(card => fragment.appendChild(card));
    elements.extractionsDisplay.appendChild(fragment);
}

/**
 * Schedule a batched UI update for better performance
 * Collects multiple extraction updates and renders them together
 */
function scheduleBatchedUIUpdate(text) {
    if (pendingUIUpdate) return; // Already scheduled

    pendingUIUpdate = requestAnimationFrame(() => {
        if (pendingExtractions.length > 0) {
            // Render all pending extraction cards
            const fragment = document.createDocumentFragment();
            for (const extraction of pendingExtractions) {
                const card = renderExtractionCard(extraction, state, elements.markersDisplay, elements.extractionsDisplay);
                fragment.appendChild(card);
            }
            elements.extractionsDisplay.appendChild(fragment);
            pendingExtractions = [];
        }

        // Build line map once for all new extractions
        buildLineExtractionMap(state, text);

        // Single render pass for markers
        renderMarkersOverlay(elements.markersDisplay, text, state);
        addMarkerHoverListeners(elements.markersDisplay, elements.extractionsDisplay, {});
        updatePieChart();
        applyFilter();

        pendingUIUpdate = null;
    });
}

// Provider selection UI
function selectProvider(provider, triggerChange = true) {
    // Update visual selection
    document.querySelectorAll('.provider-option').forEach(opt => {
        opt.classList.toggle('selected', opt.dataset.provider === provider);
    });

    // Update hidden select
    elements.llmProviderSelect.value = provider;

    // Show/hide appropriate setup guide
    const googleGuide = document.getElementById('google-setup-guide');
    const openaiGuide = document.getElementById('openai-setup-guide');

    if (provider === 'google') {
        googleGuide.style.display = '';
        openaiGuide.style.display = 'none';
    } else {
        googleGuide.style.display = 'none';
        openaiGuide.style.display = '';
    }

    // Trigger provider change in settings manager (only when user changes provider)
    if (triggerChange) {
        settingsManager.handleProviderChange();
    }
}

function initProviderUI() {
    const currentProvider = settingsManager.getSettings().llmProvider || 'google';
    selectProvider(currentProvider, false);  // Don't trigger change handler during init
}

// Settings modal functions
function openSettingsModal() {
    settingsManager.syncToModal();
    initProviderUI();
    elements.settingsModal.classList.add('active');
}

function closeSettingsModal() {
    elements.settingsModal.classList.remove('active');
}

function saveSettings() {
    settingsManager.save();
    closeSettingsModal();
}

async function handleFetchModels() {
    const refreshBtn = document.getElementById('refresh-models-btn');
    const originalText = refreshBtn.textContent;
    refreshBtn.textContent = 'Loading...';
    refreshBtn.disabled = true;

    try {
        await settingsManager.fetchModels();
    } catch (error) {
        console.error('Failed to fetch models:', error);
        alert('Failed to fetch models: ' + error.message);
    } finally {
        refreshBtn.textContent = originalText;
        refreshBtn.disabled = false;
    }
}

// Processing
async function startProcessing() {
    if (state.isProcessing) return;

    const settings = settingsManager.getSettings();

    if (!settingsManager.isLLMConfigured()) {
        alert('Please configure LLM settings (endpoint, API key, and model) before processing.');
        openSettingsModal();
        return;
    }

    if (state.currentWindows.length === 0) {
        alert('No windows to process. Please enter bibliography text first.');
        return;
    }

    state.isProcessing = true;
    state.shouldCancel = false;
    clearExtractions(state);

    showProgress(elements);
    elements.extractionsDisplay.innerHTML = '';
    elements.processBtn.disabled = true;

    const text = elements.inputTextarea.value;
    renderMarkersOverlay(elements.markersDisplay, text, state);
    switchToReadOnlyMode(elements);

    const totalWindows = state.currentWindows.length;

    // Reset batching state
    pendingExtractions = [];
    pendingUIUpdate = null;

    const result = await processAllWindows({
        state,
        settings,
        fullText: text,
        onProgress: (message) => {
            updateProgressDetails(elements, message);
        },
        onWindowStart: (index, total) => {
            updateProgress(elements, index, total, `Processing window ${index + 1} of ${total}...`);
        },
        onExtractionComplete: (extraction) => {
            // Batch extractions and schedule a single UI update
            pendingExtractions.push(extraction);
            scheduleBatchedUIUpdate(text);
        },
        onError: (windowIndex, errorMessage, extraction) => {
            renderErrorCard(elements.extractionsDisplay, windowIndex, errorMessage);
            scheduleBatchedUIUpdate(text);
        }
    });

    // Cancel any pending batched update and do final render
    if (pendingUIUpdate) {
        cancelAnimationFrame(pendingUIUpdate);
        pendingUIUpdate = null;
    }

    // Final update - single rebuild of line map and markers
    // This must happen BEFORE rendering remaining cards so we know which extractions survived deduplication
    buildLineExtractionMap(state, text);

    // Render any remaining pending extractions (only those that survived deduplication)
    if (pendingExtractions.length > 0) {
        const fragment = document.createDocumentFragment();
        for (const extraction of pendingExtractions) {
            // Skip extractions that were removed by deduplication
            if (!state.extractionMap.has(extraction.id)) continue;
            const card = renderExtractionCard(extraction, state, elements.markersDisplay, elements.extractionsDisplay);
            fragment.appendChild(card);
        }
        elements.extractionsDisplay.appendChild(fragment);
        pendingExtractions = [];
    }

    // Remove orphaned cards (extractions removed by deduplication)
    const allCards = elements.extractionsDisplay.querySelectorAll('.extraction-card[data-extraction-id]');
    allCards.forEach(card => {
        if (!state.extractionMap.has(card.dataset.extractionId)) {
            card.remove();
        }
    });

    // Reorder cards by occurrence in input text
    reorderCardsByTextPosition();
    renderMarkersOverlay(elements.markersDisplay, text, state);
    addMarkerHoverListeners(elements.markersDisplay, elements.extractionsDisplay, {});
    updatePieChart();
    applyFilter();

    elements.extractionCountSpan.textContent = `${state.extractions.length} extraction${state.extractions.length !== 1 ? 's' : ''}`;

    state.isProcessing = false;
    elements.processBtn.disabled = false;

    if (result.cancelled) {
        updateProgress(elements, 0, 1, 'Processing cancelled');
    } else {
        updateProgress(elements, totalWindows, totalWindows, `Completed - ${state.extractions.length} citations extracted`);
    }

    updateProgressDetails(elements, '');
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
