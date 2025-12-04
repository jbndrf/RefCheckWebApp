/**
 * String similarity utilities
 */

/**
 * Simple string similarity (Jaccard-like)
 * Optimized to avoid intermediate array allocations
 */
export function stringSimilarity(str1, str2) {
    if (!str1 || !str2) return 0;

    const words1 = new Set(str1.toLowerCase().split(/\s+/));
    const words2 = new Set(str2.toLowerCase().split(/\s+/));

    // Count intersection directly without creating intermediate array
    let intersectionSize = 0;
    for (const word of words1) {
        if (words2.has(word)) {
            intersectionSize++;
        }
    }

    // Union size = |A| + |B| - |intersection|
    const unionSize = words1.size + words2.size - intersectionSize;

    return unionSize > 0 ? intersectionSize / unionSize : 0;
}
