/**
 * Tier Manager  –  v2 (server-side verification)
 *
 * Manages subscription tier and daily rate limits for the extension.
 *
 * Tiers:
 *   free  – user supplies their own Gemini Flash API key.
 *            Up to 3 bookmarks analyzed per Knowledge Base export.
 *            Client-side 50/day display counter (non-authoritative).
 *
 *   pro   – activated with a token received by email after subscribing
 *            on BuyMeACoffee. Token is verified against the XBMA Worker.
 *            Up to 50 bookmarks per export.
 *            Rate limit is enforced server-side (50 analyses/day).
 *
 * Token caching:
 *   A successful /verify response is cached in chrome.storage for 23 hours.
 *   This keeps the extension working offline and avoids a network call on
 *   every popup open. The cache is re-validated on each KB export.
 *
 * Security properties:
 *   - The Gemini Pro API key never exists in extension code.
 *   - Rate limits are enforced server-side; local counts are for display only.
 *   - Token revocation takes effect within 24 hours (next cache expiry).
 */

// ── Constants ──────────────────────────────────────────────────────────────────

// Replace with your deployed Cloudflare Worker URL after running `wrangler deploy`
const WORKER_URL = 'https://xbma-api.YOUR_SUBDOMAIN.workers.dev';

const STORAGE_KEY        = 'xbma_tier_v2';
const CACHE_TTL_MS       = 23 * 60 * 60 * 1000; // 23 hours
const FREE_DAILY_LIMIT   = 50;
const FREE_BOOKMARK_LIMIT = 3;
const PRO_BOOKMARK_LIMIT  = 50;
const PRO_DAILY_LIMIT     = 50;

// ── Storage schema ─────────────────────────────────────────────────────────────
// {
//   token: string | null,            activation token (xbma_...)
//   verifiedAt: number | null,       timestamp of last successful /verify
//   cachedResponse: object | null,   last /verify response body
//   localUsageDate: 'YYYY-MM-DD',
//   localUsageCount: number,         display-only counter for free users
// }

class TierManager {
    constructor() {
        this.FREE_BOOKMARK_LIMIT = FREE_BOOKMARK_LIMIT;
        this.PRO_BOOKMARK_LIMIT  = PRO_BOOKMARK_LIMIT;
        this.FREE_DAILY_LIMIT    = FREE_DAILY_LIMIT;
        this.WORKER_URL          = WORKER_URL;
    }

    // ── Storage helpers ────────────────────────────────────────────────────────

    async _load() {
        const raw = await chrome.storage.local.get([STORAGE_KEY]);
        return raw[STORAGE_KEY] || {
            token:            null,
            verifiedAt:       null,
            cachedResponse:   null,
            localUsageDate:   null,
            localUsageCount:  0,
        };
    }

    async _save(data) {
        await chrome.storage.local.set({ [STORAGE_KEY]: data });
    }

    _todayStr() {
        return new Date().toISOString().slice(0, 10);
    }

    // ── Token management ───────────────────────────────────────────────────────

    async getToken() {
        const state = await this._load();
        return state.token || null;
    }

    async saveToken(token) {
        const state = await this._load();
        state.token          = token;
        state.verifiedAt     = null;  // force re-verify
        state.cachedResponse = null;
        await this._save(state);
    }

    async clearToken() {
        const state = await this._load();
        state.token          = null;
        state.verifiedAt     = null;
        state.cachedResponse = null;
        await this._save(state);
    }

    // ── Verification ───────────────────────────────────────────────────────────

