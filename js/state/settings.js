/**
 * Settings state management
 */

import { DEFAULT_PROMPT } from '../config/prompt.js';
import { DEFAULT_ENDPOINTS } from '../config/constants.js';
import { fetchModels, getDefaultEndpoint } from '../api/llm-client.js';

const STORAGE_KEY = 'refcheckwebapp_settings';

/**
 * Create default settings object
 */
function createDefaultSettings() {
    return {
        windowSize: 2000,
        overlap: 200,
        userEmail: '',
        llmProvider: 'google',
        llmEndpoint: '',
        llmApiKey: '',
        llmModel: '',
        extractionPrompt: DEFAULT_PROMPT,
        maxLLMRPM: 15,
        maxValidationRPM: 50
    };
}

/**
 * Load settings from localStorage
 */
export function loadSettings() {
    const settings = createDefaultSettings();
    const saved = localStorage.getItem(STORAGE_KEY);

    if (saved) {
        try {
            const parsed = JSON.parse(saved);
            Object.assign(settings, parsed);
        } catch (e) {
            console.error('Failed to parse saved settings:', e);
        }
    }

    return settings;
}

/**
 * Save settings to localStorage
 */
export function saveSettings(settings) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

/**
 * Get default prompt
 */
export function getDefaultPrompt() {
    return DEFAULT_PROMPT;
}

/**
 * Settings manager class for UI integration
 */
export class SettingsManager {
    constructor(elements) {
        this.elements = elements;
        this.settings = loadSettings();
        this.onSettingsChange = null;
    }

    /**
     * Initialize settings UI
     */
    init() {
        this.applyToUI();
        this.bindEvents();
    }

    /**
     * Apply current settings to UI elements
     */
    applyToUI() {
        const {
            windowSizeInput, overlapInput, userEmailInput,
            llmProviderSelect, llmEndpointInput, llmApiKeyInput,
            llmModelSelect, extractionPromptTextarea,
            maxLLMRPMInput, maxValidationRPMInput
        } = this.elements;

        windowSizeInput.value = this.settings.windowSize;
        overlapInput.value = this.settings.overlap;
        userEmailInput.value = this.settings.userEmail;
        llmProviderSelect.value = this.settings.llmProvider;
        llmEndpointInput.value = this.settings.llmEndpoint;
        llmApiKeyInput.value = this.settings.llmApiKey;
        extractionPromptTextarea.value = this.settings.extractionPrompt;

        if (maxLLMRPMInput) {
            maxLLMRPMInput.value = this.settings.maxLLMRPM;
        }
        if (maxValidationRPMInput) {
            maxValidationRPMInput.value = this.settings.maxValidationRPM;
        }

        this.updateEndpointPlaceholder();

        // Reset model select and restore saved model if available
        llmModelSelect.innerHTML = '<option value="">-- Select a model --</option>';
        if (this.settings.llmModel) {
            const option = document.createElement('option');
            option.value = this.settings.llmModel;
            option.textContent = this.settings.llmModel;
            option.selected = true;
            llmModelSelect.appendChild(option);
        }
    }

    /**
     * Bind event handlers
     */
    bindEvents() {
        const { llmProviderSelect } = this.elements;
        llmProviderSelect.addEventListener('change', () => this.handleProviderChange());
    }

    /**
     * Handle LLM provider change
     */
    handleProviderChange() {
        const { llmProviderSelect, llmEndpointInput, llmModelSelect } = this.elements;
        const provider = llmProviderSelect.value;

        llmEndpointInput.value = getDefaultEndpoint(provider);
        llmEndpointInput.placeholder = getDefaultEndpoint(provider);
        llmModelSelect.innerHTML = '<option value="">-- Select a model --</option>';
    }

    /**
     * Update endpoint placeholder based on provider
     */
    updateEndpointPlaceholder() {
        const { llmProviderSelect, llmEndpointInput } = this.elements;
        const provider = llmProviderSelect.value;
        const defaultEndpoint = getDefaultEndpoint(provider);

        llmEndpointInput.placeholder = defaultEndpoint;
        if (!llmEndpointInput.value) {
            llmEndpointInput.value = defaultEndpoint;
        }
    }

    /**
     * Fetch models from current endpoint
     */
    async fetchModels() {
        const { llmProviderSelect, llmEndpointInput, llmApiKeyInput, llmModelSelect } = this.elements;
        const provider = llmProviderSelect.value;
        const endpoint = llmEndpointInput.value.trim();
        const apiKey = llmApiKeyInput.value.trim();

        const models = await fetchModels(provider, endpoint, apiKey);

        llmModelSelect.innerHTML = '<option value="">-- Select a model --</option>';
        models.forEach(model => {
            const option = document.createElement('option');
            option.value = model.id;
            option.textContent = model.name || model.id;
            llmModelSelect.appendChild(option);
        });

        // Restore previously selected model if it exists
        if (this.settings.llmModel) {
            llmModelSelect.value = this.settings.llmModel;
        }
    }

    /**
     * Save settings from UI
     */
    save() {
        const {
            windowSizeInput, overlapInput, userEmailInput,
            llmProviderSelect, llmEndpointInput, llmApiKeyInput,
            llmModelSelect, extractionPromptTextarea,
            maxLLMRPMInput, maxValidationRPMInput
        } = this.elements;

        this.settings.windowSize = parseInt(windowSizeInput.value) || 2000;
        this.settings.overlap = parseInt(overlapInput.value) || 500;
        this.settings.userEmail = userEmailInput.value.trim();
        this.settings.llmProvider = llmProviderSelect.value;
        this.settings.llmEndpoint = llmEndpointInput.value;
        this.settings.llmApiKey = llmApiKeyInput.value;
        this.settings.llmModel = llmModelSelect.value;
        this.settings.extractionPrompt = extractionPromptTextarea.value;
        this.settings.maxLLMRPM = parseInt(maxLLMRPMInput?.value) || 15;
        this.settings.maxValidationRPM = parseInt(maxValidationRPMInput?.value) || 50;

        saveSettings(this.settings);

        if (this.onSettingsChange) {
            this.onSettingsChange(this.settings);
        }
    }

    /**
     * Sync current values to modal inputs
     */
    syncToModal() {
        this.applyToUI();
    }

    /**
     * Reset prompt to default
     */
    resetPrompt() {
        this.elements.extractionPromptTextarea.value = DEFAULT_PROMPT;
    }

    /**
     * Get current settings
     */
    getSettings() {
        return this.settings;
    }

    /**
     * Check if LLM is configured
     */
    isLLMConfigured() {
        return !!(
            this.settings.llmEndpoint &&
            this.settings.llmApiKey &&
            this.settings.llmModel
        );
    }
}
