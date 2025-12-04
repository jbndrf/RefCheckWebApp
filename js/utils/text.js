/**
 * Text utility functions
 */

/**
 * Escape HTML special characters
 * Uses string replacement instead of DOM for better performance
 */
export function escapeHTML(text) {
    if (!text) return text;
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Escape special regex characters
 */
export function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Strip leading/trailing quotes from a string
 */
export function stripQuotes(str) {
    if (!str) return str;
    const quoteChars = [
        '"',      // straight double quote
        "'",      // straight single quote
        '\u201C', // left double curly quote
        '\u201D', // right double curly quote
        '\u2018', // left single curly quote
        '\u2019', // right single curly quote
        '\u00AB', // left guillemet
        '\u00BB', // right guillemet
        '`',      // backtick
        '\u2033', // double prime
        '\u2032', // single prime
    ];

    let result = str;
    while (result.length > 0 && quoteChars.includes(result[0])) {
        result = result.substring(1);
    }
    while (result.length > 0 && quoteChars.includes(result[result.length - 1])) {
        result = result.substring(0, result.length - 1);
    }
    return result;
}

/**
 * Normalize a text field for searching - strip quotes, escaped quotes, etc.
 */
export function normalizeTextField(str) {
    if (!str) return str;
    let result = str
        .replace(/\\"/g, '"')
        .replace(/\\'/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&#34;/g, '"')
        .replace(/&#39;/g, "'");
    return stripQuotes(result);
}