    /**
     * Verify the stored token against the Worker.
     * Uses cached result if < 23 hours old.
     * @param {boolean} [forceRefresh=false]
     * @returns {{ valid: boolean, tier: string, expiresAt?: string,
     *             bookmarkLimit: number, dailyLimit: number, remainingToday: number,
     *             reason?: string }}
     */
    async verifyToken(forceRefresh = false) {
        const state = await this._load();

        if (!state.token) {
            return this._freeStatus();
        }

        // Return cached result if still fresh
        if (
            !forceRefresh &&
            state.verifiedAt &&
            state.cachedResponse?.valid &&
            (Date.now() - state.verifiedAt) < CACHE_TTL_MS
        ) {
            return state.cachedResponse;
        }

        // Call /verify endpoint
        try {
            const response = await fetch(`${WORKER_URL}/verify`, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ token: state.token }),
            });

            const data = await response.json();

            if (data.valid) {
                state.verifiedAt     = Date.now();
                state.cachedResponse = data;
                await this._save(state);
                return data;
            } else {
                // Invalid/expired – keep token in storage (user can see why it failed)
                // but return the failure result
                state.cachedResponse = data;
                await this._save(state);
                return data;
            }
        } catch (err) {
            console.warn('TierManager: /verify network error:', err.message);
            // Network failure – fall back to cached result if available
            if (state.cachedResponse?.valid) {
                return { ...state.cachedResponse, _fromCache: true };
            }
            return this._freeStatus();
        }
    }

    _freeStatus() {
        return {
            valid:          false,
            tier:           'free',
            bookmarkLimit:  FREE_BOOKMARK_LIMIT,
            dailyLimit:     FREE_DAILY_LIMIT,
            remainingToday: FREE_DAILY_LIMIT,
        };
    }

    // ── Convenience accessors ──────────────────────────────────────────────────

    async isProUser() {
        const status = await this.verifyToken();
        return status.valid === true && status.tier === 'pro';
    }

    async getBookmarkLimit() {
        return (await this.isProUser()) ? PRO_BOOKMARK_LIMIT : FREE_BOOKMARK_LIMIT;
    }

    async getStatus() {
        return this.verifyToken();
    }

    // ── Local display counter (free users only) ────────────────────────────────

    async getLocalUsageCount() {
        const state = await this._load();
        const today = this._todayStr();
        if (state.localUsageDate !== today) return 0;
        return state.localUsageCount || 0;
    }

    async incrementLocalUsage(count = 1) {
        const state = await this._load();
        const today = this._todayStr();
        if (state.localUsageDate !== today) {
            state.localUsageDate  = today;
            state.localUsageCount = 0;
        }
        state.localUsageCount = Math.min(FREE_DAILY_LIMIT, (state.localUsageCount || 0) + count);
        await this._save(state);
        return state.localUsageCount;
    }

    async canAnalyzeFree() {
        const used = await this.getLocalUsageCount();
        if (used >= FREE_DAILY_LIMIT) {
            return { allowed: false, reason: `Daily limit of ${FREE_DAILY_LIMIT} reached. Resets at midnight.` };
        }
        return { allowed: true, reason: null };
    }

    // ── Activation / deactivation (UI entry points) ────────────────────────────

    /**
     * Validate and save a new activation token.
     * Returns { success, message, status }.
     * @param {string} rawToken
     */
    async activateToken(rawToken) {
        const token = (rawToken || '').trim();

        if (!token) {
            return { success: false, message: 'Please enter your activation token.' };
        }
        if (!token.startsWith('xbma_')) {
            return { success: false, message: 'Invalid token format. Tokens start with "xbma_".' };
        }

        // Save and verify immediately
        await this.saveToken(token);
        const status = await this.verifyToken(true);

        if (status.valid) {
            const expires = status.expiresAt
                ? new Date(status.expiresAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
                : 'see subscription page';
            return {
                success: true,
                message: `Pro activated! Access valid until ${expires}.`,
                status,
            };
        } else {
            await this.clearToken();
            return {
                success: false,
                message: status.reason || 'Token verification failed. Please check your token and try again.',
            };
        }
    }

    async deactivate() {
        await this.clearToken();
    }

    // ── On-startup re-validation ───────────────────────────────────────────────

    /**
     * Called once on popup open. Re-validates cached token if it's stale.
     * Does NOT block startup – runs in background.
     */
    async revalidateSavedLicense() {
        const state = await this._load();
        if (!state.token) return;

        const age = state.verifiedAt ? Date.now() - state.verifiedAt : Infinity;
        if (age > CACHE_TTL_MS) {
            // Re-verify in background; don't await
            this.verifyToken(true).catch(err =>
                console.warn('Background re-verify failed:', err.message)
            );
        }
    }
}

module.exports = { TierManager, WORKER_URL };
