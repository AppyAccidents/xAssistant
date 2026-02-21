/**
 * Tier Manager
 *
 * Handles free vs Pro subscription tiers, daily rate limiting, and
 * BuyMeACoffee license key validation.
 *
 * Tiers:
 *   Free  – user supplies their own Gemini Flash API key.
 *            Up to FREE_BOOKMARK_LIMIT (3) bookmarks per KB export.
 *            Shared 50/day rate limit.
 *   Pro   – activated with a BuyMeACoffee license key.
 *            Up to PRO_BOOKMARK_LIMIT (50) bookmarks per KB export.
 *            Same 50/day rate limit (per-device).
 *
 * License key format (v1):
 *   XBMA-<BASE36(YYMM)>-<5 random BASE36 chars>-<2 char checksum>
 *   e.g.  XBMA-2B3E-K9ZFM-R4
 *
 * The checksum is computed as:
 *   sum of all alphanumeric chars (uppercase) ASCII codes mod 1295  → base36, zero-padded to 2 chars
 *   (1295 = 36^2 − 1)
 */

const STORAGE_KEY = 'xbma_tier';
const DAILY_LIMIT = 50;           // global daily cap regardless of tier
const FREE_BOOKMARK_LIMIT = 3;    // bookmarks analyzed free per export
const PRO_BOOKMARK_LIMIT = 50;    // bookmarks analyzed pro per export

// Simple product prefix check
const KEY_PREFIX = 'XBMA';

/**
 * Compute a 2-char base36 checksum over the alphanumeric characters of a key.
 * @param {string} key – raw key string (will be uppercased)
 * @returns {string} 2-char uppercase base36 checksum
 */
function computeChecksum(key) {
    const cleaned = key.toUpperCase().replace(/[^A-Z0-9]/g, '');
    let sum = 0;
    for (let i = 0; i < cleaned.length; i++) {
        sum += cleaned.charCodeAt(i);
    }
    const value = sum % 1295; // 36^2 - 1
    return value.toString(36).toUpperCase().padStart(2, '0');
}

/**
 * Parse and validate a license key.
 * Returns { valid, tier, expiresYYMM, error }.
 * @param {string} rawKey
 */
function parseLicenseKey(rawKey) {
    if (!rawKey || typeof rawKey !== 'string') {
        return { valid: false, error: 'No key provided.' };
    }

    const key = rawKey.trim().toUpperCase();
    const parts = key.split('-');

    // Format: XBMA-YYMM-XXXXX-CC  (4 segments)
    if (parts.length !== 4) {
        return { valid: false, error: 'Invalid key format. Expected XBMA-YYMM-XXXXX-CC.' };
    }

    const [prefix, datePart, randomPart, checkPart] = parts;

    if (prefix !== KEY_PREFIX) {
        return { valid: false, error: 'Invalid key prefix.' };
    }

    if (!/^[0-9A-Z]{4}$/.test(datePart)) {
        return { valid: false, error: 'Invalid date segment in key.' };
    }

    if (!/^[0-9A-Z]{5}$/.test(randomPart)) {
        return { valid: false, error: 'Invalid random segment in key.' };
    }

    if (!/^[0-9A-Z]{2}$/.test(checkPart)) {
        return { valid: false, error: 'Invalid checksum segment in key.' };
    }

    // Validate checksum – computed over prefix+datePart+randomPart
    const bodyForCheck = `${prefix}-${datePart}-${randomPart}`;
    const expected = computeChecksum(bodyForCheck);
    if (expected !== checkPart) {
        return { valid: false, error: 'License key checksum mismatch.' };
    }

    // Decode YYMM from base36
    const yymmDecoded = parseInt(datePart, 36);
    const yy = Math.floor(yymmDecoded / 100);
    const mm = yymmDecoded % 100;

    if (mm < 1 || mm > 12) {
        return { valid: false, error: 'Invalid date encoded in key.' };
    }

    // Keys are valid for the month they are issued + 1 month grace period
    const now = new Date();
    const nowYY = now.getFullYear() % 100;
    const nowMM = now.getMonth() + 1;

    // Build numeric comparison values
    const keyDate = yy * 100 + mm;
    const nowDate = nowYY * 100 + nowMM;

    // Key is valid if its encoded date is within ±13 months of now
    // (this allows annual keys encoded with expiry month)
    const diff = nowDate - keyDate;
    if (diff > 13 || diff < -1) {
        return { valid: false, error: 'License key has expired or is not yet valid.' };
    }

    return {
        valid: true,
        tier: 'pro',
        expiresYYMM: `${String(yy).padStart(2, '0')}${String(mm).padStart(2, '0')}`,
        error: null
    };
}

/**
 * Generate a new license key (use this in your admin tool / BMC thank-you webhook).
 * @param {number} [validMonths=1] – number of months the key stays valid (encoded as expiry month)
 * @returns {string} license key
 */
