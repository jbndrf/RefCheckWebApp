/**
 * Markers overlay component - text highlighting
 */

import { escapeHTML, escapeRegExp, normalizeTextField } from '../utils/text.js';

/**
 * Extract significant words from a title for matching.
 * Filters out common short words and returns words >= 4 chars.
 */
function getTitleWords(title) {
    if (!title) return [];
    const stopWords = new Set(['and', 'the', 'for', 'with', 'from', 'into', 'that', 'this', 'which', 'between', 'through']);
    return title
        .toLowerCase()
        .split(/[\s\-:,;.]+/)
        .filter(w => w.length >= 4 && !stopWords.has(w));
}

/**
 * Get searchable text fields from an extraction.
 * Prefers validated data (CrossRef/OpenAlex) when available,
 * falls back to LLM extraction data when unverified.
 * Results are cached on the extraction object for performance.
 */
function getExtractionTextFields(extraction) {
    // Return cached fields if available and validation status hasn't changed
    if (extraction._cachedTextFields && extraction._cachedValidationStatus === extraction.validationStatus) {
        return extraction._cachedTextFields;
    }

    const fields = [];

    // Use validated data if available and matching, otherwise fall back to LLM extraction
    // For mismatches/suspicious, use extracted data since validated data points to wrong paper
    if (extraction.validationStatus === 'valid' && extraction.validation) {
        // Prefer CrossRef data, fall back to OpenAlex
        const cr = extraction.validation.crossref;
        const oa = extraction.validation.openalex;

        // Title - from validated source
        let validatedTitle = null;
        if (cr?.title?.[0]) {
            validatedTitle = cr.title[0];
        } else if (oa?.display_name) {
            validatedTitle = oa.display_name;
        } else if (oa?.title) {
            validatedTitle = oa.title;
        }

        if (validatedTitle) {
            fields.push(normalizeTextField(validatedTitle));
            // Also add significant title words for partial matching
            getTitleWords(validatedTitle).forEach(word => fields.push(word));
        }

        // Container title (journal/book)
        if (cr?.['container-title']?.[0]) {
            fields.push(normalizeTextField(cr['container-title'][0]));
        }

        // Year
        const crYear = cr?.['published-print']?.['date-parts']?.[0]?.[0] ||
                       cr?.issued?.['date-parts']?.[0]?.[0];
        if (crYear) {
            fields.push(String(crYear));
        } else if (oa?.publication_year) {
            fields.push(String(oa.publication_year));
        }

        // Volume, issue, pages
        if (cr?.volume) fields.push(String(cr.volume));
        if (cr?.issue) fields.push(String(cr.issue));
        if (cr?.page) fields.push(String(cr.page));

        // DOI
        if (cr?.DOI) fields.push(cr.DOI);
        else if (oa?.doi) {
            // OpenAlex DOI includes https://doi.org/ prefix, extract just the DOI
            const doi = oa.doi.replace('https://doi.org/', '');
            fields.push(doi);
        }

        // PMID from OpenAlex
        if (oa?.ids?.pmid) {
            const pmid = oa.ids.pmid.replace('https://pubmed.ncbi.nlm.nih.gov/', '');
            fields.push(pmid);
        }

        // Authors from CrossRef
        if (cr?.author && Array.isArray(cr.author)) {
            cr.author.forEach(author => {
                if (author.family) fields.push(author.family);
                if (author.given) fields.push(author.given);
            });
        }
        // Authors from OpenAlex (if no CrossRef authors)
        else if (oa?.authorships && Array.isArray(oa.authorships)) {
            oa.authorships.forEach(authorship => {
                const name = authorship.author?.display_name;
                if (name) {
                    // Split display name into parts for matching
                    name.split(/\s+/).forEach(part => {
                        if (part.length >= 2) fields.push(part);
                    });
                }
            });
        }
    } else {
        // Unverified - use LLM extraction data
        if (extraction.title) {
            fields.push(normalizeTextField(extraction.title));
            // Also add significant title words
            getTitleWords(extraction.title).forEach(word => fields.push(word));
        }
        if (extraction.container_title) fields.push(normalizeTextField(extraction.container_title));
        if (extraction.year) fields.push(String(extraction.year));
        if (extraction.volume) fields.push(String(extraction.volume));
        if (extraction.issue) fields.push(String(extraction.issue));
        if (extraction.pages) fields.push(String(extraction.pages));
        if (extraction.doi) fields.push(extraction.doi);
        if (extraction.pmid) fields.push(String(extraction.pmid));
        if (extraction.isbn) fields.push(extraction.isbn);

        if (extraction.authors && Array.isArray(extraction.authors)) {
            extraction.authors.forEach(author => {
                if (author.family) fields.push(author.family);
                if (author.given) fields.push(author.given);
            });
        }
    }

    const filteredFields = fields.filter(f => f && f.length >= 2);

    // Cache the result
    extraction._cachedTextFields = filteredFields;
    extraction._cachedValidationStatus = extraction.validationStatus;

    return filteredFields;
}

