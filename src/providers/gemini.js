const { LLMProvider } = require('./base.js');

// Model IDs
const GEMINI_FLASH = 'gemini-1.5-flash';
const GEMINI_PRO   = 'gemini-1.5-pro';

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

module.exports = { GeminiProvider, GEMINI_FLASH, GEMINI_PRO };
