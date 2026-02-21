/**
 * XBMA API – Cloudflare Worker
 *
 * Routes:
 *   POST /webhook/bmc      – BuyMeACoffee webhook (subscription events)
 *   POST /verify           – Extension token verification
 *   POST /analyze          – Gemini Pro proxy (Pro subscribers only)
 *   GET  /health           – Health check
 *
 * All responses are JSON. CORS is restricted to the extension origin.
 */

import { handleBmcWebhook } from './handlers/webhook.js';
import { handleVerify }     from './handlers/verify.js';
import { handleAnalyze }    from './handlers/analyze.js';

// ── CORS ──────────────────────────────────────────────────────────────────────
// Chrome extensions send requests from a chrome-extension:// origin.
// We allow that plus localhost for local testing.
function corsHeaders(request) {
    const origin = request.headers.get('Origin') || '';
    const allowed =
        origin.startsWith('chrome-extension://') ||
        origin.startsWith('http://localhost')    ||
        origin === '';  // server-to-server or health checks

    return {
        'Access-Control-Allow-Origin':  allowed ? origin : 'null',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-Extension-Token',
        'Access-Control-Max-Age':       '86400',
    };
}

function json(data, status = 200, request = null) {
    const headers = {
        'Content-Type': 'application/json',
        ...(request ? corsHeaders(request) : {}),
    };
    return new Response(JSON.stringify(data), { status, headers });
}

// ── Main handler ──────────────────────────────────────────────────────────────
export default {
    async fetch(request, env, ctx) {
        // Preflight
        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: corsHeaders(request) });
        }

        const url  = new URL(request.url);
        const path = url.pathname;

        try {
            if (path === '/health' && request.method === 'GET') {
                return json({ ok: true, version: '1.0.0' }, 200, request);
            }

            if (path === '/webhook/bmc' && request.method === 'POST') {
                return handleBmcWebhook(request, env, json);
            }

            if (path === '/verify' && request.method === 'POST') {
                return handleVerify(request, env, json);
            }

            if (path === '/analyze' && request.method === 'POST') {
                return handleAnalyze(request, env, json);
            }

            return json({ error: 'Not found' }, 404, request);
        } catch (err) {
            console.error('Unhandled error:', err);
            return json({ error: 'Internal server error' }, 500, request);
        }
    }
};
