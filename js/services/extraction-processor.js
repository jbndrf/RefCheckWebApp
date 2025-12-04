/**
 * Extraction processing service
 */

import { extractCitationsFromWindow } from '../api/llm-client.js';
import { validateCitation } from './validation.js';
import {
    processExtraction,
    extractionsOverlap,
    completeSupersedes,
    deduplicateExtractions,
    buildLineExtractionMap,
    addExtraction,
    createErrorExtraction
} from '../state/extraction-state.js';
import { RateLimiter, createValidationRateLimiter } from '../utils/rate-limiter.js';

/**
 * Merge two incomplete extractions using master/slave approach.
 *
 * @param {Object} master - The "end" extraction (cut at window end, has beginning of citation)
 * @param {Object} slave - The "start" extraction (cut at window start, has end of citation)
 * @returns {Object} - Merged extraction marked as complete
 */
function mergeExtractions(master, slave) {
    // Determine which is which based on position
    let endExtraction, startExtraction;
    if (master.position === 'end') {
        endExtraction = master;
        startExtraction = slave;
    } else {
        endExtraction = slave;
        startExtraction = master;
    }

    // Mark as complete after merge
    endExtraction.complete = true;
    delete endExtraction.reason;
    delete endExtraction.position;

    // Merge text fields - combine or prefer longer
    if (endExtraction.raw_text && startExtraction.raw_text) {
        // Combine raw text (end's text + start's text)
        endExtraction.raw_text = endExtraction.raw_text + '\n' + startExtraction.raw_text;
    } else if (!endExtraction.raw_text && startExtraction.raw_text) {
        endExtraction.raw_text = startExtraction.raw_text;
    }

    // For title, prefer longer (more complete) or combine if both partial
    if (endExtraction.title && startExtraction.title) {
        if (startExtraction.title.length > endExtraction.title.length) {
            endExtraction.title = startExtraction.title;
        }
    } else if (!endExtraction.title && startExtraction.title) {
        endExtraction.title = startExtraction.title;
    }

    // Other text fields - prefer longer
    const textFields = ['container_title', 'query_bibliographic'];
    for (const field of textFields) {
        if (!endExtraction[field] && startExtraction[field]) {
            endExtraction[field] = startExtraction[field];
        } else if (endExtraction[field] && startExtraction[field] &&
                   startExtraction[field].length > endExtraction[field].length) {
            endExtraction[field] = startExtraction[field];
        }
    }

    // Simple fields - fill in missing
    const simpleFields = ['doi', 'pmid', 'isbn', 'year', 'volume', 'issue', 'pages'];
    for (const field of simpleFields) {
        if (!endExtraction[field] && startExtraction[field]) {
            endExtraction[field] = startExtraction[field];
        }
    }

    // Authors - prefer longer list
    if (startExtraction.authors?.length > (endExtraction.authors?.length || 0)) {
        endExtraction.authors = startExtraction.authors;
    }

    // Preserve truncation flag
    if (endExtraction.authors_truncated || startExtraction.authors_truncated) {
        endExtraction.authors_truncated = true;
    }

    return endExtraction;
}

/**
 * Process all windows and extract citations
 * LLM calls run sequentially with rate limiting, validation runs in parallel
 */
