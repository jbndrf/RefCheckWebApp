/**
 * Rate limiter utility for controlling API request concurrency and rate
 */

/**
 * RateLimiter class that manages concurrent requests and requests per minute
 */
export class RateLimiter {
    /**
     * @param {Object} options
     * @param {number} options.maxConcurrent - Maximum concurrent requests (default: Infinity)
     * @param {number} options.requestsPerMinute - Max requests per minute (default: Infinity)
     */
    constructor(options = {}) {
        this.maxConcurrent = options.maxConcurrent || Infinity;
        this.requestsPerMinute = options.requestsPerMinute || Infinity;

        this.activeRequests = 0;
        this.requestTimestamps = [];
        this.queue = [];
    }

    /**
     * Clean up old timestamps outside the 1-minute window
     */
    _cleanTimestamps() {
        const oneMinuteAgo = Date.now() - 60000;
        this.requestTimestamps = this.requestTimestamps.filter(ts => ts > oneMinuteAgo);
    }

    /**
     * Check if a request can proceed based on rate limits
     */
    _canProceed() {
        this._cleanTimestamps();

        const concurrencyOk = this.activeRequests < this.maxConcurrent;
        const rateOk = this.requestTimestamps.length < this.requestsPerMinute;

        return concurrencyOk && rateOk;
    }

    /**
     * Calculate delay needed before next request can proceed
     */
    _getDelayMs() {
        this._cleanTimestamps();

        // If rate limit would be exceeded, calculate when oldest request expires
        if (this.requestTimestamps.length >= this.requestsPerMinute) {
            const oldestTimestamp = this.requestTimestamps[0];
            const delayNeeded = (oldestTimestamp + 60000) - Date.now();
            return Math.max(0, delayNeeded + 10); // Add small buffer
        }

        return 0;
    }

    /**
     * Process the queue
     */
    async _processQueue() {
        while (this.queue.length > 0 && this._canProceed()) {
            const { task, resolve, reject } = this.queue.shift();
            this._executeTask(task, resolve, reject);
        }
    }

    /**
     * Execute a task with tracking
     */
    async _executeTask(task, resolve, reject) {
        this.activeRequests++;
        this.requestTimestamps.push(Date.now());

        try {
            const result = await task();
            resolve(result);
        } catch (error) {
            reject(error);
        } finally {
            this.activeRequests--;
            this._processQueue();
        }
    }

    /**
     * Schedule a task to run when rate limits allow
     * @param {Function} task - Async function to execute
     * @returns {Promise} - Resolves with task result
     */
    async schedule(task) {
        return new Promise((resolve, reject) => {
            if (this._canProceed()) {
                this._executeTask(task, resolve, reject);
            } else {
                this.queue.push({ task, resolve, reject });

                // Set a timeout to retry processing the queue
                const delay = this._getDelayMs();
                if (delay > 0) {
                    setTimeout(() => this._processQueue(), delay);
                }
            }
        });
    }

    /**
     * Run multiple tasks with rate limiting, maintaining order
     * @param {Array<Function>} tasks - Array of async functions
     * @param {Function} onComplete - Called after each task completes (index, result)
     * @returns {Promise<Array>} - Results in order
     */
    async runAll(tasks, onComplete = null) {
        const results = new Array(tasks.length);
        const promises = tasks.map((task, index) =>
            this.schedule(task).then(result => {
                results[index] = result;
                if (onComplete) {
                    onComplete(index, result);
                }
                return result;
            })
        );

        await Promise.all(promises);
        return results;
    }

    /**
     * Run tasks in parallel batches with concurrency limit
     * Results are yielded as they complete (not in order)
     * @param {Array<Function>} tasks - Array of async functions
     * @param {Function} onComplete - Called after each task completes (index, result)
     * @returns {Promise<Array>} - Results in original order
     */
    async runAllSettled(tasks, onComplete = null) {
        const results = new Array(tasks.length);
        const promises = tasks.map((task, index) =>
            this.schedule(task)
                .then(result => {
                    results[index] = { status: 'fulfilled', value: result };
                    if (onComplete) {
                        onComplete(index, result, null);
                    }
                })
                .catch(error => {
                    results[index] = { status: 'rejected', reason: error };
                    if (onComplete) {
                        onComplete(index, null, error);
                    }
                })
        );

        await Promise.all(promises);
        return results;
    }
}

/**
 * Create a rate limiter for validation API requests (RPM-focused)
 */
export function createValidationRateLimiter(requestsPerMinute = 50) {
    return new RateLimiter({
        maxConcurrent: 10, // Reasonable concurrency for validation
        requestsPerMinute
    });
}
