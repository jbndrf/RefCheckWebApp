/**
 * Citation validation service
 */

import * as crossref from '../api/crossref.js';
import * as openalex from '../api/openalex.js';
import { stringSimilarity } from '../utils/similarity.js';

/**
 * Field weights for match scoring
 * Higher weights = more important for determining if citations match
 * Core fields (title, authors, year) heavily weighted - they determine validity
 * Secondary fields (journal, volume, pages) have minimal impact
 */
const FIELD_WEIGHTS = {
    title: 10.0,       // Title is critical
    authors: 8.0,      // Authors are critical
    year: 6.0,         // Year is very important
    journal: 0.5,      // Journal name (helpful but not critical, often abbreviated)
    volume: 0.2,       // Volume number (minor detail)
    pages: 0.2,        // Page numbers (minor detail)
    doi: 1.0,          // DOI match (when comparing against search results)
};

/**
 * Thresholds for validation status
 */
const THRESHOLDS = {
    valid: 0.90,       // Above this = valid match (strict: valid refs have ~95% overlap)
    suspicious: 0.70,  // Between suspicious and valid = needs review
    // Below suspicious = mismatch
};

/**
 * Normalize CrossRef response to common format
 */
function normalizeCrossRef(result) {
    if (!result) return null;

    return {
        title: result.title?.[0] || '',
        authors: (result.author || []).map(a => ({
            family: a.family || '',
            given: a.given || ''
        })),
        year: result['published-print']?.['date-parts']?.[0]?.[0]
            || result.issued?.['date-parts']?.[0]?.[0]
            || null,
        journal: result['container-title']?.[0] || '',
        volume: result.volume || '',
        pages: result.page || '',
        doi: result.DOI || '',
    };
}

/**
 * Normalize OpenAlex response to common format
 */
function normalizeOpenAlex(result) {
    if (!result) return null;

    const firstPage = result.biblio?.first_page || '';
    const lastPage = result.biblio?.last_page || '';
    const pages = firstPage && lastPage ? `${firstPage}-${lastPage}` : firstPage;

    return {
        title: result.title || '',
        authors: (result.authorships || []).map(a => ({
            family: a.author?.display_name?.split(' ').pop() || '',
            given: a.author?.display_name?.split(' ').slice(0, -1).join(' ') || ''
        })),
        year: result.publication_year || null,
        journal: result.primary_location?.source?.display_name || '',
        volume: result.biblio?.volume || '',
        pages: pages,
        doi: result.doi?.replace('https://doi.org/', '') || '',
    };
}

/**
 * Normalize extracted citation to common format
 */
function normalizeExtracted(citation) {
    // Handle authors - could be string or array
    let authors = [];
    if (Array.isArray(citation.authors)) {
        authors = citation.authors.map(a => {
            if (typeof a === 'string') {
                const parts = a.split(/,\s*/);
                return { family: parts[0] || '', given: parts[1] || '' };
            }
            return { family: a.family || a.lastName || '', given: a.given || a.firstName || '' };
        });
    } else if (typeof citation.authors === 'string') {
        authors = citation.authors.split(/;\s*/).map(name => {
            const parts = name.split(/,\s*/);
            return { family: parts[0] || '', given: parts[1] || '' };
        });
    }

    return {
        title: citation.title || '',
        authors: authors,
        year: citation.year ? parseInt(citation.year, 10) : null,
        journal: citation.container_title || citation.journal || '',
        volume: citation.volume || '',
        pages: citation.pages || citation.page || '',
        doi: citation.doi || '',
    };
}

/**
 * Compare two author lists
 * Returns similarity score 0-1
 */
function compareAuthors(extracted, validated) {
    if (!extracted.length || !validated.length) return 0;

    // Compare first author (most reliable)
    const ext1 = extracted[0]?.family?.toLowerCase() || '';
    const val1 = validated[0]?.family?.toLowerCase() || '';

    if (!ext1 || !val1) return 0;

    const firstAuthorSim = stringSimilarity(ext1, val1);

    // If we have multiple authors, also check last author
    if (extracted.length > 1 && validated.length > 1) {
        const extLast = extracted[extracted.length - 1]?.family?.toLowerCase() || '';
        const valLast = validated[validated.length - 1]?.family?.toLowerCase() || '';
        const lastAuthorSim = stringSimilarity(extLast, valLast);

        // Weight first author more heavily
        return (firstAuthorSim * 0.7) + (lastAuthorSim * 0.3);
    }

    return firstAuthorSim;
}

