/**
 * OpenAlex API client
 */

/**
 * Lookup DOI in OpenAlex
 */
export async function lookupDOI(doi, userEmail = '') {
    const mailto = userEmail ? `mailto=${encodeURIComponent(userEmail)}` : '';
    const fullDoi = doi.startsWith('http') ? doi : `https://doi.org/${doi}`;
    const url = `https://api.openalex.org/works/${encodeURIComponent(fullDoi)}${mailto ? '?' + mailto : ''}`;

    const response = await fetch(url);
    if (!response.ok) {
        if (response.status === 404) return null;
        throw new Error(`OpenAlex error: ${response.status}`);
    }

    return await response.json();
}

/**
 * Lookup PMID in OpenAlex
 */
export async function lookupPMID(pmid, userEmail = '') {
    const mailto = userEmail ? `mailto=${encodeURIComponent(userEmail)}` : '';
    const url = `https://api.openalex.org/works/pmid:${pmid}${mailto ? '?' + mailto : ''}`;

    const response = await fetch(url);
    if (!response.ok) {
        if (response.status === 404) return null;
        throw new Error(`OpenAlex error: ${response.status}`);
    }

    return await response.json();
}
