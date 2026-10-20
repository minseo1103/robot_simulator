/**
 * Privacy-friendly event helper for the static simulator.
 * No third-party script, account, or API key.
 *
 * Named events are delivered to an optional hook when one is installed:
 *   window.__RS_ANALYTICS__ = (name, detail) => { ... }
 *
 * Console logging is enabled on localhost (and 127.0.0.1) and whenever
 * localStorage['rs_analytics'] === '1'. Otherwise, with no hook, calls
 * are a no-op.
 */

const DEBUG_FLAG = 'rs_analytics';

function consoleEnabled() {
    try {
        const host = location.hostname;
        if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
            return true;
        }
        return localStorage.getItem(DEBUG_FLAG) === '1';
    } catch (_) {
        return false;
    }
}

/**
 * @param {string} name
 * @param {Record<string, unknown>} [detail]
 */
export function track(name, detail) {
    const payload = detail && typeof detail === 'object' ? detail : {};

    try {
        const hook = window.__RS_ANALYTICS__;
        if (typeof hook === 'function') {
            hook(name, payload);
        }
    } catch (err) {
        if (consoleEnabled()) {
            console.warn('[rs-analytics] hook error', err);
        }
    }

    if (consoleEnabled()) {
        console.info('[rs-analytics]', name, payload);
    }
}