/**
 * Compare page numbers (handles different formats like "806-14" vs "806-814")
 */
function comparePages(pages1, pages2) {
    if (!pages1 || !pages2) return 0;

    // Normalize page formats
    const normalize = (p) => {
        const match = String(p).match(/(\d+)[-–](\d+)/);
        if (match) {
            const start = parseInt(match[1], 10);
            let end = parseInt(match[2], 10);
            // Handle abbreviated end pages like "806-14" meaning "806-814"
            if (end < start) {
                const startStr = String(start);
                const endStr = String(end);
                end = parseInt(startStr.slice(0, -endStr.length) + endStr, 10);
            }
            return `${start}-${end}`;
        }
        return String(p).trim();
    };

    return normalize(pages1) === normalize(pages2) ? 1 : 0;
}

/**
 * Compute comprehensive match score between extracted citation and validation result
 * Returns object with overall score and per-field breakdown
 */
export function computeMatchScore(extracted, validated) {
    const extNorm = normalizeExtracted(extracted);
    const valNorm = validated;

    const fieldScores = {};
    let totalWeight = 0;
    let weightedSum = 0;

    // Title comparison
    if (extNorm.title && valNorm.title) {
        fieldScores.title = stringSimilarity(
            extNorm.title.toLowerCase(),
            valNorm.title.toLowerCase()
        );
        weightedSum += fieldScores.title * FIELD_WEIGHTS.title;
        totalWeight += FIELD_WEIGHTS.title;
    }

    // Author comparison
    if (extNorm.authors.length && valNorm.authors.length) {
        fieldScores.authors = compareAuthors(extNorm.authors, valNorm.authors);
        weightedSum += fieldScores.authors * FIELD_WEIGHTS.authors;
        totalWeight += FIELD_WEIGHTS.authors;
    }

    // Year comparison (exact match)
    if (extNorm.year && valNorm.year) {
        fieldScores.year = extNorm.year === valNorm.year ? 1 : 0;
        weightedSum += fieldScores.year * FIELD_WEIGHTS.year;
        totalWeight += FIELD_WEIGHTS.year;
    }

    // Journal comparison
    if (extNorm.journal && valNorm.journal) {
        fieldScores.journal = stringSimilarity(
            extNorm.journal.toLowerCase(),
            valNorm.journal.toLowerCase()
        );
        weightedSum += fieldScores.journal * FIELD_WEIGHTS.journal;
        totalWeight += FIELD_WEIGHTS.journal;
    }

    // Volume comparison (exact match)
    if (extNorm.volume && valNorm.volume) {
        fieldScores.volume = String(extNorm.volume) === String(valNorm.volume) ? 1 : 0;
        weightedSum += fieldScores.volume * FIELD_WEIGHTS.volume;
        totalWeight += FIELD_WEIGHTS.volume;
    }

    // Pages comparison
    if (extNorm.pages && valNorm.pages) {
        fieldScores.pages = comparePages(extNorm.pages, valNorm.pages);
        weightedSum += fieldScores.pages * FIELD_WEIGHTS.pages;
        totalWeight += FIELD_WEIGHTS.pages;
    }

    const overallScore = totalWeight > 0 ? weightedSum / totalWeight : 0;

    return {
        overall: overallScore,
        fields: fieldScores,
        fieldsCompared: Object.keys(fieldScores).length,
    };
}

/**
 * Determine validation status based on match score
 */
function getValidationStatus(matchScore, lookupMethod) {
    if (matchScore.overall >= THRESHOLDS.valid) {
        return {
            status: 'valid',
            message: `${lookupMethod} (${Math.round(matchScore.overall * 100)}% match)`
        };
    } else if (matchScore.overall >= THRESHOLDS.suspicious) {
        return {
            status: 'suspicious',
            message: `${lookupMethod} - possible mismatch (${Math.round(matchScore.overall * 100)}% match)`
        };
    } else {
        return {
            status: 'mismatch',
            message: `${lookupMethod} - content mismatch (${Math.round(matchScore.overall * 100)}% match)`
        };
    }
}

/**
 * Validate a citation against CrossRef and OpenAlex
 * Runs lookups in parallel where possible for speed
 */
