/**
 * Windowing module - splits text into overlapping windows for LLM processing
 * Uses character-based windowing for reliable text chunking
 */

/**
 * Split text into overlapping windows based on character count
 * @param {string} text - The full bibliography text
 * @param {number} windowSize - Number of characters per window
 * @param {number} overlap - Number of overlapping characters between windows
 * @returns {Array<{index: number, start: number, end: number, length: number, text: string}>}
 */
function createWindows(text, windowSize, overlap) {
    if (!text || !text.trim()) {
        return [];
    }

    // Defaults for character-based windowing
    if (windowSize <= 0) windowSize = 2000;
    if (overlap < 0) overlap = 0;
    if (overlap >= windowSize) overlap = windowSize - 1;

    const windows = [];
    const step = windowSize - overlap;
    let start = 0;
    let windowIndex = 0;

    while (start < text.length) {
        const end = Math.min(start + windowSize, text.length);
        const windowText = text.slice(start, end);

        windows.push({
            index: windowIndex,
            start: start,
            end: end,
            length: end - start,
            text: windowText
        });

        windowIndex++;
        start += step;

        // Avoid tiny final windows
        if (start < text.length && text.length - start < step) {
            const finalStart = Math.max(0, text.length - windowSize);
            if (finalStart > windows[windows.length - 1].start) {
                windows.push({
                    index: windowIndex,
                    start: finalStart,
                    end: text.length,
                    length: text.length - finalStart,
                    text: text.slice(finalStart)
                });
            }
            break;
        }
    }

    return windows;
}

/**
 * Get statistics about the windowing
 * @param {string} text - Original text
 * @param {Array} windows - Array of windows
 * @returns {Object} - Statistics
 */
function getWindowStats(text, windows) {
    return {
        totalChars: text ? text.length : 0,
        windowCount: windows.length,
        avgCharsPerWindow: windows.length > 0
            ? Math.round(windows.reduce((sum, w) => sum + w.length, 0) / windows.length)
            : 0
    };
}

// Export
window.Windowing = {
    createWindows,
    getWindowStats
};
