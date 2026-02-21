/**
 * Shared utilities for Worker handlers
 */

/**
 * Generate a cryptographically secure activation token.
 * Format: xbma_<32 hex chars>
 * We sign supporterId with HMAC-SHA256(secret) and append random bytes
 * to make it both unique and unguessable.
 * @param {string} secret - TOKEN_HMAC_SECRET env var
 * @param {string} supporterId - BMC supporter ID
 * @returns {Promise<string>} token
 */
export async function generateToken(secret, supporterId) {
    const encoder  = new TextEncoder();
    const keyData  = encoder.encode(secret || 'fallback-change-me');
    const msgData  = encoder.encode(`${supporterId}:${Date.now()}`);

    const cryptoKey = await crypto.subtle.importKey(
        'raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', cryptoKey, msgData);

    // Prefix + first 16 bytes of HMAC (32 hex chars)
    const hex = Array.from(new Uint8Array(sig))
        .slice(0, 16)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');

    // Add 8 random bytes for extra entropy
    const rand = Array.from(crypto.getRandomValues(new Uint8Array(8)))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');

    return `xbma_${hex}${rand}`;
}

/**
 * Return today's date string in YYYY-MM-DD (UTC).
 */
export function todayUTC() {
    return new Date().toISOString().slice(0, 10);
}

/**
 * Check and increment rate limit for a subscriber.
 * Returns { allowed: boolean, remaining: number }.
 * @param {KVNamespace} kv - RATE_LIMITS KV binding
 * @param {string} supporterId
 * @param {number} limit - daily limit
 */
export async function checkAndIncrementRateLimit(kv, supporterId, limit) {
    const today  = todayUTC();
    const key    = `rl:${supporterId}:${today}`;
    const raw    = await kv.get(key);
    const count  = raw ? parseInt(raw, 10) : 0;

    if (count >= limit) {
        return { allowed: false, remaining: 0, count };
    }

    const newCount = count + 1;
    // TTL: expires at end of day (UTC) + 1 hour buffer
    const now     = new Date();
    const endOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
    const ttlSecs  = Math.ceil((endOfDay - now) / 1000) + 3600;

    await kv.put(key, String(newCount), { expirationTtl: ttlSecs });

    return { allowed: true, remaining: limit - newCount, count: newCount };
}

/**
 * Send activation email via Resend API.
 * @param {string} email
 * @param {string} token
 * @param {string} resendApiKey
 */
export async function sendActivationEmail(email, token, resendApiKey) {
    const html = `
        <div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px; color: #111;">
            <h2 style="margin-top: 0;">Your X Bookmarks Analyzer Pro is active! ☕</h2>
            <p>Thank you for subscribing. Here is your one-time activation token:</p>
            <div style="background: #f4f4f5; border-radius: 8px; padding: 16px 20px; margin: 20px 0;">
                <code style="font-size: 15px; letter-spacing: 0.05em; word-break: break-all;">${token}</code>
            </div>
            <p><strong>To activate Pro:</strong></p>
            <ol>
                <li>Open the X Bookmarks Analyzer extension</li>
                <li>Go to <strong>Settings</strong> tab</li>
                <li>Paste this token into the <strong>Activation Token</strong> field</li>
                <li>Click <strong>Activate</strong></li>
            </ol>
            <p style="color: #666; font-size: 13px;">
                Keep this token safe — it grants access to Pro features including Gemini 2.5 Pro,
                deep per-tweet analysis, image text extraction, and 50 bookmarks per export.
            </p>
            <p style="color: #666; font-size: 13px; margin-bottom: 0;">
                Questions? Reply to this email.
            </p>
        </div>
    `;

    const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${resendApiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            from:    'X Bookmarks Analyzer <noreply@YOUR_DOMAIN.com>',
            to:      [email],
            subject: 'Your X Bookmarks Analyzer Pro token',
            html,
        }),
    });

    if (!response.ok) {
        const err = await response.text();
        throw new Error(`Resend API error: ${response.status} ${err}`);
    }

    return response.json();
}
