/**
 * Extraction state management
 */

import { WINDOW_COLORS } from '../config/constants.js';

/**
 * Create extraction state container
 */
export function createExtractionState() {
    return {
        extractions: [],
        extractionMap: new Map(),
        lineToExtractions: new Map(),
        processingResults: [],
        currentWindows: [],
        isProcessing: false,
        shouldCancel: false
    };
}

/**
 * Compute which line number a character position falls on (1-indexed)
 * Handles all line ending types: \r\n (Windows), \n (Unix), \r (old Mac)
 */
function charPosToLine(text, charPos) {
    if (!text || charPos <= 0) return 1;
    const upToPos = text.slice(0, charPos);
    // Count line endings: \r\n counts as one, \r or \n alone each count as one
    return (upToPos.match(/\r\n|\r|\n/g) || []).length + 1;
}

/**
 * Process a raw extraction into a structured extraction object
 * @param {Object} rawExtraction - Raw extraction from LLM
 * @param {number} index - Extraction index
 * @param {number} windowIndex - Window index (1-based)
 */
export function processExtraction(rawExtraction, index, windowIndex) {
    return {
        ...rawExtraction,
        id: `extraction-${index}`,
        index: index,
        colorIndex: index % WINDOW_COLORS.length,
        windowIndex: windowIndex
    };
}

/**
 * Check if two incomplete extractions should be merged.
 *
 * Rules:
 * 1. ONLY merge incomplete extractions (complete extractions have closed borders)
 * 2. Positions must complement: "end" (cut at window end) + "start" (cut at window start)
 * 3. Single field match is sufficient (LLM output is consistent)
 */
export function extractionsOverlap(ext1, ext2) {
    if (ext1.error || ext2.error) return false;

    // Rule 1: Never merge complete extractions
    if (ext1.complete !== false || ext2.complete !== false) {
        return false;
    }

    // Rule 2: Positions must complement
    // ext1 should be "end" (from earlier window), ext2 should be "start" (from later window)
    const hasComplementaryPositions =
        (ext1.position === 'end' && ext2.position === 'start') ||
        (ext1.position === 'start' && ext2.position === 'end');

    if (!hasComplementaryPositions) {
        return false;
    }

    return extractionsMatchByFields(ext1, ext2);
}

/**
 * Check if a complete extraction supersedes a pending incomplete "end" extraction.
 *
 * This handles the case where:
 * - Window N extracts an incomplete citation (position: "end")
 * - Window N+1 sees the full citation in the overlap and extracts it as complete
 *
 * The complete extraction supersedes the incomplete one.
 */
export function completeSupersedes(incompleteEnd, completeExtraction) {
    if (incompleteEnd.error || completeExtraction.error) return false;

    // incompleteEnd must be incomplete with position "end"
    if (incompleteEnd.complete !== false || incompleteEnd.position !== 'end') {
        return false;
    }

    // completeExtraction must be complete
    if (completeExtraction.complete === false) {
        return false;
    }

    return extractionsMatchByFields(incompleteEnd, completeExtraction);
}

/**
 * Check if two extractions match by their fields.
 * Used for incomplete merging and complete superseding.
 * This uses LOOSE matching - a single field match is sufficient.
 */
function extractionsMatchByFields(ext1, ext2) {
    // Match by DOI
    if (ext1.doi && ext2.doi &&
        ext1.doi.toLowerCase() === ext2.doi.toLowerCase()) {
        return true;
    }

    // Match by PMID
    if (ext1.pmid && ext2.pmid &&
        String(ext1.pmid) === String(ext2.pmid)) {
        return true;
    }

    // Match by ISBN
    if (ext1.isbn && ext2.isbn &&
        ext1.isbn.replace(/[-\s]/g, '') === ext2.isbn.replace(/[-\s]/g, '')) {
        return true;
    }

    // Match by first author family name (exact match)
    if (ext1.authors?.length > 0 && ext2.authors?.length > 0) {
        const author1 = ext1.authors[0].family?.toLowerCase().trim();
        const author2 = ext2.authors[0].family?.toLowerCase().trim();
        if (author1 && author2 && author1 === author2) {
            return true;
        }
    }

    // Match by title substring (one contains significant part of the other)
    if (ext1.title && ext2.title) {
        const title1 = ext1.title.toLowerCase().trim();
        const title2 = ext2.title.toLowerCase().trim();

        // For incomplete extractions, titles may be partial
        // Check if they share a common substring of reasonable length
        const minLen = Math.min(title1.length, title2.length);
        if (minLen >= 10) {
            // Check if shorter is contained in longer, or significant overlap
            if (title1.includes(title2) || title2.includes(title1)) {
                return true;
            }
            // Check if they start or end the same way (partial title from cut)
            const checkLen = Math.min(15, minLen);
            if (title1.substring(0, checkLen) === title2.substring(0, checkLen)) {
                return true;
            }
        }
    }

    // Match by year + container_title (for entries where title might be fully cut)
    if (ext1.year && ext2.year && ext1.container_title && ext2.container_title) {
        if (String(ext1.year) === String(ext2.year) &&
            ext1.container_title.toLowerCase() === ext2.container_title.toLowerCase()) {
            return true;
        }
    }

    return false;
}

