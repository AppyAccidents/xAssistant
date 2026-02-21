/**
 * Gemini Pro Analysis Proxy  –  POST /analyze
 *
 * This is the core security boundary: the Gemini Pro API key NEVER leaves
 * this Worker. Pro subscribers send their activation token + bookmark data
 * here; the Worker validates the token, enforces rate limits, and proxies
 * the call to Gemini Pro on their behalf.
 *
 * Request headers:
 *   X-Extension-Token: xbma_abc123...
 *
 * Request body (JSON):
 *   {
 *     "action": "analyzeCollection" | "analyzeBookmark" | "extractImageText",
 *
 *     // For analyzeCollection:
 *     "bookmarks": [{ "text": "...", "username": "..." }, ...],
 *
 *     // For analyzeBookmark:
 *     "bookmark": { "text": "...", "displayName": "...", "username": "...", "dateTime": "..." },
 *     "imageTexts": ["extracted text from image 1", ...],
 *
 *     // For extractImageText:
 *     "imageUrl": "https://pbs.twimg.com/media/..."
 *   }
 *
 * Response (200):
 *   { "result": <analysis object or string> }
 *
 * Response (429):
 *   { "error": "Daily limit reached", "resetAt": "2026-02-22T00:00:00Z" }
 */

import { checkAndIncrementRateLimit } from './shared.js';

const GEMINI_BASE  = 'https://generativelanguage.googleapis.com/v1beta/models';
const PRO_MODEL    = 'gemini-2.5-pro-preview-03-25';
const DAILY_LIMIT  = 50;

// ── Token auth ────────────────────────────────────────────────────────────────

async function authenticateToken(token, env) {
    if (!token || !token.startsWith('xbma_')) return null;

    const index = await env.SUBSCRIBERS.get(`token:${token}`, { type: 'json' });
    if (!index?.supporterId) return null;

    const record = await env.SUBSCRIBERS.get(`sub:${index.supporterId}`, { type: 'json' });
    if (!record) return null;

    const now       = new Date();
    const expiresAt = new Date(record.expiresAt);
    if (now > expiresAt) return null;  // expired

    return record;
}

// ── Gemini API helpers ────────────────────────────────────────────────────────

