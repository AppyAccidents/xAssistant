const { LLMProvider } = require('./base.js');

// Model IDs — verify latest at https://aistudio.google.com/app/apikey
const GEMINI_FLASH = 'gemini-2.0-flash';           // Free tier: user supplies own key
const GEMINI_PRO   = 'gemini-2.5-pro-preview-03-25'; // Pro tier: routed via backend proxy

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * GeminiProvider
 *
 * Supports two model tiers:
 *   flash – Gemini 1.5 Flash  (free users, user supplies own API key)
 *   pro   – Gemini 1.5 Pro    (Pro subscribers)
 *
 * Extra capabilities beyond basic analyzeBookmarks():
 *   • analyzeBookmark(bookmark)  – per-bookmark deep analysis with context
 *   • extractImageText(imageUrl) – Gemini Vision OCR / description
 */
class GeminiProvider extends LLMProvider {
    /**
     * @param {string} apiKey
     * @param {Object} constants
     * @param {'flash'|'pro'} [modelTier='flash']
     */
    constructor(apiKey, constants, modelTier = 'flash') {
        super(constants);
        this.apiKey = apiKey;
        this.modelTier = modelTier;
        this.model = modelTier === 'pro' ? GEMINI_PRO : GEMINI_FLASH;
    }

    // ─── Internal helpers ───────────────────────────────────────────────────

    _endpoint(model) {
        return `${BASE_URL}/${model}:generateContent?key=${this.apiKey}`;
    }

