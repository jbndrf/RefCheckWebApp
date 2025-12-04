/**
 * CrossRef API client
 */

/**
 * Lookup DOI in CrossRef
 */
export async function lookupDOI(doi, userEmail = '') {
    const mailto = userEmail ? `mailto=${encodeURIComponent(userEmail)}` : '';
    const url = `https://api.crossref.org/works/${encodeURIComponent(doi)}${mailto ? '?' + mailto : ''}`;

    const response = await fetch(url);
    if (!response.ok) {
        if (response.status === 404) return null;
        throw new Error(`CrossRef error: ${response.status}`);
    }

    const data = await response.json();
    return data.message;
}

/**
 * Search CrossRef using bibliographic query
 */
export async function searchBibliographic(query, userEmail = '') {
    const mailto = userEmail ? `mailto=${encodeURIComponent(userEmail)}` : '';
    const url = `https://api.crossref.org/works?query.bibliographic=${encodeURIComponent(query)}&rows=5${mailto ? '&' + mailto : ''}`;

    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`CrossRef search error: ${response.status}`);
    }

    const data = await response.json();
    return data.message.items || [];
}
