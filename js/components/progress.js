/**
 * Progress bar component
 */

/**
 * Update progress display
 */
export function updateProgress(elements, current, total, message) {
    const { progressFill, progressText } = elements;
    const percent = total > 0 ? (current / total) * 100 : 0;
    progressFill.style.width = `${percent}%`;
    progressText.textContent = message;
}

/**
 * Update progress details
 */
export function updateProgressDetails(elements, message) {
    elements.progressDetails.textContent = message;
}

/**
 * Show progress container
 */
export function showProgress(elements) {
    elements.progressContainer.style.display = 'block';
}

/**
 * Hide progress container
 */
export function hideProgress(elements) {
    elements.progressContainer.style.display = 'none';
}