    async _callAPI(model, contents, generationConfig = {}) {
        const response = await fetch(this._endpoint(model), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents,
                generationConfig: {
                    temperature: this.constants.AI_TEMPERATURE,
                    maxOutputTokens: this.constants.AI_MAX_TOKENS,
                    responseMimeType: 'application/json',
                    ...generationConfig
                }
            })
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.error?.message || `Gemini API error: ${response.status}`);
        }

        const data = await response.json();
        if (!data.candidates || data.candidates.length === 0) {
            throw new Error('Empty response from Gemini API');
        }
        return data.candidates[0].content.parts[0].text;
    }

    // ─── Collection-level analysis (original behaviour) ─────────────────────

    async analyzeBookmarks(bookmarks) {
        const bookmarkTexts = this.prepareBookmarkTexts(bookmarks);
        if (!bookmarkTexts) throw new Error('No bookmark content to analyze');

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

        const content = await this._callAPI(this.model, [{ parts: [{ text: prompt }] }]);
        return this.validateAnalysis(this.parseJSONResponse(content));
    }

    // ─── Per-bookmark deep analysis ──────────────────────────────────────────

    /**
     * Analyze a single bookmark deeply.
     * Returns { summary, keyInsights, topics, sentiment, actionableInfo, imageDescriptions }.
     * @param {Object} bookmark
     * @param {string[]} [imageTexts] – pre-extracted image descriptions
     */
    async analyzeBookmark(bookmark, imageTexts = []) {
        const tweetText = bookmark.text || '';
        const author = bookmark.displayName || bookmark.username || 'Unknown';
        const handle = bookmark.username ? `@${bookmark.username}` : '';
        const date = bookmark.dateTime ? new Date(bookmark.dateTime).toLocaleDateString() : '';

        let imageContext = '';
        if (imageTexts.length > 0) {
            imageContext = `\nImages in tweet:\n${imageTexts.map((t, i) => `Image ${i + 1}: ${t}`).join('\n')}`;
        }

        const prompt = `Analyze this single Twitter/X bookmark for use as a knowledge base entry.

Author: ${author} ${handle}
Date: ${date}
Tweet text: ${tweetText}${imageContext}

Provide a rich JSON analysis:
{
  "summary": "2-3 sentence summary of what this tweet is about and why it matters",
  "keyInsights": ["insight 1", "insight 2", "insight 3"],
  "topics": ["topic1", "topic2"],
  "sentiment": "positive|negative|neutral|mixed",
  "actionableInfo": "any actionable takeaways or tips mentioned (empty string if none)",
  "knowledgeValue": "high|medium|low"
}`;

        try {
            const text = await this._callAPI(
                this.model,
                [{ parts: [{ text: prompt }] }],
                { maxOutputTokens: 600 }
            );
            const parsed = this.parseJSONResponse(text);
            return {
                summary: parsed.summary || '',
                keyInsights: Array.isArray(parsed.keyInsights) ? parsed.keyInsights : [],
                topics: Array.isArray(parsed.topics) ? parsed.topics : [],
                sentiment: parsed.sentiment || 'neutral',
                actionableInfo: parsed.actionableInfo || '',
                knowledgeValue: parsed.knowledgeValue || 'medium'
            };
        } catch (err) {
            console.warn('Per-bookmark analysis failed:', err.message);
            return {
                summary: tweetText.slice(0, 200),
                keyInsights: [],
                topics: [],
                sentiment: 'neutral',
                actionableInfo: '',
                knowledgeValue: 'medium'
            };
        }
    }

    // ─── Vision / Image text extraction ─────────────────────────────────────

    /**
     * Use Gemini Vision to extract text or describe an image URL.
     * Falls back gracefully if the URL is inaccessible.
     * @param {string} imageUrl
     * @returns {Promise<string>} Extracted text or description
     */
    async extractImageText(imageUrl) {
        if (!imageUrl) return '';

        try {
            // Fetch the image and convert to base64
            const imgResponse = await fetch(imageUrl);
            if (!imgResponse.ok) return '';

            const arrayBuffer = await imgResponse.arrayBuffer();
            const bytes = new Uint8Array(arrayBuffer);
            let binary = '';
            for (let i = 0; i < bytes.byteLength; i++) {
                binary += String.fromCharCode(bytes[i]);
            }
            const base64Data = btoa(binary);

            // Detect mime type from response headers or default to jpeg
            const contentType = imgResponse.headers.get('content-type') || 'image/jpeg';
            const mimeType = contentType.split(';')[0].trim();

            const contents = [{
                parts: [
                    {
                        inlineData: {
                            mimeType,
                            data: base64Data
                        }
                    },
                    {
                        text: 'Extract all visible text from this image. If there is no significant text, briefly describe what the image shows (1-2 sentences). Be concise.'
                    }
                ]
            }];

            // Vision works best with flash; use flash regardless of tier to keep costs low
            const text = await this._callAPI(
                GEMINI_FLASH,
                contents,
                { responseMimeType: undefined, maxOutputTokens: 400 }
            );
            return text.trim();
        } catch (err) {
            console.warn('Image extraction failed for', imageUrl, ':', err.message);
            return '';
        }
    }

    /**
     * Extract text/descriptions from all images in a bookmark.
     * @param {Object} bookmark
     * @returns {Promise<string[]>}
     */
    async extractBookmarkImageTexts(bookmark) {
        const mediaItems = bookmark.media || [];
        const imageItems = mediaItems.filter(m => m.type !== 'video' && m.url);
        if (imageItems.length === 0) return [];

        // Process up to 4 images per tweet to keep latency reasonable
        const limited = imageItems.slice(0, 4);
        const results = await Promise.allSettled(
            limited.map(m => this.extractImageText(m.url))
        );
        return results
            .filter(r => r.status === 'fulfilled' && r.value)
            .map(r => r.value);
    }
}

/**
 * ProxyGeminiProvider
 *
 * Used by Pro subscribers. All Gemini Pro API calls are routed through
 * the XBMA Cloudflare Worker so the Pro API key never touches the browser.
 *
 * The extension sends the subscriber's activation token in X-Extension-Token.
 * The Worker validates the token, enforces server-side rate limits, and
 * calls Gemini Pro on the subscriber's behalf.
 *
 * Free users continue to use GeminiProvider directly with their own key.
 */
class ProxyGeminiProvider extends LLMProvider {
    /**
     * @param {string} token      – subscriber's activation token (xbma_...)
     * @param {string} workerUrl  – base URL of the deployed Cloudflare Worker
     * @param {Object} constants
     */
    constructor(token, workerUrl, constants) {
        super(constants);
        this.token     = token;
        this.workerUrl = workerUrl.replace(/\/$/, ''); // strip trailing slash
    }