/**
 * Check if two extractions are duplicates using STRICT matching.
 * Used for post-processing deduplication where we need high confidence
 * that two extractions represent the exact same citation.
 *
 * Requires either:
 * - Matching unique identifier (DOI, PMID, ISBN)
 * - OR: High title similarity (>80%) + matching first author + matching year
 */
function extractionsAreDuplicates(ext1, ext2) {
    // Definitive match by unique identifiers
    if (ext1.doi && ext2.doi &&
        ext1.doi.toLowerCase() === ext2.doi.toLowerCase()) {
        return true;
    }

    if (ext1.pmid && ext2.pmid &&
        String(ext1.pmid) === String(ext2.pmid)) {
        return true;
    }

    if (ext1.isbn && ext2.isbn &&
        ext1.isbn.replace(/[-\s]/g, '') === ext2.isbn.replace(/[-\s]/g, '')) {
        return true;
    }

    // For non-identifier matches, require multiple fields to match
    // This prevents incorrectly matching different papers by the same author

    // Must have matching titles with high similarity
    if (!ext1.title || !ext2.title) return false;

    const title1 = ext1.title.toLowerCase().trim();
    const title2 = ext2.title.toLowerCase().trim();

    // Calculate title similarity
    const titleSimilarity = calculateSimilarity(title1, title2);
    if (titleSimilarity < 0.8) return false;

    // Must also have matching first author
    if (ext1.authors?.length > 0 && ext2.authors?.length > 0) {
        const author1 = ext1.authors[0].family?.toLowerCase().trim();
        const author2 = ext2.authors[0].family?.toLowerCase().trim();
        if (!author1 || !author2 || author1 !== author2) return false;
    } else {
        // No authors to compare - can't confirm duplicate without identifier
        return false;
    }

    // Must also have matching year (if both have year)
    if (ext1.year && ext2.year && String(ext1.year) !== String(ext2.year)) {
        return false;
    }

    return true;
}

/**
 * Calculate similarity between two strings (0 to 1).
 * Uses a simple approach: ratio of matching characters.
 */
function calculateSimilarity(str1, str2) {
    if (!str1 || !str2) return 0;
    if (str1 === str2) return 1;

    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;

    if (longer.length === 0) return 1;

    // Check if shorter is contained in longer
    if (longer.includes(shorter)) {
        return shorter.length / longer.length;
    }

    // Count matching characters in order (simple LCS-like)
    let matches = 0;
    let longerIdx = 0;
    for (const char of shorter) {
        const foundIdx = longer.indexOf(char, longerIdx);
        if (foundIdx !== -1) {
            matches++;
            longerIdx = foundIdx + 1;
        }
    }

    return (2 * matches) / (str1.length + str2.length);
}

/**
 * Escape special regex characters in a string
 */
function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Find the character position range of an extraction in the source text
 * by matching its fields (raw_text, title, DOI, etc.)
 * Returns { start, end } character positions, or null if not found
 */
