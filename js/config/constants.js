/**
 * Application constants
 */

export const WINDOW_COLORS = [
    { bg: 'rgba(59, 130, 246, 0.15)', border: '#3b82f6' },   // blue
    { bg: 'rgba(16, 185, 129, 0.15)', border: '#10b981' },   // green
    { bg: 'rgba(245, 158, 11, 0.15)', border: '#f59e0b' },   // amber
    { bg: 'rgba(139, 92, 246, 0.15)', border: '#8b5cf6' },   // purple
    { bg: 'rgba(236, 72, 153, 0.15)', border: '#ec4899' },   // pink
    { bg: 'rgba(20, 184, 166, 0.15)', border: '#14b8a6' },   // teal
];

export const DEFAULT_ENDPOINTS = {
    openai: 'https://api.openai.com/v1',
    google: 'https://generativelanguage.googleapis.com/v1beta'
};

export const DEBOUNCE_DELAY = 300;