    // ── Internal ─────────────────────────────────────────────────────────────

    async _callWorker(action, payload) {
        const response = await fetch(`${this.workerUrl}/analyze`, {
            method:  'POST',
            headers: {
                'Content-Type':       'application/json',
                'X-Extension-Token':  this.token,
            },
            body: JSON.stringify({ action, ...payload }),
        });

        if (response.status === 401) {
            throw new Error('Pro token invalid or expired. Please re-activate in Settings.');
        }
        if (response.status === 429) {
            const data = await response.json().catch(() => ({}));
            throw new Error(data.error || 'Daily analysis limit reached. Try again tomorrow.');
        }
        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error(data.error || `Worker error: ${response.status}`);
        }

        const data = await response.json();
        // Server echoes remaining quota – store for UI display (best-effort)
        if (typeof data.remainingToday === 'number') {
            this._lastRemaining = data.remainingToday;
        }
        return data.result;
    }

    // ── Collection-level analysis ────────────────────────────────────────────

    async analyzeBookmarks(bookmarks) {
        const toSend = bookmarks
            .filter(b => b.text?.trim())
            .slice(0, this.constants.AI_ANALYSIS_LIMIT)
            .map(b => ({ text: b.text, username: b.username }));

        if (toSend.length === 0) throw new Error('No bookmark content to analyze');

        const result = await this._callWorker('analyzeCollection', { bookmarks: toSend });
        return this.validateAnalysis(result);
    }

    // ── Per-bookmark deep analysis ────────────────────────────────────────────

    /**
     * Matches the GeminiProvider.analyzeBookmark() signature.
     */
    async analyzeBookmark(bookmark, imageTexts = []) {
        const toSend = {
            text:        bookmark.text || '',
            displayName: bookmark.displayName,
            username:    bookmark.username,
            dateTime:    bookmark.dateTime,
        };

        try {
            const result = await this._callWorker('analyzeBookmark', {
                bookmark: toSend,
                imageTexts,
            });
            return {
                summary:        result.summary       || '',
                keyInsights:    Array.isArray(result.keyInsights) ? result.keyInsights : [],
                topics:         Array.isArray(result.topics)      ? result.topics      : [],
                sentiment:      result.sentiment      || 'neutral',
                actionableInfo: result.actionableInfo || '',
                knowledgeValue: result.knowledgeValue || 'medium',
            };
        } catch (err) {
            console.warn('ProxyGemini: analyzeBookmark failed:', err.message);
            return {
                summary: bookmark.text?.slice(0, 200) || '',
                keyInsights: [], topics: [], sentiment: 'neutral',
                actionableInfo: '', knowledgeValue: 'medium',
            };
        }
    }

    // ── Image text extraction ─────────────────────────────────────────────────

    /**
     * Sends the image URL to the Worker; the Worker fetches + encodes it
     * server-side (avoids CORS issues) and calls Gemini Vision.
     */
    async extractImageText(imageUrl) {
        if (!imageUrl) return '';
        try {
            const result = await this._callWorker('extractImageText', { imageUrl });
            return typeof result === 'string' ? result.trim() : '';
        } catch (err) {
            console.warn('ProxyGemini: extractImageText failed:', err.message);
            return '';
        }
    }

    /**
     * Matches GeminiProvider.extractBookmarkImageTexts() signature.
     */
    async extractBookmarkImageTexts(bookmark) {
        const mediaItems = bookmark.media || [];
        const imageItems = mediaItems.filter(m => m.type !== 'video' && m.url);
        if (imageItems.length === 0) return [];

        const limited = imageItems.slice(0, 4);
        const results = await Promise.allSettled(
            limited.map(m => this.extractImageText(m.url))
        );
        return results
            .filter(r => r.status === 'fulfilled' && r.value)
            .map(r => r.value);
    }
}

module.exports = { GeminiProvider, ProxyGeminiProvider, GEMINI_FLASH, GEMINI_PRO };
