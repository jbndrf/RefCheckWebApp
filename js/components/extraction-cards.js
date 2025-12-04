/**
 * Extraction cards component
 */

import { escapeHTML } from '../utils/text.js';
import { highlightLinesForExtractions, clearAllHighlights, scrollToLine } from './markers.js';

/**
 * Get human-readable status label
 */
function getStatusLabel(status) {
    switch (status) {
        case 'valid': return 'Verified';
        case 'suspicious': return 'Needs Review';
        case 'mismatch': return 'Mismatch';
        case 'invalid': return 'Unverified';
        case 'incomplete': return 'Incomplete';
        default: return 'Pending';
    }
}

/**
 * Render extraction fields
 */
function renderExtractionFields(extraction) {
    const fields = [];

    if (extraction.windowIndex) {
        fields.push({ label: 'Window', value: `W${extraction.windowIndex}` });
    }
    if (extraction.doi) {
        fields.push({ label: 'DOI', value: `<a href="https://doi.org/${extraction.doi}" target="_blank">${extraction.doi}</a>` });
    }
    if (extraction.pmid) {
        fields.push({ label: 'PMID', value: `<a href="https://pubmed.ncbi.nlm.nih.gov/${extraction.pmid}" target="_blank">${extraction.pmid}</a>` });
    }
    if (extraction.isbn) {
        fields.push({ label: 'ISBN', value: extraction.isbn });
    }
    if (extraction.authors && extraction.authors.length > 0) {
        const authorStr = extraction.authors.map(a => `${a.family || ''}, ${a.given || ''}`).join('; ');
        fields.push({ label: 'Authors', value: authorStr + (extraction.authors_truncated ? ' et al.' : '') });
    }
    if (extraction.year) {
        fields.push({ label: 'Year', value: extraction.year });
    }
    if (extraction.container_title) {
        fields.push({ label: 'Journal/Book', value: extraction.container_title });
    }
    if (extraction.volume) {
        fields.push({ label: 'Volume', value: extraction.volume });
    }
    if (extraction.issue) {
        fields.push({ label: 'Issue', value: extraction.issue });
    }
    if (extraction.pages) {
        fields.push({ label: 'Pages', value: extraction.pages });
    }

    if (fields.length === 0) {
        return '<div class="extraction-field"><span class="extraction-field-value">No fields extracted</span></div>';
    }

    return fields.map(f => `
        <div class="extraction-field">
            <span class="extraction-field-label">${f.label}:</span>
            <span class="extraction-field-value">${f.value}</span>
        </div>
    `).join('');
}

/**
 * Get CSS class for validation status
 */
function getValidationClass(status) {
    switch (status) {
        case 'valid': return 'match';
        case 'suspicious': return 'suspicious';
        case 'mismatch': return 'mismatch';
        default: return 'mismatch';
    }
}

/**
 * Render field match scores breakdown
 */
function renderMatchScoreBreakdown(matchScore) {
    if (!matchScore || !matchScore.fields) return '';

    const fieldLabels = {
        title: 'Title',
        authors: 'Authors',
        year: 'Year',
        journal: 'Journal',
        volume: 'Volume',
        pages: 'Pages'
    };

    const items = Object.entries(matchScore.fields).map(([field, score]) => {
        const pct = Math.round(score * 100);
        const scoreClass = score >= 0.7 ? 'good' : score >= 0.4 ? 'warn' : 'bad';
        return `<span class="field-score ${scoreClass}" title="${fieldLabels[field] || field}: ${pct}%">${fieldLabels[field] || field}: ${pct}%</span>`;
    });

    return `<div class="match-score-breakdown">${items.join('')}</div>`;
}

/**
 * Render validation results
 */