function findExtractionInText(extraction, fullText) {
    if (!fullText || extraction.error) return null;

    const textLower = fullText.toLowerCase();
    let bestMatch = null;

    // Strategy 1: Match raw_text (most reliable - it's the actual source text)
    if (extraction.raw_text && extraction.raw_text.length >= 20) {
        // Try exact match first
        const rawTextLower = extraction.raw_text.toLowerCase().trim();
        let pos = textLower.indexOf(rawTextLower);
        if (pos >= 0) {
            return { start: pos, end: pos + rawTextLower.length };
        }

        // Try matching first significant chunk (first 50+ chars)
        const chunk = rawTextLower.substring(0, Math.min(80, rawTextLower.length));
        pos = textLower.indexOf(chunk);
        if (pos >= 0) {
            // Find the end by looking for the last part of raw_text
            const lastChunk = rawTextLower.substring(Math.max(0, rawTextLower.length - 40));
            const endPos = textLower.indexOf(lastChunk, pos);
            if (endPos >= pos) {
                return { start: pos, end: endPos + lastChunk.length };
            }
            return { start: pos, end: pos + chunk.length + 100 }; // Estimate
        }
    }

    // Strategy 2: Match by DOI (unique identifier)
    if (extraction.doi) {
        const doiLower = extraction.doi.toLowerCase();
        const pos = textLower.indexOf(doiLower);
        if (pos >= 0) {
            // DOI found - expand to find the full entry
            // Look backwards for entry start (number + period or newline)
            let start = pos;
            for (let i = pos - 1; i >= Math.max(0, pos - 500); i--) {
                if (fullText[i] === '\n' || fullText[i] === '\r') {
                    // Check if this looks like an entry start
                    const afterNewline = fullText.substring(i + 1, i + 10).trim();
                    if (/^\d+[\.\)]/.test(afterNewline) || afterNewline.length === 0) {
                        start = i + 1;
                        break;
                    }
                }
            }
            // Look forward for entry end
            let end = pos + doiLower.length;
            for (let i = end; i < Math.min(fullText.length, end + 200); i++) {
                if (fullText[i] === '\n' || fullText[i] === '\r') {
                    const nextChar = fullText[i + 1];
                    if (!nextChar || /\d/.test(nextChar) || nextChar === '\n' || nextChar === '\r') {
                        end = i;
                        break;
                    }
                }
            }
            bestMatch = { start, end };
        }
    }

    // Strategy 3: Match by title
    if (!bestMatch && extraction.title && extraction.title.length >= 15) {
        const titleLower = extraction.title.toLowerCase().trim();
        const pos = textLower.indexOf(titleLower);
        if (pos >= 0) {
            // Title found - expand to find full entry (similar logic)
            let start = pos;
            for (let i = pos - 1; i >= Math.max(0, pos - 300); i--) {
                if (fullText[i] === '\n' || fullText[i] === '\r') {
                    start = i + 1;
                    break;
                }
            }
            let end = pos + titleLower.length;
            for (let i = end; i < Math.min(fullText.length, end + 400); i++) {
                if (fullText[i] === '\n' || fullText[i] === '\r') {
                    const nextPart = fullText.substring(i + 1, i + 5).trim();
                    if (/^\d+[\.\)]/.test(nextPart)) {
                        end = i;
                        break;
                    }
                }
                end = i;
            }
            bestMatch = { start, end };
        }
    }

    // Strategy 4: Match by first author + year
    if (!bestMatch && extraction.authors?.length > 0 && extraction.year) {
        const firstAuthor = extraction.authors[0].family?.toLowerCase();
        if (firstAuthor && firstAuthor.length >= 3) {
            const yearStr = String(extraction.year);
            // Look for author name followed by year within reasonable distance
            const authorPos = textLower.indexOf(firstAuthor);
            if (authorPos >= 0) {
                const searchArea = textLower.substring(authorPos, authorPos + 500);
                if (searchArea.includes(yearStr)) {
                    let start = authorPos;
                    // Find entry boundaries
                    for (let i = authorPos - 1; i >= Math.max(0, authorPos - 100); i--) {
                        if (fullText[i] === '\n' || fullText[i] === '\r') {
                            start = i + 1;
                            break;
                        }
                    }
                    let end = authorPos + 300;
                    for (let i = authorPos; i < Math.min(fullText.length, authorPos + 500); i++) {
                        if (fullText[i] === '\n' || fullText[i] === '\r') {
                            const nextPart = fullText.substring(i + 1, i + 5).trim();
                            if (/^\d+[\.\)]/.test(nextPart)) {
                                end = i;
                                break;
                            }
                        }
                        end = i;
                    }
                    bestMatch = { start, end };
                }
            }
        }
    }

    return bestMatch;
}

/**
 * Build line-to-extraction mapping by finding where extractions appear in source text
 * @param {Object} state - The extraction state
 * @param {string} fullText - The full source text to search in
 */