// Cache for compiled regexes to avoid creating them repeatedly
const regexCache = new Map();

function getCachedRegex(field) {
    let regex = regexCache.get(field);
    if (!regex) {
        regex = new RegExp(escapeRegExp(field), 'gi');
        // Limit cache size to prevent memory bloat
        if (regexCache.size > 1000) {
            // Clear oldest entries (first 500)
            const keys = [...regexCache.keys()].slice(0, 500);
            keys.forEach(k => regexCache.delete(k));
        }
        regexCache.set(field, regex);
    }
    // Reset lastIndex for global regex reuse
    regex.lastIndex = 0;
    return regex;
}

/**
 * Highlight text matches in a line for given extractions
 */
function highlightTextInLine(lineText, extractionsOnLine) {
    if (!lineText || extractionsOnLine.length === 0) {
        return escapeHTML(lineText) || '&nbsp;';
    }

    const matches = [];

    extractionsOnLine.forEach(extraction => {
        const textFields = getExtractionTextFields(extraction);

        textFields.forEach(field => {
            const regex = getCachedRegex(field);
            let match;
            while ((match = regex.exec(lineText)) !== null) {
                matches.push({
                    start: match.index,
                    end: match.index + match[0].length,
                    text: match[0],
                    colorIndex: extraction.colorIndex,
                    extractionId: extraction.id
                });
            }
        });
    });

    if (matches.length === 0) {
        return escapeHTML(lineText) || '&nbsp;';
    }

    matches.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));

    const mergedMatches = [];
    for (const match of matches) {
        if (mergedMatches.length === 0) {
            mergedMatches.push(match);
        } else {
            const last = mergedMatches[mergedMatches.length - 1];
            if (match.start >= last.end) {
                mergedMatches.push(match);
            } else if (match.end > last.end) {
                last.end = match.end;
                last.text = lineText.substring(last.start, last.end);
            }
        }
    }

    let result = '';
    let lastEnd = 0;

    for (const match of mergedMatches) {
        if (match.start > lastEnd) {
            result += escapeHTML(lineText.substring(lastEnd, match.start));
        }
        result += `<span class="text-highlight marker-color-${match.colorIndex}" data-extraction-id="${match.extractionId}">${escapeHTML(match.text)}</span>`;
        lastEnd = match.end;
    }

    if (lastEnd < lineText.length) {
        result += escapeHTML(lineText.substring(lastEnd));
    }

    return result || '&nbsp;';
}

/**
 * Get validation status class for a line based on its extractions
 */
function getLineValidationClass(extractionsOnLine) {
    if (extractionsOnLine.length === 0) return '';

    // Check if any extraction on this line is verified
    const hasValid = extractionsOnLine.some(e => e.validationStatus === 'valid');
    if (hasValid) return 'line-valid';

    // Check for suspicious (possible mismatch)
    const hasSuspicious = extractionsOnLine.some(e => e.validationStatus === 'suspicious');
    if (hasSuspicious) return 'line-suspicious';

    // Check for mismatch (content doesn't match identifier)
    const hasMismatch = extractionsOnLine.some(e => e.validationStatus === 'mismatch');
    if (hasMismatch) return 'line-mismatch';

    // All extractions are unverified
    return 'line-invalid';
}

/**
 * Render markers overlay
 */