function renderValidationResults(citation) {
    if (!citation.validation || Object.keys(citation.validation).length === 0) {
        if (citation.validationMessage) {
            return `
                <div class="validation-section">
                    <h4>Validation</h4>
                    <div class="validation-match ${getValidationClass(citation.validationStatus)}">
                        ${escapeHTML(citation.validationMessage)}
                    </div>
                </div>
            `;
        }
        return '';
    }

    const statusClass = getValidationClass(citation.validationStatus);
    let html = '<div class="validation-section"><h4>Validation</h4>';

    if (citation.validationMessage) {
        html += `<div class="validation-match ${statusClass}">${escapeHTML(citation.validationMessage)}</div>`;
    }

    // Show field-level match scores for suspicious or mismatch
    if (citation.validation.matchScore && citation.validationStatus !== 'valid') {
        html += renderMatchScoreBreakdown(citation.validation.matchScore);
    }

    if (citation.validation.crossref) {
        const cr = citation.validation.crossref;
        html += `<div class="validation-match ${statusClass}">
            <strong>CrossRef:</strong> ${escapeHTML(cr.title?.[0] || 'No title')}
            ${cr.DOI ? `<br>DOI: <a href="https://doi.org/${cr.DOI}" target="_blank">${cr.DOI}</a>` : ''}
        </div>`;
    }

    if (citation.validation.openalex) {
        const oa = citation.validation.openalex;
        html += `<div class="validation-match ${statusClass}">
            <strong>OpenAlex:</strong> ${escapeHTML(oa.display_name || oa.title || 'No title')}
            ${oa.doi ? `<br>DOI: <a href="${oa.doi}" target="_blank">${oa.doi}</a>` : ''}
        </div>`;
    }

    html += '</div>';
    return html;
}

/**
 * Render raw text section
 */
function renderRawText(citation) {
    if (!citation.raw_text) return '';

    return `
        <div class="raw-text-section">
            <h4>Original Text</h4>
            <div class="raw-text">${escapeHTML(citation.raw_text)}</div>
        </div>
    `;
}

/**
 * Render an extraction card
 */
export function renderExtractionCard(extraction, state, markersDisplay, extractionsDisplay) {
    const card = document.createElement('div');
    card.className = `extraction-card ${extraction.validationStatus || 'pending'}`;
    if (extraction.complete === false) {
        card.classList.add('incomplete');
    }

    card.dataset.extractionId = extraction.id;
    card.dataset.colorIndex = extraction.colorIndex;

    const title = extraction.title ||
                  (extraction.raw_text ? extraction.raw_text.substring(0, 80) + '...' : null) ||
                  'Unknown Citation';
    const statusLabel = getStatusLabel(extraction.validationStatus);

    card.innerHTML = `
        <div class="extraction-header">
            <div class="extraction-title">${escapeHTML(title)}</div>
            <div class="extraction-meta">
                <span class="extraction-status ${extraction.validationStatus || 'pending'}">${statusLabel}</span>
                ${extraction.complete === false ? '<span class="incomplete-badge">Truncated</span>' : ''}
                <span class="extraction-toggle">v</span>
            </div>
        </div>
        <div class="extraction-body">
            ${renderExtractionFields(extraction)}
            ${renderValidationResults(extraction)}
            ${renderRawText(extraction)}
        </div>
    `;

    // Toggle expand/collapse
    const header = card.querySelector('.extraction-header');
    header.addEventListener('click', () => {
        card.classList.toggle('expanded');
    });

    // Add hover listeners for bidirectional highlighting
    card.addEventListener('mouseenter', () => {
        handleCardHover(extraction, state, markersDisplay, extractionsDisplay);
    });
    card.addEventListener('mouseleave', () => {
        clearAllHighlights(markersDisplay, extractionsDisplay);
    });

    return card;
}

/**
 * Handle card hover
 */
function handleCardHover(extraction, state, markersDisplay, extractionsDisplay) {
    const card = document.querySelector(`.extraction-card[data-extraction-id="${extraction.id}"]`);
    if (card) {
        card.classList.add('hover-highlight');
    }

    highlightLinesForExtractions([extraction.id], markersDisplay);
    if (extraction.absoluteLineStart) {
        scrollToLine(markersDisplay, extraction.absoluteLineStart);
    }
    extractionsDisplay.classList.add('has-hover');
}

/**
 * Render an error card
 */
export function renderErrorCard(extractionsDisplay, windowIndex, errorMessage) {
    const card = document.createElement('div');
    card.className = 'extraction-card invalid';
    card.innerHTML = `
        <div class="extraction-header">
            <div class="extraction-title">Error processing Window ${windowIndex}</div>
            <div class="extraction-meta">
                <span class="extraction-status invalid">Error</span>
            </div>
        </div>
        <div class="extraction-body">
            <div class="extraction-field">
                <span class="extraction-field-value">${escapeHTML(errorMessage)}</span>
            </div>
        </div>
    `;
    extractionsDisplay.appendChild(card);
}

/**
 * Collapse all expanded cards
 */
export function collapseAllCards(extractionsDisplay) {
    const cards = extractionsDisplay.querySelectorAll('.extraction-card.expanded');
    cards.forEach(card => card.classList.remove('expanded'));
}