export function buildLineExtractionMap(state, fullText) {
    state.extractionMap.clear();
    state.lineToExtractions.clear();

    state.extractions.forEach(extraction => {
        state.extractionMap.set(extraction.id, extraction);

        // Find where this extraction actually appears in the text
        const position = findExtractionInText(extraction, fullText);

        if (position) {
            // Convert character positions to line numbers
            const startLine = charPosToLine(fullText, position.start);
            const endLine = charPosToLine(fullText, position.end);

            // Set line numbers on extraction (used for scrolling)
            extraction.absoluteLineStart = startLine;
            extraction.absoluteLineEnd = endLine;

            // Map lines to this extraction
            for (let line = startLine; line <= endLine; line++) {
                if (!state.lineToExtractions.has(line)) {
                    state.lineToExtractions.set(line, new Set());
                }
                state.lineToExtractions.get(line).add(extraction.id);
            }
        }
        // If field matching fails, extraction won't be mapped to any lines
        // This is expected for error extractions or those with insufficient data
    });
}

/**
 * Clear all extractions
 */
export function clearExtractions(state) {
    state.extractions = [];
    state.extractionMap.clear();
    state.lineToExtractions.clear();
    state.processingResults = [];
}

/**
 * Add an extraction to state
 */
export function addExtraction(state, extraction) {
    state.extractions.push(extraction);
    state.processingResults.push(extraction);
}

/**
 * Create an error extraction object
 */
export function createErrorExtraction(index, windowIndex, errorMessage) {
    return {
        id: `extraction-${index}`,
        index: index,
        colorIndex: index % WINDOW_COLORS.length,
        windowIndex: windowIndex,
        error: true,
        errorMessage: errorMessage,
        validationStatus: 'invalid'
    };
}

/**
 * Score an extraction for quality comparison during deduplication.
 * Higher score = better quality extraction to keep.
 */
function scoreExtraction(ext) {
    let score = 0;

    // Validation status scoring
    if (ext.validationStatus === 'valid') score += 100;
    else if (ext.validationStatus === 'suspicious') score += 50;
    else if (ext.validationStatus === 'incomplete') score += 10;
    else if (ext.validationStatus === 'invalid') score += 5;

    // Complete extractions are better
    if (ext.complete !== false) score += 50;

    // Having identifiers is valuable
    if (ext.doi) score += 30;
    if (ext.pmid) score += 20;
    if (ext.isbn) score += 20;

    // More metadata = better
    if (ext.title) score += 10;
    if (ext.year) score += 5;
    if (ext.container_title) score += 5;
    if (ext.volume) score += 3;
    if (ext.issue) score += 3;
    if (ext.pages) score += 3;

    // More authors = more complete
    if (ext.authors?.length) score += Math.min(ext.authors.length * 2, 10);

    // Later windows often have more context (tie-breaker)
    score += (ext.windowIndex || 0) * 0.1;

    return score;
}

/**
 * Deduplicate extractions that appear in multiple windows.
 * This handles the case where a citation fits entirely within the overlap region,
 * causing both windows to extract it as complete.
 *
 * @param {Object} state - The extraction state
 * @returns {number} - Number of duplicates removed
 */
export function deduplicateExtractions(state) {
    if (state.extractions.length < 2) return 0;

    const idsToRemove = new Set();

    // Compare all pairs of extractions
    for (let i = 0; i < state.extractions.length; i++) {
        const ext1 = state.extractions[i];
        if (ext1.error || idsToRemove.has(ext1.id)) continue;

        for (let j = i + 1; j < state.extractions.length; j++) {
            const ext2 = state.extractions[j];
            if (ext2.error || idsToRemove.has(ext2.id)) continue;

            // Check if these extractions are duplicates (using STRICT matching)
            if (extractionsAreDuplicates(ext1, ext2)) {
                // Keep the better one, remove the worse one
                const score1 = scoreExtraction(ext1);
                const score2 = scoreExtraction(ext2);

                if (score1 >= score2) {
                    idsToRemove.add(ext2.id);
                } else {
                    idsToRemove.add(ext1.id);
                    break; // ext1 is removed, stop comparing it
                }
            }
        }
    }

    if (idsToRemove.size === 0) return 0;

    // Remove duplicates by filtering (safer than index-based splicing)
    state.extractions = state.extractions.filter(e => !idsToRemove.has(e.id));
    state.processingResults = state.processingResults.filter(e => !idsToRemove.has(e.id));

    return idsToRemove.size;
}