function generateLicenseKey(validMonths = 1) {
    const now = new Date();
    let expireMonth = now.getMonth() + 1 + (validMonths - 1);
    let expireYear = now.getFullYear() % 100;
    while (expireMonth > 12) {
        expireMonth -= 12;
        expireYear += 1;
    }
    const yymmNum = expireYear * 100 + expireMonth;
    const datePart = yymmNum.toString(36).toUpperCase().padStart(4, '0');

    // 5-char random alphanumeric
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let randomPart = '';
    for (let i = 0; i < 5; i++) {
        randomPart += chars[Math.floor(Math.random() * chars.length)];
    }

    const bodyForCheck = `${KEY_PREFIX}-${datePart}-${randomPart}`;
    const checkPart = computeChecksum(bodyForCheck);

    return `${KEY_PREFIX}-${datePart}-${randomPart}-${checkPart}`;
}

/**
 * TierManager – singleton-style class stored in chrome.storage.local.
 */
class TierManager {
    constructor() {
        this.DAILY_LIMIT = DAILY_LIMIT;
        this.FREE_BOOKMARK_LIMIT = FREE_BOOKMARK_LIMIT;
        this.PRO_BOOKMARK_LIMIT = PRO_BOOKMARK_LIMIT;
    }

    // ─── Storage helpers ─────────────────────────────────────────────────────

    async _load() {
        const raw = await chrome.storage.local.get([STORAGE_KEY]);
        return raw[STORAGE_KEY] || {
            tier: 'free',
            licenseKey: null,
            licenseValidated: false,
            usageDate: null,   // 'YYYY-MM-DD'
            usageCount: 0,
        };
    }

    async _save(data) {
        await chrome.storage.local.set({ [STORAGE_KEY]: data });
    }

    // ─── Date helpers ─────────────────────────────────────────────────────────

    _todayStr() {
        return new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'
    }

    // ─── Core API ─────────────────────────────────────────────────────────────

    /**
     * Load current state, resetting daily usage if the date has changed.
     */
    async getState() {
        const state = await this._load();
        const today = this._todayStr();

        if (state.usageDate !== today) {
            state.usageDate = today;
            state.usageCount = 0;
            await this._save(state);
        }

        return state;
    }

    async isProUser() {
        const state = await this.getState();
        return state.tier === 'pro' && state.licenseValidated;
    }

    async getBookmarkLimit() {
        return (await this.isProUser()) ? PRO_BOOKMARK_LIMIT : FREE_BOOKMARK_LIMIT;
    }

    async getRemainingAnalyses() {
        const state = await this.getState();
        return Math.max(0, DAILY_LIMIT - state.usageCount);
    }

    async getUsageToday() {
        const state = await this.getState();
        return state.usageCount;
    }

    /**
     * Check whether the user can run another analysis.
     * Returns { allowed, reason }.
     */
    async canAnalyze() {
        const state = await this.getState();
        if (state.usageCount >= DAILY_LIMIT) {
            return {
                allowed: false,
                reason: `Daily limit of ${DAILY_LIMIT} analyses reached. Resets at midnight.`
            };
        }
        return { allowed: true, reason: null };
    }

    /**
     * Increment daily usage counter by `count` (default 1).
     */
    async incrementUsage(count = 1) {
        const state = await this.getState();
        state.usageCount = Math.min(DAILY_LIMIT, state.usageCount + count);
        await this._save(state);
        return state.usageCount;
    }

    // ─── License management ───────────────────────────────────────────────────

    /**
     * Validate and activate a BuyMeACoffee license key.
     * Returns { success, message }.
     */
    async activateLicense(rawKey) {
        const parsed = parseLicenseKey(rawKey);
        if (!parsed.valid) {
            return { success: false, message: parsed.error };
        }

        const state = await this.getState();
        state.tier = 'pro';
        state.licenseKey = rawKey.trim().toUpperCase();
        state.licenseValidated = true;
        await this._save(state);

        return {
            success: true,
            message: `Pro activated! License valid through 20${parsed.expiresYYMM.slice(0, 2)}-${parsed.expiresYYMM.slice(2)}.`
        };
    }

    /**
     * Deactivate current license (revert to free).
     */
    async deactivateLicense() {
        const state = await this.getState();
        state.tier = 'free';
        state.licenseKey = null;
        state.licenseValidated = false;
        await this._save(state);
    }

    /**
     * Re-validate saved license on every load (catches expired keys).
     */
    async revalidateSavedLicense() {
        const state = await this.getState();
        if (!state.licenseKey) return;

        const parsed = parseLicenseKey(state.licenseKey);
        if (!parsed.valid) {
            // Key expired or invalid – drop back to free
            state.tier = 'free';
            state.licenseValidated = false;
            await this._save(state);
        }
    }
}

module.exports = { TierManager, parseLicenseKey, generateLicenseKey, computeChecksum };