export function renderMarkersOverlay(markersDisplay, text, state) {
    // Handle all line ending types: \r\n (Windows), \n (Unix), \r (old Mac)
    const lines = text.split(/\r\n|\r|\n/);
    let html = '';

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
        const lineNum = lineIdx + 1;
        const lineText = lines[lineIdx];

        const extractionIds = state.lineToExtractions.get(lineNum) || new Set();
        const extractionsOnLine = [...extractionIds].map(id => state.extractionMap.get(id)).filter(Boolean);

        const extractionIdAttr = extractionsOnLine.map(e => e.id).join(' ');
        const highlightedText = highlightTextInLine(lineText, extractionsOnLine);
        const validationClass = getLineValidationClass(extractionsOnLine);

        html += `<div class="marked-line ${validationClass}" data-line="${lineNum}" data-extraction-ids="${extractionIdAttr}">`;
        html += `<span class="line-num">${lineNum}</span>`;
        html += `<span class="line-text">${highlightedText}</span>`;
        html += `</div>`;
    }

    markersDisplay.innerHTML = html;
}

/**
 * Add hover and click listeners for markers
 */
export function addMarkerHoverListeners(markersDisplay, extractionsDisplay, callbacks) {
    const markedLines = markersDisplay.querySelectorAll('.marked-line[data-extraction-ids]');

    markedLines.forEach(line => {
        line.addEventListener('mouseenter', (e) => handleMarkerHover(e, markersDisplay, extractionsDisplay, callbacks));
        line.addEventListener('mouseleave', () => clearAllHighlights(markersDisplay, extractionsDisplay));
        line.addEventListener('click', (e) => handleMarkerClick(e, extractionsDisplay));
    });
}

function handleMarkerHover(e, markersDisplay, extractionsDisplay, callbacks) {
    const line = e.currentTarget;
    const extractionIds = line.dataset.extractionIds;

    if (!extractionIds || !extractionIds.trim()) return;

    const ids = extractionIds.split(' ').filter(Boolean);

    ids.forEach(id => {
        const card = document.querySelector(`.extraction-card[data-extraction-id="${id}"]`);
        if (card) {
            card.classList.add('hover-highlight');
            card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    });

    highlightLinesForExtractions(ids, markersDisplay);
    extractionsDisplay.classList.add('has-hover');
}

/**
 * Handle click on marked line - expand corresponding card(s)
 */
function handleMarkerClick(e, extractionsDisplay) {
    const line = e.currentTarget;
    const extractionIds = line.dataset.extractionIds;

    if (!extractionIds || !extractionIds.trim()) return;

    const ids = extractionIds.split(' ').filter(Boolean);

    // Find and expand the first card, scroll to it
    ids.forEach((id, index) => {
        const card = document.querySelector(`.extraction-card[data-extraction-id="${id}"]`);
        if (card) {
            card.classList.add('expanded');
            // Scroll to the first card
            if (index === 0) {
                card.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }
    });
}

/**
 * Highlight lines for given extraction IDs
 * Optimized to use a single querySelectorAll and Set lookup
 */
export function highlightLinesForExtractions(extractionIds, markersDisplay) {
    const extractionIdSet = new Set(extractionIds);
    const markedLines = markersDisplay.querySelectorAll('.marked-line');

    markedLines.forEach(line => {
        const lineExtractionIds = line.dataset.extractionIds;
        if (!lineExtractionIds) return;

        // Fast check: if any extraction ID is in this line
        const ids = lineExtractionIds.split(' ');
        for (const id of ids) {
            if (id && extractionIdSet.has(id)) {
                line.classList.add('hover-highlight');
                break;
            }
        }
    });

    // Single query for all text highlights, then filter
    const allHighlights = markersDisplay.querySelectorAll('.text-highlight');
    allHighlights.forEach(span => {
        if (extractionIdSet.has(span.dataset.extractionId)) {
            span.classList.add('hover-highlight');
        }
    });

    markersDisplay.classList.add('has-hover');
}

/**
 * Clear all highlights
 */
export function clearAllHighlights(markersDisplay, extractionsDisplay) {
    markersDisplay.querySelectorAll('.marked-line.hover-highlight').forEach(el => {
        el.classList.remove('hover-highlight');
    });

    markersDisplay.querySelectorAll('.text-highlight.hover-highlight').forEach(el => {
        el.classList.remove('hover-highlight');
    });

    extractionsDisplay.querySelectorAll('.extraction-card.hover-highlight').forEach(el => {
        el.classList.remove('hover-highlight');
    });

    markersDisplay.classList.remove('has-hover');
    extractionsDisplay.classList.remove('has-hover');
}

/**
 * Scroll input to a specific line
 */
export function scrollToLine(markersDisplay, lineNumber) {
    const line = markersDisplay.querySelector(`.marked-line[data-line="${lineNumber}"]`);
    if (line) {
        line.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}
