/**
 * Token Verification Handler  –  POST /verify
 *
 * Request body:
 *   { "token": "xbma_abc123..." }
 *
 * Response (200):
 *   {
 *     "valid": true,
 *     "tier": "pro",
 *     "expiresAt": "2026-03-28T...",
 *     "bookmarkLimit": 50,
 *     "dailyLimit": 50,
 *     "remainingToday": 47
 *   }
 *
 * Response (401):
 *   { "valid": false, "reason": "Token not found" }
 *
 * The extension caches a valid response in chrome.storage for up to 24 hours
 * before re-verifying, to keep the extension functional offline.
 */

import { checkAndIncrementRateLimit, todayUTC } from './shared.js';

const PRO_DAILY_LIMIT     = 50;
const PRO_BOOKMARK_LIMIT  = 50;

export async function handleVerify(request, env, json) {
    let body;
    try {
        body = await request.json();
    } catch {
        return json({ valid: false, reason: 'Invalid request body' }, 400, request);
    }

    const token = (body.token || '').trim();

    if (!token || !token.startsWith('xbma_')) {
        return json({ valid: false, reason: 'Malformed token' }, 400, request);
    }

    // Look up token → supporterId
    const index = await env.SUBSCRIBERS.get(`token:${token}`, { type: 'json' });
    if (!index?.supporterId) {
        return json({ valid: false, reason: 'Token not found' }, 401, request);
    }

    // Look up subscriber record
    const record = await env.SUBSCRIBERS.get(`sub:${index.supporterId}`, { type: 'json' });
    if (!record) {
        return json({ valid: false, reason: 'Subscriber not found' }, 401, request);
    }

    // Check status – cancelled/expired subscriptions still valid until expiresAt
    const now       = new Date();
    const expiresAt = new Date(record.expiresAt);
    if (now > expiresAt) {
        return json({
            valid:  false,
            reason: 'Subscription expired. Please renew at buymeacoffee.com.',
        }, 401, request);
    }

    // Get remaining rate-limit quota (read-only, don't increment on verify)
    const today  = todayUTC();
    const rlKey  = `rl:${record.supporterId}:${today}`;
    const rlRaw  = await env.RATE_LIMITS.get(rlKey);
    const usedToday   = rlRaw ? parseInt(rlRaw, 10) : 0;
    const remaining   = Math.max(0, PRO_DAILY_LIMIT - usedToday);

    return json({
        valid:         true,
        tier:          'pro',
        expiresAt:     record.expiresAt,
        bookmarkLimit: PRO_BOOKMARK_LIMIT,
        dailyLimit:    PRO_DAILY_LIMIT,
        remainingToday: remaining,
        supporterId:   record.supporterId,  // opaque id, safe to return
    }, 200, request);
}