async function callGeminiText(prompt, apiKey) {
    const url = `${GEMINI_BASE}/${PRO_MODEL}:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
                temperature:      0.7,
                maxOutputTokens:  800,
                responseMimeType: 'application/json',
            },
        }),
    });

    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error?.message || `Gemini error: ${response.status}`);
    }

    const data = await response.json();
    if (!data.candidates?.[0]?.content?.parts?.[0]?.text) {
        throw new Error('Empty Gemini response');
    }
    return data.candidates[0].content.parts[0].text;
}

async function callGeminiVision(imageUrl, apiKey) {
    // Fetch image and base64-encode it server-side (avoids CORS issues in extension)
    const imgResp = await fetch(imageUrl, { headers: { 'User-Agent': 'XBMA-Worker/1.0' } });
    if (!imgResp.ok) throw new Error(`Image fetch failed: ${imgResp.status}`);

    const buffer   = await imgResp.arrayBuffer();
    const bytes    = new Uint8Array(buffer);
    const binary   = String.fromCharCode(...bytes);
    const base64   = btoa(binary);
    const mimeType = (imgResp.headers.get('content-type') || 'image/jpeg').split(';')[0].trim();

    // For vision we use Flash (cheaper, faster, no accuracy difference for OCR)
    const flashModel = 'gemini-2.0-flash';
    const url = `${GEMINI_BASE}/${flashModel}:generateContent?key=${apiKey}`;

    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{
                parts: [
                    { inlineData: { mimeType, data: base64 } },
                    { text: 'Extract all visible text from this image. If there is no significant text, briefly describe what the image shows (1-2 sentences). Be concise.' },
                ],
            }],
            generationConfig: {
                temperature:     0.3,
                maxOutputTokens: 400,
            },
        }),
    });

    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error?.message || `Gemini vision error: ${response.status}`);
    }

    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
}

// ── JSON parsing helpers ──────────────────────────────────────────────────────

function parseJSON(text) {
    // Try direct parse
    try { return JSON.parse(text); } catch {}
    // Strip markdown code fences
    const m = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (m) try { return JSON.parse(m[1]); } catch {}
    // First JSON object
    const m2 = text.match(/\{[\s\S]*\}/);
    if (m2) try { return JSON.parse(m2[0]); } catch {}
    throw new Error('Could not parse JSON from Gemini response');
}

// ── Action handlers ───────────────────────────────────────────────────────────

async function analyzeCollection(bookmarks, apiKey) {
    const bookmarkTexts = bookmarks
        .filter(b => b.text?.trim())
        .slice(0, 50)
        .map(b => `@${b.username}: ${b.text}`)
        .join('\n\n');

    if (!bookmarkTexts) throw new Error('No bookmark content');

    const prompt = `Analyze these Twitter/X bookmarks and provide:
1. An overall summary (2-3 sentences) of the main themes
2. A list of 5-10 relevant tags/keywords
3. 3-5 main categories these bookmarks fall into

Bookmarks:
${bookmarkTexts}

Respond in JSON:
{
  "overallSummary": "...",
  "tags": ["tag1", "tag2"],
  "categories": ["cat1", "cat2"]
}`;

    const text = await callGeminiText(prompt, apiKey);
    return parseJSON(text);
}

async function analyzeBookmark(bookmark, imageTexts, apiKey) {
    const author = bookmark.displayName || bookmark.username || 'Unknown';
    const handle = bookmark.username ? `@${bookmark.username}` : '';
    const date   = bookmark.dateTime
        ? new Date(bookmark.dateTime).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
        : '';

    let imageContext = '';
    if (imageTexts?.length > 0) {
        imageContext = `\nImages in tweet:\n${imageTexts.map((t, i) => `Image ${i + 1}: ${t}`).join('\n')}`;
    }

    const prompt = `Analyze this single Twitter/X bookmark for use as a knowledge base entry.

Author: ${author} ${handle}
Date: ${date}
Tweet text: ${bookmark.text || ''}${imageContext}

Provide a rich JSON analysis:
{
  "summary": "2-3 sentence summary of what this tweet is about and why it matters",
  "keyInsights": ["insight 1", "insight 2", "insight 3"],
  "topics": ["topic1", "topic2"],
  "sentiment": "positive|negative|neutral|mixed",
  "actionableInfo": "any actionable takeaways or tips mentioned (empty string if none)",
  "knowledgeValue": "high|medium|low"
}`;

    const text = await callGeminiText(prompt, apiKey);
    return parseJSON(text);
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function handleAnalyze(request, env, json) {
    // Auth
    const token  = (request.headers.get('X-Extension-Token') || '').trim();
    const record = await authenticateToken(token, env);

    if (!record) {
        return json({ error: 'Unauthorized. Verify your token in Settings.' }, 401, request);
    }

    // Rate limit (server-side, authoritative)
    const rl = await checkAndIncrementRateLimit(env.RATE_LIMITS, record.supporterId, DAILY_LIMIT);
    if (!rl.allowed) {
        const resetAt = new Date();
        resetAt.setUTCHours(24, 0, 0, 0);
        return json({
            error:   `Daily limit of ${DAILY_LIMIT} analyses reached.`,
            resetAt: resetAt.toISOString(),
        }, 429, request);
    }

    // Parse body
    let body;
    try { body = await request.json(); }
    catch { return json({ error: 'Invalid request body' }, 400, request); }

    const { action } = body;
    const apiKey = env.GEMINI_PRO_API_KEY;

    if (!apiKey) {
        console.error('GEMINI_PRO_API_KEY secret not set');
        return json({ error: 'Server configuration error' }, 500, request);
    }

    try {
        let result;

        if (action === 'analyzeCollection') {
            if (!Array.isArray(body.bookmarks) || body.bookmarks.length === 0) {
                return json({ error: 'Missing bookmarks array' }, 400, request);
            }
            result = await analyzeCollection(body.bookmarks, apiKey);

        } else if (action === 'analyzeBookmark') {
            if (!body.bookmark) {
                return json({ error: 'Missing bookmark object' }, 400, request);
            }
            result = await analyzeBookmark(body.bookmark, body.imageTexts || [], apiKey);

        } else if (action === 'extractImageText') {
            if (!body.imageUrl) {
                return json({ error: 'Missing imageUrl' }, 400, request);
            }
            result = await callGeminiVision(body.imageUrl, apiKey);

        } else {
            return json({ error: `Unknown action: ${action}` }, 400, request);
        }

        return json({
            result,
            remainingToday: rl.remaining,
        }, 200, request);

    } catch (err) {
        console.error(`analyze/${action} error:`, err.message);
        return json({ error: err.message }, 502, request);
    }
}
