/**
 * LLM API client for OpenAI and Google
 */

import { DEFAULT_ENDPOINTS } from '../config/constants.js';

/**
 * Fetch available models from the endpoint
 */
export async function fetchModels(provider, endpoint, apiKey) {
    if (!endpoint || !apiKey) {
        throw new Error('Please enter both endpoint URL and API key to fetch models.');
    }

    if (provider === 'openai') {
        return await fetchOpenAIModels(endpoint, apiKey);
    } else {
        return await fetchGoogleModels(endpoint, apiKey);
    }
}

/**
 * Fetch models from OpenAI-compatible endpoint
 */
async function fetchOpenAIModels(endpoint, apiKey) {
    let modelsUrl = endpoint.replace(/\/$/, '');
    if (!modelsUrl.endsWith('/models')) {
        modelsUrl += '/models';
    }

    const response = await fetch(modelsUrl, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        }
    });

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    return (data.data || []).map(m => ({
        id: m.id,
        name: m.id
    }));
}

/**
 * Fetch models from Google AI Studio endpoint
 */
async function fetchGoogleModels(endpoint, apiKey) {
    let modelsUrl = endpoint.replace(/\/$/, '');
    if (!modelsUrl.endsWith('/models')) {
        modelsUrl += '/models';
    }
    modelsUrl += `?key=${apiKey}`;

    const response = await fetch(modelsUrl, {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json'
        }
    });

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    return (data.models || []).map(m => ({
        id: m.name,
        name: m.displayName || m.name.replace('models/', '')
    }));
}

/**
 * Call OpenAI-compatible API
 */
export async function callOpenAIAPI(endpoint, apiKey, model, systemPrompt, userMessage) {
    let url = endpoint.replace(/\/$/, '');
    if (!url.endsWith('/chat/completions')) {
        url += '/chat/completions';
    }

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: model,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userMessage }
            ],
            temperature: 0.1
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`LLM API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
}

/**
 * Call Google AI Studio API
 */
export async function callGoogleAPI(endpoint, apiKey, model, systemPrompt, userMessage) {
    let url = endpoint.replace(/\/$/, '');
    const modelPath = model.startsWith('models/') ? model : `models/${model}`;
    url = `${url}/${modelPath}:generateContent?key=${apiKey}`;

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            contents: [
                {
                    parts: [
                        { text: systemPrompt + '\n\n' + userMessage }
                    ]
                }
            ],
            generationConfig: {
                temperature: 0.1
            }
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Google API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    return data.candidates[0].content.parts[0].text;
}

/**
 * Extract citations from a window using LLM
 */
export async function extractCitationsFromWindow(settings, win) {
    const prompt = settings.extractionPrompt
        .replace('{START_LINE}', win.startLine + 1)
        .replace('{END_LINE}', win.endLine)
        .replace('{WINDOW_SIZE}', settings.windowSize)
        .replace('{OVERLAP_LINES}', settings.overlap);

    const userMessage = win.text;

    let response;
    if (settings.llmProvider === 'openai') {
        response = await callOpenAIAPI(
            settings.llmEndpoint,
            settings.llmApiKey,
            settings.llmModel,
            prompt,
            userMessage
        );
    } else {
        response = await callGoogleAPI(
            settings.llmEndpoint,
            settings.llmApiKey,
            settings.llmModel,
            prompt,
            userMessage
        );
    }

    // Parse JSON from response
    try {
        const jsonMatch = response.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
            return JSON.parse(jsonMatch[0]);
        }
        return JSON.parse(response);
    } catch (e) {
        console.error('Failed to parse LLM response:', response);
        throw new Error('LLM returned invalid JSON');
    }
}

/**
 * Get default endpoint for a provider
 */
export function getDefaultEndpoint(provider) {
    return DEFAULT_ENDPOINTS[provider] || '';
}