export async function processAllWindows(options) {
    const {
        state,
        settings,
        fullText,
        onProgress,
        onExtractionComplete,
        onError,
        onWindowStart
    } = options;

    const totalWindows = state.currentWindows.length;

    // LLM limiter: sequential (maxConcurrent=1) with RPM limit
    const llmLimiter = new RateLimiter({
        maxConcurrent: 1,
        requestsPerMinute: settings.maxLLMRPM || 15
    });

    const validationLimiter = createValidationRateLimiter(settings.maxValidationRPM || 50);

    let extractionIndex = 0;
    const pendingValidations = []; // Track ongoing validation promises

    // Track incomplete extractions with position="end" waiting for their continuation
    let pendingIncompleteEnd = [];

    /**
     * Start validation for a finalized citation (non-blocking)
     * Note: buildLineExtractionMap is called only once at the end for performance
     */
    function startValidation(citation) {
        const promise = validationLimiter.schedule(async () => {
            if (state.shouldCancel) return;

            if (citation.complete === false) {
                citation.validationStatus = 'incomplete';
                citation.validationMessage = citation.reason || 'Entry incomplete';
            } else {
                await validateCitation(citation, settings.userEmail);
            }

            addExtraction(state, citation);
            // Don't rebuild line map here - it's O(n*m) and called once at the end
            onExtractionComplete?.(citation);
        });
        pendingValidations.push(promise);
    }

    /**
     * Find a matching pending "end" extraction for a "start" extraction
     * Returns the index in pendingIncompleteEnd, or -1 if no match
     */
    function findMatchingPendingEnd(startExtraction) {
        // Only match if this is a "start" extraction
        if (startExtraction.complete !== false || startExtraction.position !== 'start') {
            return -1;
        }

        for (let i = 0; i < pendingIncompleteEnd.length; i++) {
            if (extractionsOverlap(pendingIncompleteEnd[i], startExtraction)) {
                return i;
            }
        }
        return -1;
    }

    // Process windows sequentially with rate limiting
    for (let i = 0; i < totalWindows; i++) {
        if (state.shouldCancel) break;

        const win = state.currentWindows[i];
        const isLastWindow = (i === totalWindows - 1);

        onWindowStart?.(i, totalWindows);
        onProgress?.(`Window ${i + 1}/${totalWindows}: Extracting...`);

        let citations = [];
        let error = null;

        try {
            citations = await llmLimiter.schedule(() => extractCitationsFromWindow(settings, win));
        } catch (e) {
            error = e;
        }

        if (error) {
            console.error(`Error processing window ${i + 1}:`, error);

            // Finalize all pending on error (they won't find their match)
            for (const pending of pendingIncompleteEnd) {
                startValidation(pending);
            }
            pendingIncompleteEnd = [];

            const errorExtraction = createErrorExtraction(extractionIndex, i + 1, error.message);
            addExtraction(state, errorExtraction);
            // Don't rebuild line map here - it's O(n*m) and called once at the end
            onError?.(i + 1, error.message, errorExtraction);
            extractionIndex++;
            continue;
        }

        // New incomplete "end" extractions from this window
        const newIncompleteEnd = [];

        for (let j = 0; j < citations.length; j++) {
            if (state.shouldCancel) break;

            const citation = citations[j];
            const processed = processExtraction(citation, extractionIndex, i + 1);

            // Case 1: This is an incomplete "start" extraction - try to match with pending "end"
            if (processed.complete === false && processed.position === 'start') {
                const matchIndex = findMatchingPendingEnd(processed);

                if (matchIndex >= 0) {
                    // Found a match - merge and finalize
                    const endExtraction = pendingIncompleteEnd[matchIndex];
                    mergeExtractions(endExtraction, processed);
                    pendingIncompleteEnd.splice(matchIndex, 1);

                    // Merged extraction is now complete - validate it
                    startValidation(endExtraction);
                    // Don't increment extractionIndex - we merged into existing
                    continue;
                }

                // No match found - this "start" extraction stands alone (orphaned)
                // It will be validated as incomplete
            }

            // Case 2: This is an incomplete "end" extraction - hold for next window
            if (processed.complete === false && processed.position === 'end' && !isLastWindow) {
                processed.id = `extraction-${extractionIndex}`;
                processed.index = extractionIndex;
                newIncompleteEnd.push(processed);
                extractionIndex++;
                continue;
            }

            // Case 3: Complete extraction - check if it supersedes any pending incomplete "end"
            // This handles the case where window N had an incomplete extraction, but window N+1
            // sees the full citation in the overlap region and extracts it as complete.
            if (processed.complete !== false) {
                for (let k = pendingIncompleteEnd.length - 1; k >= 0; k--) {
                    if (completeSupersedes(pendingIncompleteEnd[k], processed)) {
                        // Complete extraction supersedes the incomplete - discard the incomplete
                        pendingIncompleteEnd.splice(k, 1);
                        break; // One complete can only supersede one incomplete
                    }
                }
            }

            // Case 4: Complete extraction or last window - validate immediately
            processed.id = `extraction-${extractionIndex}`;
            processed.index = extractionIndex;
            startValidation(processed);
            extractionIndex++;
        }

        // Finalize any pending "end" extractions that weren't matched
        // (The next window didn't have their continuation)
        for (const pending of pendingIncompleteEnd) {
            startValidation(pending);
        }

        // Replace pending with new candidates for next window
        pendingIncompleteEnd = newIncompleteEnd;
    }

    // Handle remaining pending extractions (last window's incomplete "end" extractions)
    if (!state.shouldCancel) {
        for (const pending of pendingIncompleteEnd) {
            startValidation(pending);
        }
    }

    // Wait for all pending validations to complete
    if (pendingValidations.length > 0) {
        onProgress?.(`Finishing ${pendingValidations.length} validations...`);
        await Promise.allSettled(pendingValidations);
    }

    // Deduplicate extractions that appeared in multiple windows (overlap region duplicates)
    const duplicatesRemoved = deduplicateExtractions(state);
    if (duplicatesRemoved > 0) {
        console.log(`Deduplication: removed ${duplicatesRemoved} duplicate extraction(s)`);
    }

    buildLineExtractionMap(state, fullText);

    return {
        totalExtractions: state.extractions.length,
        cancelled: state.shouldCancel
    };
}