export async function validateCitation(citation, userEmail = '') {
    citation.validation = {};

    // Step 1: Try DOI lookup first if available - run CrossRef and OpenAlex in parallel
    if (citation.doi) {
        try {
            const [crossRefResult, openAlexResult] = await Promise.all([
                crossref.lookupDOI(citation.doi, userEmail).catch(() => null),
                openalex.lookupDOI(citation.doi, userEmail).catch(() => null)
            ]);

            if (crossRefResult) {
                citation.validation.crossref = crossRefResult;

                // Compute match score against extracted citation
                const normalized = normalizeCrossRef(crossRefResult);
                const matchScore = computeMatchScore(citation, normalized);
                citation.validation.matchScore = matchScore;

                const { status, message } = getValidationStatus(matchScore, 'DOI verified via CrossRef');
                citation.validationStatus = status;
                citation.validationMessage = message;

                if (openAlexResult) {
                    citation.validation.openalex = openAlexResult;
                }
                return;
            }

            // CrossRef failed but OpenAlex succeeded
            if (openAlexResult) {
                citation.validation.openalex = openAlexResult;

                // Compute match score against extracted citation
                const normalized = normalizeOpenAlex(openAlexResult);
                const matchScore = computeMatchScore(citation, normalized);
                citation.validation.matchScore = matchScore;

                const { status, message } = getValidationStatus(matchScore, 'DOI verified via OpenAlex');
                citation.validationStatus = status;
                citation.validationMessage = message;
                return;
            }
        } catch (e) {
            // DOI lookup failed, try next step
        }
    }

    // Step 2: Try PMID lookup if available
    if (citation.pmid) {
        try {
            const openAlexResult = await openalex.lookupPMID(citation.pmid, userEmail);
            if (openAlexResult) {
                citation.validation.openalex = openAlexResult;

                // Compute match score against extracted citation
                const normalized = normalizeOpenAlex(openAlexResult);
                const matchScore = computeMatchScore(citation, normalized);
                citation.validation.matchScore = matchScore;

                const { status, message } = getValidationStatus(matchScore, 'PMID verified via OpenAlex');
                citation.validationStatus = status;
                citation.validationMessage = message;
                return;
            }
        } catch (e) {
            // PMID lookup failed
        }
    }

    // Step 3: Try bibliographic query
    if (citation.query_bibliographic || citation.raw_text) {
        try {
            const query = citation.query_bibliographic || buildBibliographicQuery(citation);
            const crossRefResults = await crossref.searchBibliographic(query, userEmail);

            if (crossRefResults && crossRefResults.length > 0) {
                const match = findBestMatch(citation, crossRefResults);
                if (match) {
                    citation.validation.crossref = match.result;
                    citation.validation.matchScore = match.score;

                    const { status, message } = getValidationStatus(
                        match.score,
                        'Matched via bibliographic search'
                    );
                    citation.validationStatus = status;
                    citation.validationMessage = message;
                    return;
                }
            }
        } catch (e) {
            console.error('Bibliographic search failed:', e);
        }
    }

    // No validation found
    citation.validationStatus = 'invalid';
    citation.validationMessage = 'Could not verify citation';
}

/**
 * Build bibliographic query from citation fields
 */
function buildBibliographicQuery(citation) {
    const parts = [];

    if (citation.authors && citation.authors.length > 0) {
        const firstAuthor = citation.authors[0];
        if (firstAuthor.family) parts.push(firstAuthor.family);
    }

    if (citation.year) parts.push(citation.year);

    if (citation.title) {
        const titleWords = citation.title.split(/\s+/).slice(0, 5).join(' ');
        parts.push(titleWords);
    }

    if (citation.container_title) {
        parts.push(citation.container_title);
    }

    return parts.join(' ');
}

/**
 * Find best matching result from CrossRef results
 * Returns { result, score } or null
 */
function findBestMatch(citation, results) {
    let bestMatch = null;
    let bestScore = null;

    for (const result of results) {
        const normalized = normalizeCrossRef(result);
        const matchScore = computeMatchScore(citation, normalized);

        if (!bestScore || matchScore.overall > bestScore.overall) {
            bestScore = matchScore;
            bestMatch = result;
        }
    }

    if (bestMatch) {
        return { result: bestMatch, score: bestScore };
    }

    return null;
}
