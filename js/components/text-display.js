/**
 * Text display component - window visualization
 */

import { WINDOW_COLORS } from '../config/constants.js';
import { escapeHTML } from '../utils/text.js';

/**
 * Render windowed text display with character-based highlighting
 */
export function renderTextDisplay(textDisplay, text, windows) {
    if (!text.trim() || windows.length === 0) {
        textDisplay.innerHTML = '<span class="placeholder">Windows will be highlighted here...</span>';
        return;
    }

    // Build segments with window assignments
    const segments = buildSegments(text, windows);
    let html = '';

    for (const segment of segments) {
        const color = WINDOW_COLORS[segment.primaryWindow % WINDOW_COLORS.length];
        const isOverlap = segment.windows.length > 1;
        const windowIds = segment.windows.join(',');

        let classes = ['text-segment'];
        if (isOverlap) classes.push('overlap-segment');

        // Add window start marker
        if (segment.isWindowStart) {
            const wColor = WINDOW_COLORS[segment.startingWindow % WINDOW_COLORS.length];
            html += `<span class="window-marker" style="background: ${wColor.border}">W${segment.startingWindow + 1}</span>`;
        }

        const style = `background: ${color.bg};`;
        const escapedText = escapeHTML(segment.text).replace(/\n/g, '<br>');

        html += `<span class="${classes.join(' ')}" style="${style}" data-windows="${windowIds}">${escapedText}</span>`;
    }

    textDisplay.innerHTML = `<div class="text-content">${html}</div>`;
}

/**
 * Build text segments based on window boundaries
 */
function buildSegments(text, windows) {
    // Collect all boundary points
    const boundaries = new Set([0, text.length]);
    for (const w of windows) {
        boundaries.add(w.start);
        boundaries.add(w.end);
    }

    const sortedBoundaries = [...boundaries].sort((a, b) => a - b);
    const segments = [];

    for (let i = 0; i < sortedBoundaries.length - 1; i++) {
        const start = sortedBoundaries[i];
        const end = sortedBoundaries[i + 1];

        if (start >= end) continue;

        // Find which windows contain this segment
        const containingWindows = windows
            .filter(w => start >= w.start && end <= w.end)
            .map(w => w.index);

        if (containingWindows.length === 0) continue;

        // Check if this is a window start
        const startingWindow = windows.find(w => w.start === start);

        segments.push({
            start,
            end,
            text: text.slice(start, end),
            windows: containingWindows,
            primaryWindow: containingWindows[0],
            isWindowStart: !!startingWindow,
            startingWindow: startingWindow ? startingWindow.index : null
        });
    }

    return segments;
}

/**
 * Add hover listeners for window visualization
 */
export function addWindowHoverListeners(textDisplay) {
    const segments = textDisplay.querySelectorAll('.text-segment');

    segments.forEach(segment => {
        segment.addEventListener('mouseenter', (e) => handleSegmentHover(e, textDisplay));
        segment.addEventListener('mouseleave', () => handleSegmentLeave(textDisplay));
    });
}

function handleSegmentHover(e, textDisplay) {
    const hoveredSegment = e.currentTarget;
    const windowIds = hoveredSegment.dataset.windows;

    if (!windowIds) return;

    const windowIdArray = windowIds.split(',').map(Number);

    const allSegments = textDisplay.querySelectorAll('.text-segment');
    allSegments.forEach(segment => {
        const segmentWindows = (segment.dataset.windows || '').split(',').map(Number);
        const hasOverlap = windowIdArray.some(wid => segmentWindows.includes(wid));

        if (hasOverlap) {
            segment.classList.add('window-hover');
        }
    });
}

function handleSegmentLeave(textDisplay) {
    const allSegments = textDisplay.querySelectorAll('.text-segment');
    allSegments.forEach(segment => {
        segment.classList.remove('window-hover');
    });
}

/**
 * Render stats display
 */
export function renderStats(statsDisplay, text, windows) {
    if (!text.trim() || windows.length === 0) {
        statsDisplay.innerHTML = '';
        return;
    }

    const stats = window.Windowing.getWindowStats(text, windows);
    statsDisplay.innerHTML = `
        <span class="stat-item">Chars: <strong>${stats.totalChars}</strong></span>
        <span class="stat-item">Windows: <strong>${stats.windowCount}</strong></span>
    `;
}
