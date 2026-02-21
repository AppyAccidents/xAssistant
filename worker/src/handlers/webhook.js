/**
 * BuyMeACoffee Webhook Handler
 *
 * BMC sends a POST to /webhook/bmc on these events:
 *   - subscription.created   (new subscriber)
 *   - subscription.updated   (plan change)
 *   - subscription.cancelled (cancellation)
 *   - subscription.expired   (payment failed / lapsed)
 *
 * Docs: https://developers.buymeacoffee.com/docs/webhooks
 *
 * Webhook signature: BMC sends X-BMC-Signature header.
 * Value = HMAC-SHA256(rawBody, BMC_WEBHOOK_SECRET) in hex.
 *
 * KV schema for a subscriber record (key = "sub:<bmc_supporter_id>"):
 * {
 *   supporterId: string,
 *   email: string,
 *   token: string,          // activation token sent to user
 *   tier: 'monthly'|'annual',
 *   status: 'active'|'cancelled'|'expired',
 *   createdAt: ISO string,
 *   expiresAt: ISO string,  // next billing date + 3-day grace
 *   usedToday: number,
 *   usageDate: 'YYYY-MM-DD'
 * }
 *
 * Token index (key = "token:<token>") → { supporterId }
 * so we can look up a subscriber from just the token.
 */

import { generateToken, sendActivationEmail } from './shared.js';

// Verify HMAC-SHA256 signature from BMC
async function verifyBmcSignature(rawBody, signatureHeader, secret) {
    if (!signatureHeader || !secret) return false;

    const encoder = new TextEncoder();
    const keyData  = encoder.encode(secret);
    const msgData  = encoder.encode(rawBody);

    const cryptoKey = await crypto.subtle.importKey(
        'raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    const signature = await crypto.subtle.sign('HMAC', cryptoKey, msgData);
    const hexSig    = Array.from(new Uint8Array(signature))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');

    // Constant-time compare
    if (hexSig.length !== signatureHeader.length) return false;
    let mismatch = 0;
    for (let i = 0; i < hexSig.length; i++) {
        mismatch |= hexSig.charCodeAt(i) ^ signatureHeader.charCodeAt(i);
    }
    return mismatch === 0;
}

function addDays(date, days) {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d.toISOString();
}

export async function handleBmcWebhook(request, env, json) {
    const rawBody = await request.text();

    // ── Signature verification ────────────────────────────────────────────────
    const signature = request.headers.get('X-BMC-Signature') || '';
    const valid = await verifyBmcSignature(rawBody, signature, env.BMC_WEBHOOK_SECRET);
    if (!valid) {
        console.warn('BMC webhook: invalid signature');
        return json({ error: 'Invalid signature' }, 401);
    }

    let payload;
    try {
        payload = JSON.parse(rawBody);
    } catch {
        return json({ error: 'Invalid JSON body' }, 400);
    }

    const { type, data } = payload;
    if (!type || !data) return json({ error: 'Missing type or data' }, 400);

    const supporterId = String(data.supporter_id || data.id || '');
    const email       = (data.payer_email || data.supporter_email || '').toLowerCase();
    const kvKey       = `sub:${supporterId}`;

    console.log(`BMC webhook: ${type} for supporter ${supporterId} (${email})`);

    // ── Handle event types ────────────────────────────────────────────────────
    if (type === 'subscription.created' || type === 'subscription.updated') {
        // Determine tier from plan amount
        const amount = parseFloat(data.subscription_coffee_price || data.amount || 3);
        const tier   = amount >= 25 ? 'annual' : 'monthly';

        // Expiry = next billing date + 3-day grace period
        const nextBilling = data.subscription_current_period_end
            ? new Date(data.subscription_current_period_end * 1000).toISOString()
            : addDays(new Date(), tier === 'annual' ? 366 : 33);
        const expiresAt = addDays(nextBilling, 3);

        // Check if subscriber already exists (renewal)
        const existing = await env.SUBSCRIBERS.get(kvKey, { type: 'json' });

        let token;
        if (existing?.token) {
            // Renewal — reuse token, just extend expiry & reactivate
            token = existing.token;
            const updated = { ...existing, status: 'active', tier, expiresAt };
            await env.SUBSCRIBERS.put(kvKey, JSON.stringify(updated));
            console.log(`Renewed subscription for ${email}, expires ${expiresAt}`);
        } else {
            // New subscriber — generate token
            token = await generateToken(env.TOKEN_HMAC_SECRET, supporterId);

            const record = {
                supporterId,
                email,
                token,
                tier,
                status:    'active',
                createdAt: new Date().toISOString(),
                expiresAt,
                usedToday: 0,
                usageDate: '',
            };

            // Store subscriber record
            await env.SUBSCRIBERS.put(kvKey, JSON.stringify(record));
            // Store reverse-lookup index token → supporterId
            await env.SUBSCRIBERS.put(`token:${token}`, JSON.stringify({ supporterId }));

            // Send activation email
            if (email && env.RESEND_API_KEY) {
                await sendActivationEmail(email, token, env.RESEND_API_KEY).catch(err =>
                    console.error('Email send failed:', err.message)
                );
            }

            console.log(`New subscriber ${email} activated, token sent`);
        }

        return json({ ok: true, action: existing ? 'renewed' : 'created' });
    }

    if (type === 'subscription.cancelled' || type === 'subscription.expired') {
        const existing = await env.SUBSCRIBERS.get(kvKey, { type: 'json' });
        if (existing) {
            const updated = { ...existing, status: type === 'subscription.cancelled' ? 'cancelled' : 'expired' };
            await env.SUBSCRIBERS.put(kvKey, JSON.stringify(updated));
            // NOTE: We keep the token in KV so the user still has access until expiresAt.
            // The /verify endpoint enforces the expiry date.
            console.log(`Subscription ${type} for ${email}`);
        }
        return json({ ok: true, action: 'deactivated' });
    }

    // Unknown event type — acknowledge to prevent BMC retries
    return json({ ok: true, action: 'ignored' });
}
