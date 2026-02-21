(() => {
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __commonJS = (cb, mod) => function __require() {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  };

  // src/services/tier-manager.js
  var require_tier_manager = __commonJS({
    "src/services/tier-manager.js"(exports, module) {
      var WORKER_URL = "https://xbma-api.YOUR_SUBDOMAIN.workers.dev";
      var STORAGE_KEY = "xbma_tier_v2";
      var CACHE_TTL_MS = 23 * 60 * 60 * 1e3;
      var FREE_DAILY_LIMIT = 50;
      var FREE_BOOKMARK_LIMIT = 3;
      var PRO_BOOKMARK_LIMIT = 50;
      var TierManager = class {
        constructor() {
          this.FREE_BOOKMARK_LIMIT = FREE_BOOKMARK_LIMIT;
          this.PRO_BOOKMARK_LIMIT = PRO_BOOKMARK_LIMIT;
          this.FREE_DAILY_LIMIT = FREE_DAILY_LIMIT;
          this.WORKER_URL = WORKER_URL;
        }
        // ── Storage helpers ────────────────────────────────────────────────────────
        async _load() {
          const raw = await chrome.storage.local.get([STORAGE_KEY]);
          return raw[STORAGE_KEY] || {
            token: null,
            verifiedAt: null,
            cachedResponse: null,
            localUsageDate: null,
            localUsageCount: 0
          };
        }
        async _save(data) {
          await chrome.storage.local.set({ [STORAGE_KEY]: data });
        }
        _todayStr() {
          return (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
        }
        // ── Token management ───────────────────────────────────────────────────────
        async getToken() {
          const state = await this._load();
          return state.token || null;
        }
        async saveToken(token) {
          const state = await this._load();
          state.token = token;
          state.verifiedAt = null;
          state.cachedResponse = null;
          await this._save(state);
        }
        async clearToken() {
          const state = await this._load();
          state.token = null;
          state.verifiedAt = null;
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
          var _a, _b;
          const state = await this._load();
          if (!state.token) {
            return this._freeStatus();
          }
          if (!forceRefresh && state.verifiedAt && ((_a = state.cachedResponse) == null ? void 0 : _a.valid) && Date.now() - state.verifiedAt < CACHE_TTL_MS) {
            return state.cachedResponse;
          }
          try {
            const response = await fetch(`${WORKER_URL}/verify`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ token: state.token })
            });
            const data = await response.json();
            if (data.valid) {
              state.verifiedAt = Date.now();
              state.cachedResponse = data;
              await this._save(state);
              return data;
            } else {
              state.cachedResponse = data;
              await this._save(state);
              return data;
            }
          } catch (err) {
            console.warn("TierManager: /verify network error:", err.message);
            if ((_b = state.cachedResponse) == null ? void 0 : _b.valid) {
              return { ...state.cachedResponse, _fromCache: true };
            }
            return this._freeStatus();
          }
        }
        _freeStatus() {
          return {
            valid: false,
            tier: "free",
            bookmarkLimit: FREE_BOOKMARK_LIMIT,
            dailyLimit: FREE_DAILY_LIMIT,
            remainingToday: FREE_DAILY_LIMIT
          };
        }
        // ── Convenience accessors ──────────────────────────────────────────────────
        async isProUser() {
          const status = await this.verifyToken();
          return status.valid === true && status.tier === "pro";
        }
        async getBookmarkLimit() {
          return await this.isProUser() ? PRO_BOOKMARK_LIMIT : FREE_BOOKMARK_LIMIT;
        }
        async getStatus() {
          return this.verifyToken();
        }
        // ── Local display counter (free users only) ────────────────────────────────
        async getLocalUsageCount() {
          const state = await this._load();
          const today = this._todayStr();
          if (state.localUsageDate !== today)
            return 0;
          return state.localUsageCount || 0;
        }
        async incrementLocalUsage(count = 1) {
          const state = await this._load();
          const today = this._todayStr();
          if (state.localUsageDate !== today) {
            state.localUsageDate = today;
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
          const token = (rawToken || "").trim();
          if (!token) {
            return { success: false, message: "Please enter your activation token." };
          }
          if (!token.startsWith("xbma_")) {
            return { success: false, message: 'Invalid token format. Tokens start with "xbma_".' };
          }
          await this.saveToken(token);
          const status = await this.verifyToken(true);
          if (status.valid) {
            const expires = status.expiresAt ? new Date(status.expiresAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }) : "see subscription page";
            return {
              success: true,
              message: `Pro activated! Access valid until ${expires}.`,
              status
            };
          } else {
            await this.clearToken();
            return {
              success: false,
              message: status.reason || "Token verification failed. Please check your token and try again."
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
          if (!state.token)
            return;
          const age = state.verifiedAt ? Date.now() - state.verifiedAt : Infinity;
          if (age > CACHE_TTL_MS) {
            this.verifyToken(true).catch(
              (err) => console.warn("Background re-verify failed:", err.message)
            );
          }
        }
      };
      module.exports = { TierManager, WORKER_URL };
    }
  });

  // src/providers/base.js
  var require_base = __commonJS({
    "src/providers/base.js"(exports, module) {
      var LLMProvider = class {
        constructor(constants) {
          this.constants = constants || {
            AI_ANALYSIS_LIMIT: 50,
            AI_MAX_TOKENS: 500,
            AI_TEMPERATURE: 0.7,
            MAX_TAGS: 20,
            MAX_CATEGORIES: 10
          };
        }
        /**
         * Prepare bookmark texts for analysis
         * @param {Array} bookmarks - Array of bookmark objects
         * @returns {string} Formatted text for LLM analysis
         */
        prepareBookmarkTexts(bookmarks) {
          return bookmarks.filter((b) => b.text && b.text.trim()).slice(0, this.constants.AI_ANALYSIS_LIMIT).map((b) => `@${b.username}: ${b.text}`).join("\n\n");
        }
        /**
         * Parse JSON response from LLM with multiple fallback strategies
         * @param {string} content - Raw response content
         * @returns {Object} Parsed analysis object
         */
        parseJSONResponse(content) {
          let analysis = null;
          try {
            analysis = JSON.parse(content);
            return analysis;
          } catch (e) {
            const codeBlockMatch = content.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
            if (codeBlockMatch) {
              try {
                analysis = JSON.parse(codeBlockMatch[1]);
                return analysis;
              } catch (e2) {
              }
            }
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              try {
                analysis = JSON.parse(jsonMatch[0]);
                return analysis;
              } catch (e3) {
                throw new Error("Failed to parse response as JSON");
              }
            } else {
              throw new Error("No JSON found in response");
            }
          }
        }
        /**
         * Validate and sanitize analysis response
         * @param {Object} analysis - Raw analysis object
         * @returns {Object} Validated analysis object
         */
        validateAnalysis(analysis) {
          if (!analysis || typeof analysis !== "object") {
            throw new Error("Analysis is not a valid object");
          }
          const validatedAnalysis = {
            overallSummary: typeof analysis.overallSummary === "string" ? analysis.overallSummary : "",
            tags: Array.isArray(analysis.tags) ? analysis.tags.filter((t) => typeof t === "string").slice(0, this.constants.MAX_TAGS) : [],
            categories: Array.isArray(analysis.categories) ? analysis.categories.filter((c) => typeof c === "string").slice(0, this.constants.MAX_CATEGORIES) : [],
            timestamp: Date.now()
          };
          if (!validatedAnalysis.overallSummary && validatedAnalysis.tags.length === 0 && validatedAnalysis.categories.length === 0) {
            throw new Error("Response contained no useful analysis data");
          }
          return validatedAnalysis;
        }
        /**
         * Analyze bookmarks - must be implemented by subclass
         * @param {Array} bookmarks - Array of bookmark objects
         * @returns {Promise<Object>} Analysis result
         */
        async analyzeBookmarks(bookmarks) {
          throw new Error("analyzeBookmarks must be implemented by subclass");
        }
      };
      module.exports = { LLMProvider };
    }
  });

  // src/providers/gemini.js
  var require_gemini = __commonJS({
    "src/providers/gemini.js"(exports, module) {
      var { LLMProvider } = require_base();
      var GEMINI_FLASH = "gemini-2.0-flash";
      var GEMINI_PRO = "gemini-2.5-pro-preview-03-25";
      var BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
      var GeminiProvider = class extends LLMProvider {
        /**
         * @param {string} apiKey
         * @param {Object} constants
         * @param {'flash'|'pro'} [modelTier='flash']
         */
        constructor(apiKey, constants, modelTier = "flash") {
          super(constants);
          this.apiKey = apiKey;
          this.modelTier = modelTier;
          this.model = modelTier === "pro" ? GEMINI_PRO : GEMINI_FLASH;
        }
        // ─── Internal helpers ───────────────────────────────────────────────────
        _endpoint(model) {
          return `${BASE_URL}/${model}:generateContent?key=${this.apiKey}`;
        }
        async _callAPI(model, contents, generationConfig = {}) {
          var _a;
          const response = await fetch(this._endpoint(model), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents,
              generationConfig: {
                temperature: this.constants.AI_TEMPERATURE,
                maxOutputTokens: this.constants.AI_MAX_TOKENS,
                responseMimeType: "application/json",
                ...generationConfig
              }
            })
          });
          if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(((_a = err.error) == null ? void 0 : _a.message) || `Gemini API error: ${response.status}`);
          }
          const data = await response.json();
          if (!data.candidates || data.candidates.length === 0) {
            throw new Error("Empty response from Gemini API");
          }
          return data.candidates[0].content.parts[0].text;
        }
        // ─── Collection-level analysis (original behaviour) ─────────────────────
        async analyzeBookmarks(bookmarks) {
          const bookmarkTexts = this.prepareBookmarkTexts(bookmarks);
          if (!bookmarkTexts)
            throw new Error("No bookmark content to analyze");
          const prompt2 = `Analyze these Twitter/X bookmarks and provide:
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
          const content = await this._callAPI(this.model, [{ parts: [{ text: prompt2 }] }]);
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
          const tweetText = bookmark.text || "";
          const author = bookmark.displayName || bookmark.username || "Unknown";
          const handle = bookmark.username ? `@${bookmark.username}` : "";
          const date = bookmark.dateTime ? new Date(bookmark.dateTime).toLocaleDateString() : "";
          let imageContext = "";
          if (imageTexts.length > 0) {
            imageContext = `
Images in tweet:
${imageTexts.map((t, i) => `Image ${i + 1}: ${t}`).join("\n")}`;
          }
          const prompt2 = `Analyze this single Twitter/X bookmark for use as a knowledge base entry.

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
              [{ parts: [{ text: prompt2 }] }],
              { maxOutputTokens: 600 }
            );
            const parsed = this.parseJSONResponse(text);
            return {
              summary: parsed.summary || "",
              keyInsights: Array.isArray(parsed.keyInsights) ? parsed.keyInsights : [],
              topics: Array.isArray(parsed.topics) ? parsed.topics : [],
              sentiment: parsed.sentiment || "neutral",
              actionableInfo: parsed.actionableInfo || "",
              knowledgeValue: parsed.knowledgeValue || "medium"
            };
          } catch (err) {
            console.warn("Per-bookmark analysis failed:", err.message);
            return {
              summary: tweetText.slice(0, 200),
              keyInsights: [],
              topics: [],
              sentiment: "neutral",
              actionableInfo: "",
              knowledgeValue: "medium"
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
          if (!imageUrl)
            return "";
          try {
            const imgResponse = await fetch(imageUrl);
            if (!imgResponse.ok)
              return "";
            const arrayBuffer = await imgResponse.arrayBuffer();
            const bytes = new Uint8Array(arrayBuffer);
            let binary = "";
            for (let i = 0; i < bytes.byteLength; i++) {
              binary += String.fromCharCode(bytes[i]);
            }
            const base64Data = btoa(binary);
            const contentType = imgResponse.headers.get("content-type") || "image/jpeg";
            const mimeType = contentType.split(";")[0].trim();
            const contents = [{
              parts: [
                {
                  inlineData: {
                    mimeType,
                    data: base64Data
                  }
                },
                {
                  text: "Extract all visible text from this image. If there is no significant text, briefly describe what the image shows (1-2 sentences). Be concise."
                }
              ]
            }];
            const text = await this._callAPI(
              GEMINI_FLASH,
              contents,
              { responseMimeType: void 0, maxOutputTokens: 400 }
            );
            return text.trim();
          } catch (err) {
            console.warn("Image extraction failed for", imageUrl, ":", err.message);
            return "";
          }
        }
        /**
         * Extract text/descriptions from all images in a bookmark.
         * @param {Object} bookmark
         * @returns {Promise<string[]>}
         */
        async extractBookmarkImageTexts(bookmark) {
          const mediaItems = bookmark.media || [];
          const imageItems = mediaItems.filter((m) => m.type !== "video" && m.url);
          if (imageItems.length === 0)
            return [];
          const limited = imageItems.slice(0, 4);
          const results = await Promise.allSettled(
            limited.map((m) => this.extractImageText(m.url))
          );
          return results.filter((r) => r.status === "fulfilled" && r.value).map((r) => r.value);
        }
      };
      var ProxyGeminiProvider = class extends LLMProvider {
        /**
         * @param {string} token      – subscriber's activation token (xbma_...)
         * @param {string} workerUrl  – base URL of the deployed Cloudflare Worker
         * @param {Object} constants
         */
        constructor(token, workerUrl, constants) {
          super(constants);
          this.token = token;
          this.workerUrl = workerUrl.replace(/\/$/, "");
        }
        // ── Internal ─────────────────────────────────────────────────────────────
        async _callWorker(action, payload) {
          const response = await fetch(`${this.workerUrl}/analyze`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Extension-Token": this.token
            },
            body: JSON.stringify({ action, ...payload })
          });
          if (response.status === 401) {
            throw new Error("Pro token invalid or expired. Please re-activate in Settings.");
          }
          if (response.status === 429) {
            const data2 = await response.json().catch(() => ({}));
            throw new Error(data2.error || "Daily analysis limit reached. Try again tomorrow.");
          }
          if (!response.ok) {
            const data2 = await response.json().catch(() => ({}));
            throw new Error(data2.error || `Worker error: ${response.status}`);
          }
          const data = await response.json();
          if (typeof data.remainingToday === "number") {
            this._lastRemaining = data.remainingToday;
          }
          return data.result;
        }
        // ── Collection-level analysis ────────────────────────────────────────────
        async analyzeBookmarks(bookmarks) {
          const toSend = bookmarks.filter((b) => {
            var _a;
            return (_a = b.text) == null ? void 0 : _a.trim();
          }).slice(0, this.constants.AI_ANALYSIS_LIMIT).map((b) => ({ text: b.text, username: b.username }));
          if (toSend.length === 0)
            throw new Error("No bookmark content to analyze");
          const result = await this._callWorker("analyzeCollection", { bookmarks: toSend });
          return this.validateAnalysis(result);
        }
        // ── Per-bookmark deep analysis ────────────────────────────────────────────
        /**
         * Matches the GeminiProvider.analyzeBookmark() signature.
         */
        async analyzeBookmark(bookmark, imageTexts = []) {
          var _a;
          const toSend = {
            text: bookmark.text || "",
            displayName: bookmark.displayName,
            username: bookmark.username,
            dateTime: bookmark.dateTime
          };
          try {
            const result = await this._callWorker("analyzeBookmark", {
              bookmark: toSend,
              imageTexts
            });
            return {
              summary: result.summary || "",
              keyInsights: Array.isArray(result.keyInsights) ? result.keyInsights : [],
              topics: Array.isArray(result.topics) ? result.topics : [],
              sentiment: result.sentiment || "neutral",
              actionableInfo: result.actionableInfo || "",
              knowledgeValue: result.knowledgeValue || "medium"
            };
          } catch (err) {
            console.warn("ProxyGemini: analyzeBookmark failed:", err.message);
            return {
              summary: ((_a = bookmark.text) == null ? void 0 : _a.slice(0, 200)) || "",
              keyInsights: [],
              topics: [],
              sentiment: "neutral",
              actionableInfo: "",
              knowledgeValue: "medium"
            };
          }
        }
        // ── Image text extraction ─────────────────────────────────────────────────
        /**
         * Sends the image URL to the Worker; the Worker fetches + encodes it
         * server-side (avoids CORS issues) and calls Gemini Vision.
         */
        async extractImageText(imageUrl) {
          if (!imageUrl)
            return "";
          try {
            const result = await this._callWorker("extractImageText", { imageUrl });
            return typeof result === "string" ? result.trim() : "";
          } catch (err) {
            console.warn("ProxyGemini: extractImageText failed:", err.message);
            return "";
          }
        }
        /**
         * Matches GeminiProvider.extractBookmarkImageTexts() signature.
         */
        async extractBookmarkImageTexts(bookmark) {
          const mediaItems = bookmark.media || [];
          const imageItems = mediaItems.filter((m) => m.type !== "video" && m.url);
          if (imageItems.length === 0)
            return [];
          const limited = imageItems.slice(0, 4);
          const results = await Promise.allSettled(
            limited.map((m) => this.extractImageText(m.url))
          );
          return results.filter((r) => r.status === "fulfilled" && r.value).map((r) => r.value);
        }
      };
      module.exports = { GeminiProvider, ProxyGeminiProvider, GEMINI_FLASH, GEMINI_PRO };
    }
  });

  // src/exporters/knowledge-base.js
  var require_knowledge_base = __commonJS({
    "src/exporters/knowledge-base.js"(exports, module) {
      function fmtNum(n) {
        const num = parseInt(n || 0, 10);
        if (num >= 1e6)
          return `${(num / 1e6).toFixed(1)}M`;
        if (num >= 1e3)
          return `${(num / 1e3).toFixed(1)}K`;
        return String(num);
      }
      function sanitize(text) {
        if (!text)
          return "";
        return String(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
      }
      function renderFrontMatter(bookmarks, aiAnalysis) {
        var _a, _b;
        const now = /* @__PURE__ */ new Date();
        const tags = ((_a = aiAnalysis == null ? void 0 : aiAnalysis.tags) == null ? void 0 : _a.slice(0, 10).join(", ")) || "";
        const categories = ((_b = aiAnalysis == null ? void 0 : aiAnalysis.categories) == null ? void 0 : _b.join(", ")) || "";
        return [
          "---",
          `title: X Bookmarks Knowledge Base`,
          `date: ${now.toISOString().slice(0, 10)}`,
          `exported: "${now.toLocaleString()}"`,
          `bookmarks: ${bookmarks.length}`,
          tags ? `tags: [${tags}]` : "",
          categories ? `categories: [${categories}]` : "",
          "---",
          ""
        ].filter(Boolean).join("\n");
      }
      function renderSummarySection(bookmarks, aiAnalysis) {
        var _a, _b;
        const parts = [];
        parts.push(`# X Bookmarks Knowledge Base
`);
        parts.push(`> Exported ${(/* @__PURE__ */ new Date()).toLocaleString()} \xB7 ${bookmarks.length} bookmarks
`);
        if (aiAnalysis == null ? void 0 : aiAnalysis.overallSummary) {
          parts.push(`## Collection Overview
`);
          parts.push(`${sanitize(aiAnalysis.overallSummary)}
`);
        }
        if ((_a = aiAnalysis == null ? void 0 : aiAnalysis.categories) == null ? void 0 : _a.length) {
          parts.push(`**Main Categories:** ${aiAnalysis.categories.join(" \xB7 ")}
`);
        }
        if ((_b = aiAnalysis == null ? void 0 : aiAnalysis.tags) == null ? void 0 : _b.length) {
          parts.push(`**Key Topics:** ${aiAnalysis.tags.map((t) => `\`${t}\``).join(" ")}
`);
        }
        parts.push(`
---
`);
        return parts.join("\n");
      }
      function renderBookmarkEntry(bookmark, index, deepAnalysis, imageTexts, customTags, articleSummary) {
        var _a;
        const parts = [];
        const author = sanitize(bookmark.displayName || bookmark.username || "Unknown");
        const handle = bookmark.username ? `@${bookmark.username}` : "";
        const date = bookmark.dateTime ? new Date(bookmark.dateTime).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "";
        const headlineParts = [`## ${index}. ${author}`];
        if (handle)
          headlineParts.push(handle);
        if (date)
          headlineParts.push(`\xB7 ${date}`);
        parts.push(headlineParts.join(" ") + "\n");
        const tweetText = sanitize(bookmark.text);
        if (tweetText) {
          parts.push(`> ${tweetText.replace(/\n/g, "\n> ")}
`);
        }
        if (deepAnalysis == null ? void 0 : deepAnalysis.summary) {
          parts.push(`
### Summary
${sanitize(deepAnalysis.summary)}
`);
        }
        if ((_a = deepAnalysis == null ? void 0 : deepAnalysis.keyInsights) == null ? void 0 : _a.length) {
          parts.push(`
### Key Insights
`);
          deepAnalysis.keyInsights.forEach((insight) => {
            parts.push(`- ${sanitize(insight)}
`);
          });
        }
        if (deepAnalysis == null ? void 0 : deepAnalysis.actionableInfo) {
          parts.push(`
### Actionable Takeaway
${sanitize(deepAnalysis.actionableInfo)}
`);
        }
        if (imageTexts && imageTexts.length > 0) {
          parts.push(`
### Image Content
`);
          imageTexts.forEach((txt, i) => {
            if (txt) {
              parts.push(`**Image ${i + 1}:** ${sanitize(txt)}

`);
            }
          });
        }
        if (articleSummary) {
          parts.push(`
### Linked Article Summary
${sanitize(articleSummary)}
`);
        }
        const metaParts = [];
        if (bookmark.likes)
          metaParts.push(`\u2665 ${fmtNum(bookmark.likes)}`);
        if (bookmark.retweets)
          metaParts.push(`\u21BA ${fmtNum(bookmark.retweets)}`);
        if (bookmark.replies)
          metaParts.push(`\u{1F4AC} ${fmtNum(bookmark.replies)}`);
        if (bookmark.views)
          metaParts.push(`\u{1F441} ${fmtNum(bookmark.views)}`);
        if (deepAnalysis == null ? void 0 : deepAnalysis.sentiment)
          metaParts.push(`Sentiment: ${deepAnalysis.sentiment}`);
        if (deepAnalysis == null ? void 0 : deepAnalysis.knowledgeValue)
          metaParts.push(`Value: ${deepAnalysis.knowledgeValue}`);
        if (metaParts.length) {
          parts.push(`
*${metaParts.join(" \xB7 ")}*
`);
        }
        const allTags = [
          ...customTags || [],
          ...(deepAnalysis == null ? void 0 : deepAnalysis.topics) || []
        ];
        const uniqueTags = [...new Set(allTags.map((t) => t.trim().toLowerCase()))].slice(0, 8);
        if (uniqueTags.length) {
          parts.push(`
**Tags:** ${uniqueTags.map((t) => `\`${t}\``).join(" ")}
`);
        }
        const mediaItems = bookmark.media || [];
        if (mediaItems.length) {
          parts.push(`
**Media:**
`);
          mediaItems.forEach((m) => {
            const label = m.type === "video" ? "Video" : "Image";
            parts.push(`- [${label}](${m.url})
`);
          });
        }
        parts.push(`
**Source:** [View on X](${bookmark.url})
`);
        parts.push(`
---
`);
        return parts.join("");
      }
      function generateKnowledgeBase(bookmarks, options = {}) {
        if (!bookmarks || bookmarks.length === 0)
          return "";
        const {
          aiAnalysis = null,
          deepAnalyses = [],
          imageTextsPerBookmark = [],
          articleSummaries = [],
          getCustomTags = () => [],
          includeFrontMatter = true
        } = options;
        const parts = [];
        if (includeFrontMatter) {
          parts.push(renderFrontMatter(bookmarks, aiAnalysis));
        }
        parts.push(renderSummarySection(bookmarks, aiAnalysis));
        bookmarks.forEach((bookmark, i) => {
          const deepAnalysis = deepAnalyses[i] || null;
          const imageTexts = imageTextsPerBookmark[i] || [];
          const articleSummary = articleSummaries[i] || "";
          const customTags = getCustomTags(bookmark.url);
          parts.push(renderBookmarkEntry(
            bookmark,
            i + 1,
            deepAnalysis,
            imageTexts,
            customTags,
            articleSummary
          ));
        });
        return parts.join("\n");
      }
      function downloadKnowledgeBase(bookmarks, options = {}) {
        const md = generateKnowledgeBase(bookmarks, options);
        if (!md)
          return;
        const date = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
        const blob = new Blob([md], { type: "text/markdown" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `x-knowledge-base-${date}.md`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
      module.exports = {
        generateKnowledgeBase,
        downloadKnowledgeBase,
        renderBookmarkEntry,
        renderSummarySection
      };
    }
  });

  // src/popup/index.js
  var require_popup = __commonJS({
    "src/popup/index.js"(exports, module) {
      var { TierManager, WORKER_URL } = require_tier_manager();
      var { GeminiProvider: GeminiProviderClass, ProxyGeminiProvider, GEMINI_FLASH, GEMINI_PRO } = require_gemini();
      var { generateKnowledgeBase, downloadKnowledgeBase } = require_knowledge_base();
      var PopupController = class {
        constructor() {
          this.tierManager = new TierManager();
          this.initializeState();
          this.bindElements();
          this.setupEventListeners();
          this.setupKeyboardShortcuts();
          this.loadSettings().then(async () => {
            await this.tierManager.revalidateSavedLicense();
            this.loadLastExtraction();
            this.render();
            this.checkReminders();
            this.updateTierUI();
          });
        }
        initializeState = () => {
          this.state = {
            lastExtraction: null,
            filteredBookmarks: null,
            // For search/filter results
            isDarkMode: false,
            aiAnalysis: null,
            apiKey: "",
            llmProvider: "none",
            // 'openai', 'anthropic', 'none'
            systemPrompt: "",
            // Custom system prompt
            renderedCount: 50,
            // Infinite scroll
            searchQuery: "",
            filterOptions: {
              minLikes: 0,
              minRetweets: 0,
              author: "",
              dateFrom: "",
              dateTo: "",
              readStatus: "all",
              // 'all', 'read', 'unread'
              hasNotes: false,
              collections: []
            },
            progress: {
              current: 0,
              total: 0,
              status: "Ready"
            },
            performanceMetrics: {
              lastExtractionTime: 0,
              lastAnalysisTime: 0,
              bookmarksExtracted: 0
            },
            // NEW FEATURES v0.10.0
            bookmarkMetadata: {},
            // { url: { read: bool, notes: string, customTags: [], favorite: bool, collection: string, archived: bool, highlights: [], readingPriority: 0 } }
            collections: [],
            // { id, name, color, bookmarkCount }
            savedSearches: [],
            // { id, name, query, filters }
            viewMode: "list",
            // 'list', 'grid', 'card'
            reminders: [],
            // { bookmarkUrl, reminderDate, message }
            // NEW FEATURES v0.11.0
            bulkSelection: [],
            // Array of selected bookmark URLs
            undoStack: [],
            // History stack for undo
            redoStack: [],
            // History stack for redo
            readingQueue: [],
            // { bookmarkUrl, priority, addedDate }
            engagementHistory: {},
            // { url: [{ timestamp, likes, retweets, replies, views }] }
            analysisStatus: "ready"
          };
          this.constants = {
            BATCH_SIZE: 100,
            SCROLL_DELAY: 1e3,
            MAX_SAFE_BOOKMARKS: 500,
            AI_ANALYSIS_LIMIT: 50,
            AI_MAX_TOKENS: 500,
            AI_TEMPERATURE: 0.7,
            AI_MODEL: "gpt-3.5-turbo",
            AUTO_SCROLL_DELAY: 2e3,
            AUTO_SCROLL_MAX_ATTEMPTS: 50,
            AUTO_SCROLL_STABLE_ATTEMPTS: 3,
            POST_SCROLL_DELAY: 1e3,
            POST_SCAN_DELAY: 1e3,
            API_KEY_MIN_LENGTH: 20,
            MAX_TAGS: 20,
            MAX_CATEGORIES: 10,
            API_RETRY_ATTEMPTS: 3,
            API_RETRY_DELAY: 1e3
          };
          this.debouncedSearch = this.debounce(this.performSearch.bind(this), 300);
        };
        bindElements = () => {
          this.elements = {
            statusBar: document.getElementById("status-bar"),
            extractionStatus: document.getElementById("extraction-status"),
            progressBar: document.getElementById("progress-container"),
            progressFill: document.querySelector(".progress-fill"),
            progressText: document.getElementById("progress-text"),
            darkModeToggle: document.getElementById("darkModeToggle"),
            clearStorageBtn: document.getElementById("clearStorageBtn"),
            bookmarksBtn: document.getElementById("bookmarksBtn"),
            scanBtn: document.getElementById("scanBtn"),
            autoScrollBtn: document.getElementById("autoScrollBtn"),
            analyzeAiBtn: document.getElementById("analyzeAiBtn"),
            exportMdBtn: document.getElementById("exportMdBtn"),
            exportCsvBtn: document.getElementById("exportCsvBtn"),
            searchInput: document.getElementById("searchInput"),
            filterBtn: document.getElementById("filterBtn"),
            mainContent: document.getElementById("mainContent"),
            closeBtn: document.getElementById("closeBtn"),
            settingsBtn: document.getElementById("settingsBtn"),
            viewModeBtn: document.getElementById("viewModeBtn"),
            exportNotionBtn: document.getElementById("exportNotionBtn"),
            exportObsidianBtn: document.getElementById("exportObsidianBtn"),
            sentimentBtn: document.getElementById("sentimentBtn"),
            aiQABtn: document.getElementById("aiQABtn"),
            authorAnalyticsBtn: document.getElementById("authorAnalyticsBtn"),
            hiddenGemsBtn: document.getElementById("hiddenGemsBtn"),
            // Tabs
            tabBtns: document.querySelectorAll(".tab-btn"),
            tabContents: document.querySelectorAll(".tab-content"),
            libraryContainer: document.getElementById("library-container"),
            // Tier & rate-limit UI
            tierBadge: document.getElementById("tierBadge"),
            rateLimitText: document.getElementById("rateLimitText"),
            // Knowledge Base export
            exportKbBtn: document.getElementById("exportKbBtn"),
            kbBtnSubtitle: document.getElementById("kbBtnSubtitle"),
            kbProgress: document.getElementById("kbProgress"),
            kbProgressFill: document.getElementById("kbProgressFill"),
            kbProgressText: document.getElementById("kbProgressText"),
            // Settings – subscription
            subTierDisplay: document.getElementById("subTierDisplay"),
            subDescription: document.getElementById("subDescription"),
            subscriptionStatus: document.getElementById("subscriptionStatus"),
            licenseKeyInput: document.getElementById("licenseKeyInput"),
            activateLicenseBtn: document.getElementById("activateLicenseBtn"),
            deactivateLicenseBtn: document.getElementById("deactivateLicenseBtn"),
            licenseMsg: document.getElementById("licenseMsg"),
            bmcUpgradeBox: document.getElementById("bmcUpgradeBox")
          };
          this.elements.tabBtns.forEach((btn) => {
            btn.addEventListener("click", () => {
              const tabName = btn.getAttribute("data-tab");
              this.switchTab(tabName);
            });
          });
        };
        switchTab = (tabName) => {
          this.elements.tabBtns.forEach((btn) => {
            if (btn.getAttribute("data-tab") === tabName) {
              btn.classList.add("active");
            } else {
              btn.classList.remove("active");
            }
          });
          this.elements.tabContents.forEach((content) => {
            if (content.id === `tab-${tabName}`) {
              content.classList.add("active");
            } else {
              content.classList.remove("active");
            }
          });
          if (tabName === "library") {
            this.renderLibrary();
          }
        };
        // Infinite Scroll Observer
        setupIntersectionObserver = () => {
          this.observer = new IntersectionObserver((entries) => {
            if (entries[0].isIntersecting) {
              this.renderLibrary(true);
            }
          }, { root: null, rootMargin: "100px", threshold: 0.1 });
        };
        renderLibrary = (append = false) => {
          const container = this.elements.libraryContainer;
          if (!container)
            return;
          if (!this.observer)
            this.setupIntersectionObserver();
          const bookmarks = this.state.filteredBookmarks || this.state.lastExtraction;
          if (!bookmarks || bookmarks.length === 0) {
            container.innerHTML = `
        <div class="empty-state" style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--disabled-color); display: flex; flex-direction: column; align-items: center; gap: 16px;">
          <div style="font-size: 48px;">\u{1F50D}</div>
          <p>No bookmarks found here.</p>
          <button id="startScanBtn" class="action-button primary">Start New Scan</button>
        </div>
      `;
            setTimeout(() => {
              const startBtn = container.querySelector("#startScanBtn");
              if (startBtn) {
                startBtn.addEventListener("click", () => {
                  this.switchTab("scan");
                });
              }
            }, 0);
            return;
          }
          if (!append) {
            container.innerHTML = "";
            this.state.renderedCount = 50;
            window.scrollTo(0, 0);
          }
          const start = append ? document.querySelectorAll(".bookmark-card").length : 0;
          const end = this.state.renderedCount;
          const toRender = bookmarks.slice(start, end);
          toRender.forEach((bookmark) => {
            const card = document.createElement("div");
            card.className = "bookmark-card";
            let bgImage = "";
            if (bookmark.media && bookmark.media.length > 0) {
              const img = bookmark.media.find((m) => m.type === "photo") || bookmark.media[0];
              bgImage = `url('${img.media_url_https || img.url}')`;
            }
            card.innerHTML = `
        <div class="card-media" style="${bgImage ? "background-image: " + bgImage : ""}">
           ${!bgImage ? '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--disabled-color);font-size:24px;">\u{1F4DD}</div>' : ""}
           <div class="card-actions-overlay">
             <div class="card-action-btn copy-btn" title="Copy Link">\u{1F517}</div>
             <div class="card-action-btn collection-btn" title="Add to Collection">\u{1F4C2}</div>
             <div class="card-action-btn favorite-btn ${bookmark.favorite ? "active" : ""}" title="Favorite">\u2764\uFE0F</div>
           </div>
        </div>
        <div class="card-content">
          <div class="card-text">${bookmark.text}</div>
          <div class="card-footer">
            <span>@${bookmark.username}</span>
            <span>\u2764\uFE0F ${bookmark.likes}</span>
          </div>
        </div>
      `;
            card.addEventListener("click", (e) => {
              if (e.target.closest(".card-action-btn"))
                return;
              window.open(bookmark.url, "_blank");
            });
            const copyBtn = card.querySelector(".copy-btn");
            copyBtn.addEventListener("click", (e) => {
              e.stopPropagation();
              navigator.clipboard.writeText(bookmark.url);
              this.showToast("Link copied to clipboard!", "success");
            });
            const collectionBtn = card.querySelector(".collection-btn");
            collectionBtn.addEventListener("click", (e) => {
              e.stopPropagation();
              this.state.bulkSelection = [bookmark.url];
              this.showCollectionsDialog();
            });
            const favoriteBtn = card.querySelector(".favorite-btn");
            favoriteBtn.addEventListener("click", async (e) => {
              e.stopPropagation();
              bookmark.favorite = !bookmark.favorite;
              favoriteBtn.classList.toggle("active");
              await chrome.storage.local.set({ lastExtraction: this.state.lastExtraction });
              this.showToast(bookmark.favorite ? "Added to favorites" : "Removed from favorites", "success");
            });
            container.appendChild(card);
          });
          const existingSentinel = document.getElementById("infinite-scroll-sentinel");
          if (existingSentinel)
            existingSentinel.remove();
          if (this.state.renderedCount < bookmarks.length) {
            const sentinel = document.createElement("div");
            sentinel.id = "infinite-scroll-sentinel";
            sentinel.style.height = "20px";
            sentinel.style.width = "100%";
            container.appendChild(sentinel);
            this.state.renderedCount += 50;
            this.observer.observe(sentinel);
          }
        };
        loadSettings = async () => {
          const settings = await chrome.storage.local.get([
            "settings",
            "apiKey",
            "llmProvider",
            "bookmarkMetadata",
            "collections",
            "savedSearches",
            "viewMode",
            "reminders",
            "readingQueue",
            "engagementHistory",
            "systemPrompt"
          ]);
          if (settings.settings) {
            this.state.isDarkMode = settings.settings.darkMode || false;
            this.updateTheme();
          }
          if (settings.apiKey) {
            this.state.apiKey = settings.apiKey;
          }
          if (settings.llmProvider) {
            this.state.llmProvider = settings.llmProvider;
          }
          if (settings.systemPrompt) {
            this.state.systemPrompt = settings.systemPrompt;
          }
          if (settings.bookmarkMetadata) {
            this.state.bookmarkMetadata = settings.bookmarkMetadata;
          }
          if (settings.collections) {
            this.state.collections = settings.collections;
          }
          if (settings.savedSearches) {
            this.state.savedSearches = settings.savedSearches;
          }
          if (settings.viewMode) {
            this.state.viewMode = settings.viewMode;
          }
          if (settings.reminders) {
            this.state.reminders = settings.reminders;
          }
          if (settings.readingQueue) {
            this.state.readingQueue = settings.readingQueue;
          }
          if (settings.engagementHistory) {
            this.state.engagementHistory = settings.engagementHistory;
          }
        };
        saveSettings = async () => {
          await chrome.storage.local.set({
            settings: {
              darkMode: this.state.isDarkMode
            },
            bookmarkMetadata: this.state.bookmarkMetadata,
            collections: this.state.collections,
            savedSearches: this.state.savedSearches,
            viewMode: this.state.viewMode,
            reminders: this.state.reminders,
            readingQueue: this.state.readingQueue,
            engagementHistory: this.state.engagementHistory
          });
        };
        validateApiKey = (apiKey, provider) => {
          if (!apiKey || typeof apiKey !== "string") {
            return { valid: false, error: "API key is required" };
          }
          const trimmedKey = apiKey.trim();
          if (trimmedKey.length === 0) {
            return { valid: false, error: "API key cannot be empty" };
          }
          if (provider === "openai") {
            if (!trimmedKey.startsWith("sk-")) {
              return { valid: false, error: 'Invalid API key format. OpenAI keys start with "sk-"' };
            }
          } else if (provider === "anthropic") {
            if (!trimmedKey.startsWith("sk-ant-")) {
              return { valid: false, error: 'Invalid API key format. Anthropic keys start with "sk-ant-"' };
            }
          } else if (provider === "gemini") {
            if (!trimmedKey.startsWith("AIza")) {
              return { valid: false, error: 'Invalid API key format. Gemini keys usually start with "AIza"' };
            }
          }
          if (trimmedKey.length < this.constants.API_KEY_MIN_LENGTH) {
            return { valid: false, error: "API key is too short. Please check your key." };
          }
          return { valid: true, error: null };
        };
        saveApiKey = async (apiKey) => {
          this.state.apiKey = apiKey;
          await chrome.storage.local.set({ apiKey });
        };
        loadLastExtraction = async () => {
          const result = await chrome.storage.local.get(["lastExtraction", "aiAnalysis", "performanceMetrics", "manualBookmarks"]);
          let allBookmarks = [];
          if (result.lastExtraction) {
            allBookmarks = result.lastExtraction.bookmarks || [];
            this.updateExtractionStatus(result.lastExtraction.timestamp);
          }
          if (result.manualBookmarks && result.manualBookmarks.length > 0) {
            allBookmarks = [...allBookmarks, ...result.manualBookmarks];
          }
          const uniqueBookmarks = [];
          const seenUrls = /* @__PURE__ */ new Set();
          allBookmarks.sort((a, b) => {
            const dateA = new Date(a.savedAt || a.dateTime || 0);
            const dateB = new Date(b.savedAt || b.dateTime || 0);
            return dateB - dateA;
          });
          for (const bookmark of allBookmarks) {
            if (bookmark.url && !seenUrls.has(bookmark.url)) {
              uniqueBookmarks.push(bookmark);
              seenUrls.add(bookmark.url);
            }
          }
          this.state.lastExtraction = uniqueBookmarks;
          this.updateUI();
          if (result.aiAnalysis) {
            this.state.aiAnalysis = result.aiAnalysis;
          }
          if (result.performanceMetrics) {
            this.state.performanceMetrics = result.performanceMetrics;
          }
        };
        setupEventListeners = () => {
          var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z;
          (_a = this.elements.darkModeToggle) == null ? void 0 : _a.addEventListener("change", (e) => this.handleDarkModeToggle(e));
          (_b = this.elements.clearStorageBtn) == null ? void 0 : _b.addEventListener("click", () => this.handleClearStorage());
          (_c = this.elements.scanBtn) == null ? void 0 : _c.addEventListener("click", () => this.handleScan());
          (_d = this.elements.autoScrollBtn) == null ? void 0 : _d.addEventListener("click", () => this.handleAutoScroll());
          (_e = this.elements.bookmarksBtn) == null ? void 0 : _e.addEventListener("click", () => this.openBookmarksPage());
          (_f = this.elements.analyzeAiBtn) == null ? void 0 : _f.addEventListener("click", () => this.analyzeBookmarks());
          (_g = this.elements.exportMdBtn) == null ? void 0 : _g.addEventListener("click", () => this.downloadMarkdown());
          (_h = this.elements.exportCsvBtn) == null ? void 0 : _h.addEventListener("click", () => this.downloadCSV());
          (_i = this.elements.exportJsonBtn) == null ? void 0 : _i.addEventListener("click", () => this.downloadJSON());
          (_j = this.elements.exportHtmlBtn) == null ? void 0 : _j.addEventListener("click", () => this.downloadHTML());
          (_k = this.elements.copyClipboardBtn) == null ? void 0 : _k.addEventListener("click", () => this.copyToClipboard());
          (_l = this.elements.searchInput) == null ? void 0 : _l.addEventListener("input", (e) => {
            this.state.searchQuery = e.target.value;
            this.debouncedSearch();
          });
          (_m = this.elements.filterBtn) == null ? void 0 : _m.addEventListener("click", () => this.showFilterDialog());
          (_n = this.elements.sortBtn) == null ? void 0 : _n.addEventListener("click", () => this.showSortDialog());
          (_o = this.elements.closeBtn) == null ? void 0 : _o.addEventListener("click", () => window.close());
          (_p = this.elements.settingsBtn) == null ? void 0 : _p.addEventListener("click", () => this.showSettingsDialog());
          (_q = this.elements.viewModeBtn) == null ? void 0 : _q.addEventListener("click", () => this.toggleViewMode());
          (_r = this.elements.exportNotionBtn) == null ? void 0 : _r.addEventListener("click", () => this.downloadNotion());
          (_s = this.elements.exportObsidianBtn) == null ? void 0 : _s.addEventListener("click", () => this.downloadObsidian());
          (_t = this.elements.sentimentBtn) == null ? void 0 : _t.addEventListener("click", () => this.showSentimentAnalysis());
          (_u = this.elements.aiQABtn) == null ? void 0 : _u.addEventListener("click", () => this.showAIQADialog());
          (_v = this.elements.authorAnalyticsBtn) == null ? void 0 : _v.addEventListener("click", () => this.showAuthorAnalytics());
          (_w = this.elements.hiddenGemsBtn) == null ? void 0 : _w.addEventListener("click", () => this.showHiddenGems());
          (_x = this.elements.exportKbBtn) == null ? void 0 : _x.addEventListener("click", () => this.exportKnowledgeBase());
          (_y = this.elements.activateLicenseBtn) == null ? void 0 : _y.addEventListener("click", () => this.handleActivateLicense());
          (_z = this.elements.deactivateLicenseBtn) == null ? void 0 : _z.addEventListener("click", () => this.handleDeactivateLicense());
          chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
            if (msg.type === "progressUpdate") {
              this.handleProgressUpdate(msg.progress);
            }
          });
        };
        updateUI = () => {
          this.updateExportButtons();
          this.updateProgressBar();
        };
        updateExportButtons = () => {
          const hasData = this.state.lastExtraction && this.state.lastExtraction.length > 0;
          if (this.elements.exportMdBtn)
            this.elements.exportMdBtn.disabled = !hasData;
          if (this.elements.exportCsvBtn)
            this.elements.exportCsvBtn.disabled = !hasData;
          if (this.elements.analyzeAiBtn)
            this.elements.analyzeAiBtn.disabled = !hasData;
          if (this.elements.exportNotionBtn)
            this.elements.exportNotionBtn.disabled = !hasData;
          if (this.elements.exportObsidianBtn)
            this.elements.exportObsidianBtn.disabled = !hasData;
          if (this.elements.exportKbBtn) {
            this.tierManager.isProUser().then((isPro) => {
              const canKb = hasData && (isPro || this.state.llmProvider === "gemini" && !!this.state.apiKey);
              this.elements.exportKbBtn.disabled = !canKb;
            }).catch(() => {
              this.elements.exportKbBtn.disabled = !hasData;
            });
          }
        };
        updateProgressBar = () => {
          const { current, total } = this.state.progress;
          if (total > 0) {
            const percent = Math.round(current / total * 100);
            if (this.elements.progressFill) {
              this.elements.progressFill.style.width = `${percent}%`;
            }
            if (this.elements.progressText) {
              this.elements.progressText.textContent = `${current} / ${total} bookmarks`;
            }
            if (this.elements.progressBar) {
              this.elements.progressBar.style.display = "block";
            }
            const progressBarEl = document.getElementById("progress-bar");
            if (progressBarEl) {
              progressBarEl.setAttribute("aria-valuenow", percent);
              progressBarEl.setAttribute("aria-valuetext", `${current} of ${total} bookmarks processed`);
            }
          } else {
            if (this.elements.progressBar) {
              this.elements.progressBar.style.display = "none";
            }
          }
        };
        updateTheme = () => {
          document.body.setAttribute("data-theme", this.state.isDarkMode ? "dark" : "light");
        };
        updateStatus = (message, type = "info") => {
          if (this.elements.statusBar) {
            this.elements.statusBar.textContent = message;
            this.elements.statusBar.setAttribute("aria-label", message);
          }
          this.showToast(message, type);
        };
        showToast = (message, type = "info") => {
          let container = document.querySelector(".toast-container");
          if (!container) {
            container = document.createElement("div");
            container.className = "toast-container";
            document.body.appendChild(container);
          }
          const toast = document.createElement("div");
          toast.className = `toast toast-${type}`;
          let icon = "";
          if (type === "success")
            icon = "\u2705";
          else if (type === "error")
            icon = "\u274C";
          else if (type === "warning")
            icon = "\u26A0\uFE0F";
          else
            icon = "\u2139\uFE0F";
          toast.innerHTML = `<span>${icon}</span><span>${message}</span>`;
          container.appendChild(toast);
          setTimeout(() => {
            toast.classList.add("fade-out");
            toast.addEventListener("animationend", () => {
              toast.remove();
              if (container.children.length === 0) {
                container.remove();
              }
            });
          }, 3e3);
        };
        updateExtractionStatus = (timestamp) => {
          if (!this.elements.extractionStatus)
            return;
          if (!this.state.lastExtraction) {
            this.elements.extractionStatus.textContent = "";
            return;
          }
          const age = Date.now() - timestamp;
          const minutes = Math.floor(age / 6e4);
          this.elements.extractionStatus.textContent = `${this.state.lastExtraction.length} bookmarks from ${minutes} minutes ago`;
        };
        // Event Handlers
        handleDarkModeToggle = async (event) => {
          this.state.isDarkMode = event.target.checked;
          this.updateTheme();
          await this.saveSettings();
        };
        showConfirmDialog = (message, onConfirm) => {
          const dialog = document.createElement("div");
          dialog.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.7);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
    `;
          const dialogContent = document.createElement("div");
          dialogContent.style.cssText = `
      background: var(--bg-color);
      padding: 24px;
      border-radius: 8px;
      max-width: 400px;
      width: 90%;
    `;
          const messageEl = document.createElement("p");
          messageEl.style.cssText = "color: var(--text-color); margin: 0 0 16px 0; font-size: 15px;";
          messageEl.textContent = message;
          dialogContent.appendChild(messageEl);
          const buttonContainer = document.createElement("div");
          buttonContainer.style.cssText = "display: flex; gap: 8px; justify-content: flex-end;";
          const cancelBtn = document.createElement("button");
          cancelBtn.textContent = "Cancel";
          cancelBtn.style.cssText = "padding: 8px 16px; border: 1px solid var(--border-color); background: transparent; color: var(--text-color); border-radius: 4px; cursor: pointer;";
          cancelBtn.addEventListener("click", () => {
            document.body.removeChild(dialog);
          });
          const confirmBtn = document.createElement("button");
          confirmBtn.textContent = "Confirm";
          confirmBtn.style.cssText = "padding: 8px 16px; border: none; background: var(--danger-color); color: white; border-radius: 4px; cursor: pointer;";
          confirmBtn.addEventListener("click", () => {
            document.body.removeChild(dialog);
            onConfirm();
          });
          buttonContainer.appendChild(cancelBtn);
          buttonContainer.appendChild(confirmBtn);
          dialogContent.appendChild(buttonContainer);
          dialog.appendChild(dialogContent);
          document.body.appendChild(dialog);
          const escHandler = (e) => {
            if (e.key === "Escape") {
              document.body.removeChild(dialog);
              document.removeEventListener("keydown", escHandler);
            }
          };
          document.addEventListener("keydown", escHandler);
          dialog.addEventListener("click", (e) => {
            if (e.target === dialog) {
              document.body.removeChild(dialog);
              document.removeEventListener("keydown", escHandler);
            }
          });
        };
        handleClearStorage = async () => {
          this.showConfirmDialog(
            "Are you sure you want to clear all stored bookmarks and AI analysis? This cannot be undone.",
            async () => {
              this.state.lastExtraction = null;
              this.state.aiAnalysis = null;
              await chrome.storage.local.remove(["lastExtraction", "aiAnalysis"]);
              const existingResults = document.getElementById("ai-results");
              if (existingResults) {
                existingResults.remove();
              }
              this.updateStatus("Stored bookmarks and analysis cleared");
              this.updateUI();
            }
          );
        };
        handleProgressUpdate = (progress) => {
          this.state.progress = progress;
          this.updateUI();
        };
        handleScanComplete = async (bookmarks, performanceData, isQuickScan = false) => {
          this.state.lastExtraction = bookmarks;
          if (performanceData) {
            this.state.performanceMetrics.lastExtractionTime = performanceData.duration || 0;
            this.state.performanceMetrics.bookmarksExtracted = performanceData.tweetsExtracted || bookmarks.length;
          }
          await chrome.storage.local.set({
            lastExtraction: {
              timestamp: Date.now(),
              bookmarks
            },
            performanceMetrics: this.state.performanceMetrics
          });
          this.updateStatus(`Successfully extracted ${bookmarks.length} bookmark${bookmarks.length !== 1 ? "s" : ""}`);
          if (isQuickScan && bookmarks.length < 20) {
            this.updateStatus(`\u26A0\uFE0F Only ${bookmarks.length} visible bookmark${bookmarks.length !== 1 ? "s" : ""} scanned. Use "Scan All Bookmarks" to load and scan ALL your bookmarks!`);
          }
          if (bookmarks.length > this.constants.MAX_SAFE_BOOKMARKS) {
            this.updateStatus("Warning: Large bookmark set detected. Consider batch processing.");
          }
          this.updateUI();
          this.switchTab("library");
          if (bookmarks.length > 0) {
            if (this.state.llmProvider === "none") {
              this.analyzeBookmarks();
            } else if (this.state.apiKey && this.state.llmProvider !== "none") {
              this.analyzeBookmarks();
            }
          }
        };
        handleScan = () => {
          this.updateStatus("Quick scanning visible bookmarks only...");
          chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            chrome.tabs.sendMessage(tabs[0].id, {
              action: "scanBookmarks"
            }, (response) => {
              if (chrome.runtime.lastError) {
                this.updateStatus("Error: Could not connect to page. Please refresh and try again.");
                return;
              }
              if (response && response.success) {
                this.handleScanComplete(response.tweets || [], response.performance, true);
              } else {
                this.updateStatus("Error: Failed to scan bookmarks.");
              }
            });
          });
        };
        handleAutoScroll = () => {
          this.updateStatus("\u{1F504} Auto-scrolling to load all bookmarks... (this may take a minute)");
          chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const tabId = tabs[0].id;
            chrome.scripting.executeScript({
              target: { tabId },
              func: async () => {
                const progressiveScanAndScroll = async () => {
                  const allBookmarks = /* @__PURE__ */ new Map();
                  let lastHeight = 0;
                  let scrollAttempts = 0;
                  const maxAttempts = 50;
                  const scrollDelay = 2e3;
                  const stableAttempts = 3;
                  const extractCurrentBookmarks = () => {
                    const articles = document.querySelectorAll("article");
                    const bookmarks = [];
                    articles.forEach((article) => {
                      var _a, _b, _c, _d;
                      try {
                        const link = article.querySelector('a[href*="/status/"]');
                        const url = link ? link.href : "";
                        if (!url)
                          return;
                        if (allBookmarks.has(url))
                          return;
                        const textEls = article.querySelectorAll('[data-testid="tweetText"]');
                        const textParts = [];
                        textEls.forEach((el) => {
                          var _a2;
                          const text2 = (_a2 = el.textContent) == null ? void 0 : _a2.trim();
                          if (text2)
                            textParts.push(text2);
                        });
                        const text = textParts.join(" ");
                        let displayName = "";
                        let username = "";
                        const header = (_b = (_a = article.querySelector('div[role="group"]')) == null ? void 0 : _a.parentElement) == null ? void 0 : _b.parentElement;
                        if (header) {
                          const spans = header.querySelectorAll("span");
                          if (spans.length > 0)
                            displayName = ((_c = spans[0].textContent) == null ? void 0 : _c.trim()) || "";
                          for (const span of spans) {
                            const spanText = (_d = span.textContent) == null ? void 0 : _d.trim();
                            if (spanText && spanText.startsWith("@")) {
                              username = spanText.replace("@", "");
                              break;
                            }
                          }
                        }
                        if (!username && url) {
                          const match = url.match(/(?:x\.com|twitter\.com)\/([^\/]+)\/status/);
                          if (match)
                            username = match[1];
                        }
                        const timeEl = article.querySelector("time");
                        const dateTime = timeEl ? timeEl.getAttribute("datetime") || "" : "";
                        const extractNumber = (text2) => {
                          if (!text2)
                            return "";
                          const abbrevMatch = text2.match(/([\d,.]+)\s*([KMBkmb])/);
                          if (abbrevMatch) {
                            const num = parseFloat(abbrevMatch[1].replace(/,/g, ""));
                            const suffix = abbrevMatch[2].toUpperCase();
                            const multipliers = { "K": 1e3, "M": 1e6, "B": 1e9 };
                            return Math.round(num * (multipliers[suffix] || 1)).toString();
                          }
                          const numberMatch = text2.match(/([\d,.]+)/);
                          return numberMatch ? numberMatch[1].replace(/,/g, "") : "";
                        };
                        const likeEl = article.querySelector('[data-testid="like"]');
                        const likes = likeEl ? extractNumber(likeEl.textContent) : "";
                        const retweetEl = article.querySelector('[data-testid="retweet"]');
                        const retweets = retweetEl ? extractNumber(retweetEl.textContent) : "";
                        const replyEl = article.querySelector('[data-testid="reply"]');
                        const replies = replyEl ? extractNumber(replyEl.textContent) : "";
                        let views = "";
                        const viewEls = article.querySelectorAll('a[aria-label*="View"], span[aria-label*="View"]');
                        for (const el of viewEls) {
                          const label = el.getAttribute("aria-label");
                          if (label && /view/i.test(label)) {
                            views = extractNumber(label);
                            break;
                          }
                        }
                        bookmarks.push({
                          url,
                          text,
                          displayName,
                          username,
                          dateTime,
                          likes,
                          retweets,
                          replies,
                          views
                        });
                      } catch (err) {
                        console.error("[X Extractor] Error extracting bookmark:", err);
                      }
                    });
                    return bookmarks;
                  };
                  while (scrollAttempts < maxAttempts) {
                    const currentBookmarks = extractCurrentBookmarks();
                    currentBookmarks.forEach((bookmark) => {
                      allBookmarks.set(bookmark.url, bookmark);
                    });
                    console.log(`[X Extractor] Extracted ${allBookmarks.size} bookmarks so far...`);
                    const previousHeight = document.body.scrollHeight;
                    window.scrollTo(0, previousHeight);
                    await new Promise((resolve) => {
                      let resolved = false;
                      const timeoutId = setTimeout(() => {
                        if (!resolved) {
                          resolved = true;
                          resolve();
                        }
                      }, 4e3);
                      const handler = () => {
                        if (!resolved) {
                          resolved = true;
                          clearTimeout(timeoutId);
                          window.removeEventListener("x-bookmarks-response", handler);
                          setTimeout(resolve, 500);
                        }
                      };
                      window.addEventListener("x-bookmarks-response", handler);
                    });
                    const newHeight = document.body.scrollHeight;
                    if (newHeight === lastHeight) {
                      scrollAttempts++;
                      if (scrollAttempts >= stableAttempts)
                        break;
                    } else {
                      scrollAttempts = 0;
                    }
                    lastHeight = newHeight;
                  }
                  const finalBookmarks = extractCurrentBookmarks();
                  finalBookmarks.forEach((bookmark) => {
                    allBookmarks.set(bookmark.url, bookmark);
                  });
                  return {
                    success: true,
                    bookmarks: Array.from(allBookmarks.values()),
                    count: allBookmarks.size
                  };
                };
                return await progressiveScanAndScroll();
              }
            }, (results) => {
              if (chrome.runtime.lastError) {
                this.updateStatus("Error during auto-scroll. Please refresh and try again.");
                return;
              }
              if (!results || !results[0] || !results[0].result) {
                this.updateStatus("Error: Failed to extract bookmarks.");
                return;
              }
              const result = results[0].result;
              if (result.success && result.bookmarks) {
                this.updateStatus(`\u2713 Successfully extracted ${result.count} bookmark${result.count !== 1 ? "s" : ""}!`);
                this.handleScanComplete(result.bookmarks, { duration: 0, tweetsExtracted: result.count }, false);
              } else {
                this.updateStatus("Error: Failed to scan bookmarks.");
              }
            });
          });
        };
        analyzeBookmarks = async () => {
          if (!this.state.lastExtraction || this.state.lastExtraction.length === 0) {
            this.updateStatus("No bookmarks to analyze.");
            return;
          }
          if (this.state.llmProvider === "none") {
            this.analyzeLLMFree();
            return;
          }
          if (!this.state.apiKey && this.state.llmProvider !== "none") {
            this.updateStatus("No API key configured. Click settings to add one or use LLM-free mode.");
            return;
          }
          if (this.elements.analyzeAiBtn) {
            this.elements.analyzeAiBtn.disabled = true;
            this.elements.analyzeAiBtn.textContent = "Analyzing...";
          }
          const startTime = performance.now();
          const bookmarkCount = this.state.lastExtraction.length;
          const analyzeCount = Math.min(bookmarkCount, this.constants.AI_ANALYSIS_LIMIT);
          if (bookmarkCount > this.constants.AI_ANALYSIS_LIMIT) {
            this.updateStatus(`Analyzing first ${analyzeCount} of ${bookmarkCount} bookmarks...`);
          } else {
            this.updateStatus(`Analyzing ${analyzeCount} bookmarks...`);
          }
          try {
            const provider = this.createLLMProvider();
            const analysis = await this.retryOperation(() => provider.analyzeBookmarks(this.state.lastExtraction));
            const duration = Math.round(performance.now() - startTime);
            this.state.performanceMetrics.lastAnalysisTime = duration;
            await chrome.storage.local.set({ performanceMetrics: this.state.performanceMetrics });
            this.state.aiAnalysis = analysis;
            await chrome.storage.local.set({ aiAnalysis: analysis });
            let statusMsg = `Analysis complete! Found ${analysis.tags.length} tags and ${analysis.categories.length} categories.`;
            if (bookmarkCount > this.constants.AI_ANALYSIS_LIMIT) {
              statusMsg += ` (Analyzed first ${this.constants.AI_ANALYSIS_LIMIT} of ${bookmarkCount} bookmarks)`;
            }
            this.updateStatus(statusMsg);
            this.showAnalysisResults(analysis);
          } catch (error) {
            console.error("AI Analysis error:", error);
            this.updateStatus(`Analysis failed: ${error.message}`);
          } finally {
            if (this.elements.analyzeAiBtn) {
              this.elements.analyzeAiBtn.disabled = false;
              this.elements.analyzeAiBtn.textContent = "Analyze Bookmarks";
            }
          }
        };
        createLLMProvider = (modelTier = "flash") => {
          switch (this.state.llmProvider) {
            case "gemini":
              return new GeminiProviderClass(this.state.apiKey, this.constants, modelTier);
            case "openai":
              return new OpenAIProvider(this.state.apiKey, this.state.systemPrompt);
            case "anthropic":
              return new AnthropicProvider(this.state.apiKey, this.state.systemPrompt);
            case "none":
              return new LLMFreeProvider(this.constants);
            default:
              throw new Error("Unknown LLM provider");
          }
        };
        createGeminiProvider = async () => {
          const isPro = await this.tierManager.isProUser();
          if (isPro) {
            const token = await this.tierManager.getToken();
            return new ProxyGeminiProvider(token, WORKER_URL, this.constants);
          }
          return new GeminiProviderClass(this.state.apiKey, this.constants, "flash");
        };
        analyzeLLMFree = async () => {
          if (this.elements.analyzeAiBtn) {
            this.elements.analyzeAiBtn.disabled = true;
            this.elements.analyzeAiBtn.textContent = "Analyzing...";
          }
          const startTime = performance.now();
          const bookmarkCount = this.state.lastExtraction.length;
          this.updateStatus(`Analyzing ${bookmarkCount} bookmarks (LLM-free mode)...`);
          try {
            const provider = new LLMFreeProvider(this.constants);
            const analysis = await provider.analyzeBookmarks(this.state.lastExtraction);
            const duration = Math.round(performance.now() - startTime);
            this.state.performanceMetrics.lastAnalysisTime = duration;
            await chrome.storage.local.set({ performanceMetrics: this.state.performanceMetrics });
            this.state.aiAnalysis = analysis;
            await chrome.storage.local.set({ aiAnalysis: analysis });
            this.updateStatus(`Analysis complete! Found ${analysis.tags.length} tags and ${analysis.categories.length} categories.`);
            this.showAnalysisResults(analysis);
          } catch (error) {
            console.error("Analysis error:", error);
            this.updateStatus(`Analysis failed: ${error.message}`);
          } finally {
            if (this.elements.analyzeAiBtn) {
              this.elements.analyzeAiBtn.disabled = false;
              this.elements.analyzeAiBtn.textContent = "Analyze Bookmarks";
            }
          }
        };
        // Sanitize text to prevent XSS attacks
        sanitizeText = (text) => {
          if (!text)
            return "";
          const div = document.createElement("div");
          div.textContent = text;
          return div.innerHTML;
        };
        showAnalysisResults = (analysis) => {
          const existingResults = document.getElementById("ai-results");
          if (existingResults) {
            existingResults.remove();
          }
          const resultsDiv = document.createElement("div");
          resultsDiv.id = "ai-results";
          resultsDiv.style.cssText = `
      margin: 16px 0;
      padding: 16px;
      background: var(--bg-color);
      border: 1px solid var(--border-color);
      border-radius: 8px;
    `;
          const title = document.createElement("h3");
          title.style.cssText = "margin-top: 0; color: var(--text-color);";
          title.textContent = "AI Analysis Results";
          resultsDiv.appendChild(title);
          if (analysis.overallSummary) {
            const summaryDiv = document.createElement("div");
            summaryDiv.style.cssText = "margin-bottom: 16px;";
            const summaryLabel = document.createElement("strong");
            summaryLabel.style.color = "var(--text-color)";
            summaryLabel.textContent = "Overall Summary:";
            summaryDiv.appendChild(summaryLabel);
            const summaryText = document.createElement("p");
            summaryText.style.cssText = "color: var(--text-color); margin: 8px 0;";
            summaryText.textContent = analysis.overallSummary;
            summaryDiv.appendChild(summaryText);
            resultsDiv.appendChild(summaryDiv);
          }
          if (analysis.tags && analysis.tags.length > 0) {
            const tagsDiv = document.createElement("div");
            tagsDiv.style.cssText = "margin-bottom: 16px;";
            const tagsLabel = document.createElement("strong");
            tagsLabel.style.color = "var(--text-color)";
            tagsLabel.textContent = "Tags:";
            tagsDiv.appendChild(tagsLabel);
            tagsDiv.appendChild(document.createElement("br"));
            const tagsContainer = document.createElement("div");
            tagsContainer.style.cssText = "margin-top: 8px;";
            analysis.tags.forEach((tag) => {
              const tagSpan = document.createElement("span");
              tagSpan.style.cssText = "display: inline-block; background: var(--primary-color); color: white; padding: 4px 12px; margin: 4px; border-radius: 16px; font-size: 12px;";
              tagSpan.textContent = tag;
              tagsContainer.appendChild(tagSpan);
            });
            tagsDiv.appendChild(tagsContainer);
            resultsDiv.appendChild(tagsDiv);
          }
          if (analysis.categories && analysis.categories.length > 0) {
            const categoriesDiv = document.createElement("div");
            categoriesDiv.style.cssText = "margin-bottom: 16px;";
            const categoriesLabel = document.createElement("strong");
            categoriesLabel.style.color = "var(--text-color)";
            categoriesLabel.textContent = "Categories:";
            categoriesDiv.appendChild(categoriesLabel);
            const categoriesList = document.createElement("ul");
            categoriesList.style.cssText = "color: var(--text-color); margin: 8px 0; padding-left: 20px;";
            analysis.categories.forEach((cat) => {
              const li = document.createElement("li");
              li.textContent = cat;
              categoriesList.appendChild(li);
            });
            categoriesDiv.appendChild(categoriesList);
            resultsDiv.appendChild(categoriesDiv);
          }
          const analyzeBtn = document.createElement("button");
          analyzeBtn.id = "analyzeBtn";
          analyzeBtn.style.cssText = "background: var(--primary-color); color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; margin-top: 8px;";
          analyzeBtn.textContent = "Re-analyze";
          analyzeBtn.addEventListener("click", () => this.analyzeBookmarks());
          resultsDiv.appendChild(analyzeBtn);
          const statusContainer = document.querySelector(".status-container");
          if (statusContainer && statusContainer.parentNode) {
            statusContainer.parentNode.insertBefore(resultsDiv, statusContainer.nextSibling);
          }
        };
        showSettingsDialog = () => {
          const dialog = document.createElement("div");
          dialog.setAttribute("role", "dialog");
          dialog.setAttribute("aria-modal", "true");
          dialog.setAttribute("aria-labelledby", "settings-dialog-title");
          dialog.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.7);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
    `;
          const dialogContent = document.createElement("div");
          dialogContent.style.cssText = `
      background: var(--bg-color);
      padding: 24px;
      border-radius: 8px;
      max-width: 450px;
      width: 90%;
      max-height: 80vh;
      overflow-y: auto;
    `;
          const providerOptions = `
      <option value="none" ${this.state.llmProvider === "none" ? "selected" : ""}>None (LLM-free mode)</option>
      <option value="openai" ${this.state.llmProvider === "openai" ? "selected" : ""}>OpenAI</option>
      <option value="anthropic" ${this.state.llmProvider === "anthropic" ? "selected" : ""}>Anthropic (Claude)</option>
      <option value="gemini" ${this.state.llmProvider === "gemini" ? "selected" : ""}>Google Gemini (Free Tier Available)</option>
    `;
          dialogContent.innerHTML = `
      <h2 id="settings-dialog-title" style="margin-top: 0; color: var(--text-color);">Settings</h2>

      <div style="margin-bottom: 16px;">
        <label style="display: block; margin-bottom: 8px; color: var(--text-color);">
          Analysis Provider:
          <select id="providerSelect" style="width: 100%; padding: 8px; margin-top: 4px; border: 1px solid var(--border-color); border-radius: 4px; background: var(--bg-color); color: var(--text-color);">
            ${providerOptions}
          </select>
        </label>
        <small style="color: var(--disabled-color);">
          <strong>Free & Private:</strong> Bring your own API key to analyze bookmarks. 
          Google Gemini has a generous free tier. Your key is stored locally.
        </small>
      </div>

      <div id="apiKeySection" style="margin-bottom: 16px; ${this.state.llmProvider === "none" ? "display: none;" : ""}">
        <label style="display: block; margin-bottom: 8px; color: var(--text-color);">
          <span id="apiKeyLabel">API Key:</span>
          <input type="password" id="apiKeyInput" value="${this.state.apiKey}"
                 style="width: 100%; padding: 8px; margin-top: 4px; border: 1px solid var(--border-color); border-radius: 4px; background: var(--bg-color); color: var(--text-color);">
        </label>
        <small id="apiKeyHelp" style="color: var(--disabled-color);"></small>
      </div>
      
      <div id="systemPromptSection" style="margin-bottom: 24px;">
        <label style="display: block; margin-bottom: 8px; color: var(--text-color);">
          System Prompt (Optional):
          <textarea id="systemPromptInput" 
                 placeholder="Custom instructions for the AI (e.g., 'Focus on technical details', 'Summarize as bullet points'). Default is 'You are a helpful assistant...'"
                 style="width: 100%; padding: 8px; margin-top: 4px; border: 1px solid var(--border-color); border-radius: 4px; background: var(--bg-color); color: var(--text-color); min-height: 80px; resize: vertical;">${this.state.systemPrompt || ""}</textarea>
        </label>
        <small style="color: var(--disabled-color);">Override the default AI personality and instructions.</small>
      </div>

      <div style="display: flex; gap: 8px; justify-content: flex-end;">
        <button id="cancelBtn" style="padding: 8px 16px; border: 1px solid var(--border-color); background: transparent; color: var(--text-color); border-radius: 4px; cursor: pointer;">Cancel</button>
        <button id="saveBtn" style="padding: 8px 16px; border: none; background: var(--primary-color); color: white; border-radius: 4px; cursor: pointer;">Save</button>
      </div>
    `;
          dialog.appendChild(dialogContent);
          document.body.appendChild(dialog);
          const updateApiKeySection = (provider) => {
            const apiKeySection = document.getElementById("apiKeySection");
            const apiKeyLabel = document.getElementById("apiKeyLabel");
            const apiKeyHelp = document.getElementById("apiKeyHelp");
            const systemPromptSection = document.getElementById("systemPromptSection");
            systemPromptSection.style.display = provider === "none" ? "none" : "block";
            if (provider === "none") {
              apiKeySection.style.display = "none";
            } else {
              apiKeySection.style.display = "block";
              if (provider === "openai") {
                apiKeyLabel.textContent = "OpenAI API Key:";
                apiKeyHelp.innerHTML = 'Get your API key from <a href="https://platform.openai.com/api-keys" target="_blank" style="color: var(--primary-color);">OpenAI</a>';
              } else if (provider === "anthropic") {
                apiKeyLabel.textContent = "Anthropic API Key:";
                apiKeyHelp.innerHTML = 'Get your API key from <a href="https://console.anthropic.com/settings/keys" target="_blank" style="color: var(--primary-color);">Anthropic Console</a>';
              } else if (provider === "gemini") {
                apiKeyLabel.textContent = "Gemini API Key (Recommended):";
                apiKeyHelp.innerHTML = 'Free to use! Get your key from <a href="https://aistudio.google.com/app/apikey" target="_blank" style="color: var(--primary-color);">Google AI Studio</a>';
              }
            }
          };
          const providerSelect = document.getElementById("providerSelect");
          updateApiKeySection(providerSelect.value);
          providerSelect.addEventListener("change", (e) => {
            updateApiKeySection(e.target.value);
          });
          const previouslyFocused = document.activeElement;
          const getFocusableElements = () => {
            return dialogContent.querySelectorAll(
              'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
            );
          };
          const focusableElements = getFocusableElements();
          if (focusableElements.length > 0) {
            focusableElements[0].focus();
          }
          const handleTabKey = (e) => {
            const focusables = Array.from(getFocusableElements());
            const firstFocusable = focusables[0];
            const lastFocusable = focusables[focusables.length - 1];
            if (e.key === "Tab") {
              if (e.shiftKey) {
                if (document.activeElement === firstFocusable) {
                  e.preventDefault();
                  lastFocusable.focus();
                }
              } else {
                if (document.activeElement === lastFocusable) {
                  e.preventDefault();
                  firstFocusable.focus();
                }
              }
            }
          };
          const closeDialog = () => {
            document.body.removeChild(dialog);
            document.removeEventListener("keydown", handleDialogKeys);
            if (previouslyFocused) {
              previouslyFocused.focus();
            }
          };
          const handleDialogKeys = (e) => {
            if (e.key === "Escape") {
              closeDialog();
            } else {
              handleTabKey(e);
            }
          };
          document.addEventListener("keydown", handleDialogKeys);
          document.getElementById("cancelBtn").addEventListener("click", closeDialog);
          document.getElementById("saveBtn").addEventListener("click", async () => {
            const provider = document.getElementById("providerSelect").value;
            const apiKey = document.getElementById("apiKeyInput").value.trim();
            const systemPrompt = document.getElementById("systemPromptInput").value.trim();
            if (provider !== "none" && apiKey.length > 0) {
              const validation = this.validateApiKey(apiKey, provider);
              if (!validation.valid) {
                const existingError = document.getElementById("apiKeyError");
                if (existingError) {
                  existingError.textContent = validation.error;
                } else {
                  const errorDiv = document.createElement("div");
                  errorDiv.id = "apiKeyError";
                  errorDiv.style.cssText = "color: var(--danger-color); font-size: 13px; margin-top: 8px;";
                  errorDiv.textContent = validation.error;
                  const inputParent = document.getElementById("apiKeyInput").parentElement;
                  inputParent.appendChild(errorDiv);
                }
                document.getElementById("apiKeyInput").focus();
                return;
              }
            }
            this.state.llmProvider = provider;
            this.state.systemPrompt = systemPrompt;
            const storageData = {
              llmProvider: provider,
              systemPrompt
            };
            await chrome.storage.local.set(storageData);
            if (provider !== "none") {
              await this.saveApiKey(apiKey);
            }
            this.updateStatus("Settings saved!");
            closeDialog();
          });
          dialog.addEventListener("click", (e) => {
            if (e.target === dialog) {
              closeDialog();
            }
          });
        };
        render = () => {
          this.updateUI();
          if (this.state.aiAnalysis) {
            this.showAnalysisResults(this.state.aiAnalysis);
          }
        };
        generateMarkdown = () => {
          const bookmarks = this.state.filteredBookmarks || this.state.lastExtraction;
          if (!bookmarks || bookmarks.length === 0)
            return "";
          const exportDate = (/* @__PURE__ */ new Date()).toLocaleDateString("en-US", {
            year: "numeric",
            month: "long",
            day: "numeric"
          });
          const mdParts = [
            `# X Bookmarks Export

`,
            `**Exported:** ${exportDate}
`,
            `**Total Bookmarks:** ${bookmarks.length}

`,
            `---

`
          ];
          bookmarks.forEach((bookmark, index) => {
            mdParts.push(`## Bookmark ${index + 1}

`);
            if (bookmark.text) {
              mdParts.push(`**Text:** ${bookmark.text}

`);
            }
            const ownerName = bookmark.displayName || "Unknown";
            const ownerHandle = bookmark.username ? `@${bookmark.username}` : "@unknown";
            mdParts.push(`**Owner:** ${ownerName} (${ownerHandle})

`);
            const tags = [];
            const customTags = this.getCustomTags(bookmark.url);
            if (customTags && customTags.length > 0) {
              tags.push(...customTags.slice(0, 5));
            }
            if (tags.length < 5 && this.state.aiAnalysis && this.state.aiAnalysis.tags) {
              const remainingSlots = 5 - tags.length;
              const aiTags = this.state.aiAnalysis.tags.slice(0, remainingSlots);
              tags.push(...aiTags);
            }
            if (tags.length > 0) {
              mdParts.push(`**Tags:** ${tags.join(", ")}

`);
            }
            mdParts.push(`**Link:** ${bookmark.url}

`);
            if (bookmark.media && bookmark.media.length > 0) {
              mdParts.push(`**Media:**
`);
              bookmark.media.forEach((m) => {
                mdParts.push(`- [${m.type === "video" ? "Video (MP4)" : "Image (Original)"}](${m.url})
`);
              });
              mdParts.push(`
`);
            }
            mdParts.push(`---

`);
          });
          return mdParts.join("");
        };
        calculateBasicStats = (bookmarks) => {
          let totalLikes = 0;
          let totalRetweets = 0;
          const authorCounts = {};
          let minDate = null;
          let maxDate = null;
          bookmarks.forEach((b) => {
            totalLikes += parseInt(b.likes || 0);
            totalRetweets += parseInt(b.retweets || 0);
            if (b.username) {
              authorCounts[b.username] = (authorCounts[b.username] || 0) + 1;
            }
            if (b.dateTime) {
              const date = new Date(b.dateTime);
              if (!minDate || date < minDate)
                minDate = date;
              if (!maxDate || date > maxDate)
                maxDate = date;
            }
          });
          const avgLikes = bookmarks.length > 0 ? totalLikes / bookmarks.length : 0;
          let topAuthor = { username: null, count: 0 };
          Object.entries(authorCounts).forEach(([username, count]) => {
            if (count > topAuthor.count) {
              topAuthor = { username, count };
            }
          });
          let dateRange = "N/A";
          if (minDate && maxDate) {
            const minStr = minDate.toLocaleDateString();
            const maxStr = maxDate.toLocaleDateString();
            dateRange = minStr === maxStr ? minStr : `${minStr} - ${maxStr}`;
          }
          return {
            totalLikes,
            totalRetweets,
            avgLikes,
            topAuthor,
            dateRange
          };
        };
        generateCSV = () => {
          const bookmarks = this.state.filteredBookmarks || this.state.lastExtraction;
          if (!bookmarks || bookmarks.length === 0)
            return "";
          const escapeCSV = (val) => {
            if (val === void 0 || val === null)
              return "";
            const str = String(val).replace(/\n/g, " ");
            if (/[",]/.test(str)) {
              return '"' + str.replace(/"/g, '""') + '"';
            }
            return str;
          };
          const rows = [];
          const formatMedia = (media) => {
            if (!media || media.length === 0)
              return "";
            return media.map((m) => m.url).join("; ");
          };
          if (this.state.aiAnalysis) {
            rows.push("Author,Username,Date,Text,Likes,Retweets,Replies,Views,Link,Media URLs,Tags,Categories");
            const tags = this.state.aiAnalysis.tags ? this.state.aiAnalysis.tags.join("; ") : "";
            const categories = this.state.aiAnalysis.categories ? this.state.aiAnalysis.categories.join("; ") : "";
            bookmarks.forEach((t) => {
              rows.push([
                escapeCSV(t.displayName || ""),
                escapeCSV("@" + (t.username || "")),
                escapeCSV(t.dateTime || ""),
                escapeCSV(t.text || ""),
                escapeCSV(t.likes || ""),
                escapeCSV(t.retweets || ""),
                escapeCSV(t.replies || ""),
                escapeCSV(t.views || ""),
                escapeCSV(t.url),
                escapeCSV(formatMedia(t.media)),
                escapeCSV(tags),
                escapeCSV(categories)
              ].join(","));
            });
          } else {
            rows.push("Author,Username,Date,Text,Likes,Retweets,Replies,Views,Link,Media URLs");
            bookmarks.forEach((t) => {
              rows.push([
                escapeCSV(t.displayName || ""),
                escapeCSV("@" + (t.username || "")),
                escapeCSV(t.dateTime || ""),
                escapeCSV(t.text || ""),
                escapeCSV(t.likes || ""),
                escapeCSV(t.retweets || ""),
                escapeCSV(t.replies || ""),
                escapeCSV(t.views || ""),
                escapeCSV(t.url),
                escapeCSV(formatMedia(t.media))
              ].join(","));
            });
          }
          return rows.join("\n");
        };
        downloadMarkdown = () => {
          const md = this.generateMarkdown();
          if (!md)
            return;
          const blob = new Blob([md], { type: "text/markdown" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `x-bookmarks-${Date.now()}.md`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          this.updateStatus("Downloaded Markdown file!");
        };
        downloadCSV = () => {
          const csv = this.generateCSV();
          if (!csv)
            return;
          const blob = new Blob([csv], { type: "text/csv" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `x-bookmarks-${Date.now()}.csv`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          this.updateStatus("Downloaded CSV file!");
        };
        copyToClipboard = async () => {
          console.log("[Clipboard] Copy button clicked");
          if (!this.state.lastExtraction || this.state.lastExtraction.length === 0) {
            console.warn("[Clipboard] No bookmarks in state");
            this.updateStatus("\u26A0\uFE0F No bookmarks to copy. Please scan bookmarks first.");
            return;
          }
          console.log(`[Clipboard] State has ${this.state.lastExtraction.length} bookmarks`);
          const md = this.generateMarkdown();
          if (!md || md.trim() === "") {
            console.error("[Clipboard] generateMarkdown returned empty string");
            this.updateStatus("\u26A0\uFE0F No content to copy. Please scan bookmarks first.");
            return;
          }
          const bookmarkCount = this.state.lastExtraction.length;
          console.log(`[Clipboard] Generated markdown: ${md.length} characters`);
          console.log(`[Clipboard] First 200 chars:`, md.substring(0, 200));
          console.log(`[Clipboard] Attempting to copy ${bookmarkCount} bookmarks`);
          try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
              console.log("[Clipboard] Using Clipboard API");
              await navigator.clipboard.writeText(md);
              this.updateStatus(`\u2713 Copied ${bookmarkCount} bookmark${bookmarkCount !== 1 ? "s" : ""} to clipboard! (${Math.round(md.length / 1024)}KB)`);
              console.log("[Clipboard] \u2713 Successfully copied using Clipboard API");
              try {
                const clipboardContent = await navigator.clipboard.readText();
                console.log(`[Clipboard] Verified clipboard has ${clipboardContent.length} characters`);
              } catch (readErr) {
                console.warn("[Clipboard] Could not verify clipboard (permission denied):", readErr.message);
              }
            } else {
              console.log("[Clipboard] Clipboard API not available, using fallback");
              this.fallbackCopyToClipboard(md);
            }
          } catch (err) {
            console.error("[Clipboard] Error copying to clipboard:", err);
            console.error("[Clipboard] Error name:", err.name);
            console.error("[Clipboard] Error message:", err.message);
            this.fallbackCopyToClipboard(md);
          }
        };
        fallbackCopyToClipboard = (text) => {
          console.log("[Clipboard] Attempting fallback copy method");
          const textarea = document.createElement("textarea");
          textarea.value = text;
          textarea.style.position = "fixed";
          textarea.style.opacity = "0";
          textarea.style.left = "-9999px";
          document.body.appendChild(textarea);
          textarea.focus();
          textarea.select();
          try {
            const successful = document.execCommand("copy");
            if (successful) {
              const count = this.state.lastExtraction ? this.state.lastExtraction.length : 0;
              this.updateStatus(`\u2713 Copied ${count} bookmark${count !== 1 ? "s" : ""} to clipboard!`);
              console.log("[Clipboard] Successfully copied using fallback method");
            } else {
              console.error("[Clipboard] execCommand copy returned false");
              this.updateStatus("\u26A0\uFE0F Failed to copy. Please try using a download option instead.");
            }
          } catch (err) {
            console.error("[Clipboard] Fallback copy failed:", err);
            this.updateStatus("\u26A0\uFE0F Clipboard copy failed. Please try using a download option instead.");
          } finally {
            document.body.removeChild(textarea);
          }
        };
        openBookmarksPage = () => {
          const url = "https://x.com/i/bookmarks";
          chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs && tabs[0]) {
              chrome.tabs.update(tabs[0].id, { url });
            } else {
              chrome.tabs.create({ url });
            }
          });
        };
        // Utility: Debounce function
        debounce = (func, wait) => {
          let timeout;
          return function executedFunction(...args) {
            const later = () => {
              clearTimeout(timeout);
              func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
          };
        };
        // Search functionality
        performSearch = () => {
          if (!this.state.lastExtraction || this.state.lastExtraction.length === 0) {
            return;
          }
          const query = this.state.searchQuery.toLowerCase().trim();
          if (!query) {
            this.state.filteredBookmarks = null;
            this.updateStatus(`Showing all ${this.state.lastExtraction.length} bookmarks`);
            return;
          }
          this.state.filteredBookmarks = this.state.lastExtraction.filter((bookmark) => {
            var _a, _b, _c;
            return ((_a = bookmark.text) == null ? void 0 : _a.toLowerCase().includes(query)) || ((_b = bookmark.displayName) == null ? void 0 : _b.toLowerCase().includes(query)) || ((_c = bookmark.username) == null ? void 0 : _c.toLowerCase().includes(query));
          });
          this.updateStatus(`Found ${this.state.filteredBookmarks.length} bookmarks matching "${this.state.searchQuery}"`);
        };
        // Filter dialog
        showFilterDialog = () => {
          const dialog = document.createElement("div");
          dialog.setAttribute("role", "dialog");
          dialog.setAttribute("aria-modal", "true");
          dialog.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.7); display: flex;
      align-items: center; justify-content: center; z-index: 1000;
    `;
          const dialogContent = document.createElement("div");
          dialogContent.style.cssText = `
      background: var(--bg-color); padding: 24px; border-radius: 8px;
      max-width: 450px; width: 90%; max-height: 80vh; overflow-y: auto;
    `;
          dialogContent.innerHTML = `
      <h2 style="margin-top: 0; color: var(--text-color);">Filter Bookmarks</h2>
      <div style="margin-bottom: 16px;">
        <label style="display: block; margin-bottom: 8px; color: var(--text-color);">
          Min Likes:
          <input type="number" id="minLikes" value="${this.state.filterOptions.minLikes}" min="0"
                 style="width: 100%; padding: 8px; margin-top: 4px; border: 1px solid var(--border-color); border-radius: 4px; background: var(--bg-color); color: var(--text-color);">
        </label>
      </div>
      <div style="margin-bottom: 16px;">
        <label style="display: block; margin-bottom: 8px; color: var(--text-color);">
          Min Retweets:
          <input type="number" id="minRetweets" value="${this.state.filterOptions.minRetweets}" min="0"
                 style="width: 100%; padding: 8px; margin-top: 4px; border: 1px solid var(--border-color); border-radius: 4px; background: var(--bg-color); color: var(--text-color);">
        </label>
      </div>
      <div style="margin-bottom: 16px;">
        <label style="display: block; margin-bottom: 8px; color: var(--text-color);">
          Author Username:
          <input type="text" id="authorFilter" value="${this.state.filterOptions.author}" placeholder="@username"
                 style="width: 100%; padding: 8px; margin-top: 4px; border: 1px solid var(--border-color); border-radius: 4px; background: var(--bg-color); color: var(--text-color);">
        </label>
      </div>
      <div style="margin-bottom: 16px;">
        <label style="display: block; margin-bottom: 8px; color: var(--text-color);">
          Date From:
          <input type="date" id="dateFrom" value="${this.state.filterOptions.dateFrom}"
                 style="width: 100%; padding: 8px; margin-top: 4px; border: 1px solid var(--border-color); border-radius: 4px; background: var(--bg-color); color: var(--text-color);">
        </label>
      </div>
      <div style="margin-bottom: 16px;">
        <label style="display: block; margin-bottom: 8px; color: var(--text-color);">
          Date To:
          <input type="date" id="dateTo" value="${this.state.filterOptions.dateTo}"
                 style="width: 100%; padding: 8px; margin-top: 4px; border: 1px solid var(--border-color); border-radius: 4px; background: var(--bg-color); color: var(--text-color);">
        </label>
      </div>
      <div style="margin-bottom: 16px;">
        <label style="display: block; margin-bottom: 8px; color: var(--text-color);">
          Read Status:
          <select id="readStatus" style="width: 100%; padding: 8px; margin-top: 4px; border: 1px solid var(--border-color); border-radius: 4px; background: var(--bg-color); color: var(--text-color);">
            <option value="all" ${this.state.filterOptions.readStatus === "all" ? "selected" : ""}>All</option>
            <option value="read" ${this.state.filterOptions.readStatus === "read" ? "selected" : ""}>Read Only</option>
            <option value="unread" ${this.state.filterOptions.readStatus === "unread" ? "selected" : ""}>Unread Only</option>
          </select>
        </label>
      </div>
      <div style="margin-bottom: 16px;">
        <label style="display: flex; align-items: center; color: var(--text-color); cursor: pointer;">
          <input type="checkbox" id="hasNotes" ${this.state.filterOptions.hasNotes ? "checked" : ""}
                 style="margin-right: 8px;">
          Only show bookmarks with notes
        </label>
      </div>
      <div style="display: flex; gap: 8px; justify-content: flex-end;">
        <button id="resetBtn" style="padding: 8px 16px; border: 1px solid var(--border-color); background: transparent; color: var(--text-color); border-radius: 4px; cursor: pointer;">Reset</button>
        <button id="cancelBtn" style="padding: 8px 16px; border: 1px solid var(--border-color); background: transparent; color: var(--text-color); border-radius: 4px; cursor: pointer;">Cancel</button>
        <button id="applyBtn" style="padding: 8px 16px; border: none; background: var(--primary-color); color: white; border-radius: 4px; cursor: pointer;">Apply</button>
      </div>
    `;
          dialog.appendChild(dialogContent);
          document.body.appendChild(dialog);
          const closeDialog = () => document.body.removeChild(dialog);
          document.getElementById("cancelBtn").addEventListener("click", closeDialog);
          document.getElementById("resetBtn").addEventListener("click", () => {
            var _a;
            this.state.filterOptions = { minLikes: 0, minRetweets: 0, author: "", dateFrom: "", dateTo: "", readStatus: "all", hasNotes: false, collections: [] };
            this.state.filteredBookmarks = null;
            this.updateStatus(`Showing all ${((_a = this.state.lastExtraction) == null ? void 0 : _a.length) || 0} bookmarks`);
            closeDialog();
          });
          document.getElementById("applyBtn").addEventListener("click", () => {
            this.state.filterOptions.minLikes = parseInt(document.getElementById("minLikes").value) || 0;
            this.state.filterOptions.minRetweets = parseInt(document.getElementById("minRetweets").value) || 0;
            this.state.filterOptions.author = document.getElementById("authorFilter").value.replace("@", "").trim();
            this.state.filterOptions.dateFrom = document.getElementById("dateFrom").value;
            this.state.filterOptions.dateTo = document.getElementById("dateTo").value;
            this.state.filterOptions.readStatus = document.getElementById("readStatus").value;
            this.state.filterOptions.hasNotes = document.getElementById("hasNotes").checked;
            this.applyFilters();
            closeDialog();
          });
          dialog.addEventListener("click", (e) => {
            if (e.target === dialog)
              closeDialog();
          });
        };
        applyFilters = () => {
          if (!this.state.lastExtraction)
            return;
          this.state.filteredBookmarks = this.state.lastExtraction.filter((bookmark) => {
            var _a;
            const likes = parseInt(bookmark.likes) || 0;
            const retweets = parseInt(bookmark.retweets) || 0;
            const username = ((_a = bookmark.username) == null ? void 0 : _a.toLowerCase()) || "";
            const targetAuthor = this.state.filterOptions.author.toLowerCase();
            if (likes < this.state.filterOptions.minLikes)
              return false;
            if (retweets < this.state.filterOptions.minRetweets)
              return false;
            if (targetAuthor && !username.includes(targetAuthor))
              return false;
            if (this.state.filterOptions.dateFrom || this.state.filterOptions.dateTo) {
              const bookmarkDate = new Date(bookmark.dateTime);
              if (this.state.filterOptions.dateFrom) {
                const fromDate = new Date(this.state.filterOptions.dateFrom);
                if (bookmarkDate < fromDate)
                  return false;
              }
              if (this.state.filterOptions.dateTo) {
                const toDate = new Date(this.state.filterOptions.dateTo);
                toDate.setHours(23, 59, 59, 999);
                if (bookmarkDate > toDate)
                  return false;
              }
            }
            if (this.state.filterOptions.readStatus !== "all") {
              const isRead = this.getReadStatus(bookmark.url);
              if (this.state.filterOptions.readStatus === "read" && !isRead)
                return false;
              if (this.state.filterOptions.readStatus === "unread" && isRead)
                return false;
            }
            if (this.state.filterOptions.hasNotes) {
              const notes = this.getBookmarkNote(bookmark.url);
              if (!notes || notes.trim() === "")
                return false;
            }
            return true;
          });
          this.updateStatus(`Filtered to ${this.state.filteredBookmarks.length} bookmarks`);
        };
        // Performance metrics dialog
        showMetricsDialog = () => {
          var _a;
          const dialog = document.createElement("div");
          dialog.setAttribute("role", "dialog");
          dialog.setAttribute("aria-modal", "true");
          dialog.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.7); display: flex;
      align-items: center; justify-content: center; z-index: 1000;
    `;
          const dialogContent = document.createElement("div");
          dialogContent.style.cssText = `
      background: var(--bg-color); padding: 24px; border-radius: 8px;
      max-width: 400px; width: 90%;
    `;
          const metrics = this.state.performanceMetrics;
          const extractionTime = metrics.lastExtractionTime ? `${metrics.lastExtractionTime}ms` : "N/A";
          const analysisTime = metrics.lastAnalysisTime ? `${metrics.lastAnalysisTime}ms` : "N/A";
          const bookmarksCount = metrics.bookmarksExtracted || ((_a = this.state.lastExtraction) == null ? void 0 : _a.length) || 0;
          const providerDisplay = this.state.llmProvider === "none" ? "LLM-Free Mode" : (this.state.llmProvider || "None").toUpperCase();
          dialogContent.innerHTML = `
      <h2 style="margin-top: 0; color: var(--text-color);">Performance Metrics</h2>
      <div style="color: var(--text-color); margin-bottom: 16px;">
        <p><strong>Last Extraction Time:</strong> ${extractionTime}</p>
        <p><strong>Last Analysis Time:</strong> ${analysisTime}</p>
        <p><strong>Bookmarks Extracted:</strong> ${bookmarksCount}</p>
        <p><strong>Current Provider:</strong> ${providerDisplay}</p>
      </div>
      <div style="display: flex; gap: 8px; justify-content: flex-end;">
        <button id="closeMetricsBtn" style="padding: 8px 16px; border: none; background: var(--primary-color); color: white; border-radius: 4px; cursor: pointer;">Close</button>
      </div>
    `;
          dialog.appendChild(dialogContent);
          document.body.appendChild(dialog);
          const closeDialog = () => document.body.removeChild(dialog);
          document.getElementById("closeMetricsBtn").addEventListener("click", closeDialog);
          dialog.addEventListener("click", (e) => {
            if (e.target === dialog)
              closeDialog();
          });
        };
        // JSON export functionality
        downloadJSON = () => {
          const bookmarks = this.state.filteredBookmarks || this.state.lastExtraction;
          if (!bookmarks || bookmarks.length === 0)
            return;
          const exportData = {
            metadata: {
              exportDate: (/* @__PURE__ */ new Date()).toISOString(),
              totalBookmarks: bookmarks.length,
              version: "0.8.0",
              llmProvider: this.state.llmProvider
            },
            analysis: this.state.aiAnalysis || null,
            statistics: this.calculateBasicStats(bookmarks),
            bookmarks
          };
          const json = JSON.stringify(exportData, null, 2);
          const blob = new Blob([json], { type: "application/json" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `x-bookmarks-${Date.now()}.json`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          this.updateStatus("Downloaded JSON file!");
        };
        // Retry operation with exponential backoff
        retryOperation = async (operation, attempts = this.constants.API_RETRY_ATTEMPTS) => {
          let lastError;
          for (let i = 0; i < attempts; i++) {
            try {
              return await operation();
            } catch (error) {
              lastError = error;
              if (i < attempts - 1) {
                const delay = this.constants.API_RETRY_DELAY * Math.pow(2, i);
                await new Promise((resolve) => setTimeout(resolve, delay));
              }
            }
          }
          throw lastError;
        };
        // ====== NEW FEATURES v0.9.0 ======
        // FEATURE: Duplicate Detection
        detectDuplicates = () => {
          if (!this.state.lastExtraction || this.state.lastExtraction.length === 0) {
            this.updateStatus("No bookmarks to check for duplicates.");
            return;
          }
          const urlMap = /* @__PURE__ */ new Map();
          const duplicates = [];
          this.state.lastExtraction.forEach((bookmark, index) => {
            if (urlMap.has(bookmark.url)) {
              duplicates.push({ original: urlMap.get(bookmark.url), duplicate: index, url: bookmark.url });
            } else {
              urlMap.set(bookmark.url, index);
            }
          });
          if (duplicates.length === 0) {
            this.updateStatus("No duplicates found! All bookmarks are unique.");
            return;
          }
          const dialog = document.createElement("div");
          dialog.setAttribute("role", "dialog");
          dialog.setAttribute("aria-modal", "true");
          dialog.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.7); display: flex;
      align-items: center; justify-content: center; z-index: 1000;
    `;
          const dialogContent = document.createElement("div");
          dialogContent.style.cssText = `
      background: var(--bg-color); padding: 24px; border-radius: 8px;
      max-width: 500px; width: 90%; max-height: 80vh; overflow-y: auto;
    `;
          const title = document.createElement("h2");
          title.style.cssText = "margin-top: 0; color: var(--text-color);";
          title.textContent = `Found ${duplicates.length} Duplicate(s)`;
          dialogContent.appendChild(title);
          const info = document.createElement("p");
          info.style.cssText = "color: var(--text-color); margin-bottom: 16px;";
          info.textContent = "The following bookmarks appear multiple times:";
          dialogContent.appendChild(info);
          const list = document.createElement("ul");
          list.style.cssText = "color: var(--text-color); max-height: 300px; overflow-y: auto;";
          duplicates.forEach((dup) => {
            const li = document.createElement("li");
            li.style.cssText = "margin-bottom: 8px; word-break: break-all;";
            li.textContent = `${dup.url.substring(0, 60)}...`;
            list.appendChild(li);
          });
          dialogContent.appendChild(list);
          const buttonContainer = document.createElement("div");
          buttonContainer.style.cssText = "display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px;";
          const removeDupsBtn = document.createElement("button");
          removeDupsBtn.textContent = "Remove Duplicates";
          removeDupsBtn.style.cssText = "padding: 8px 16px; border: none; background: var(--danger-color); color: white; border-radius: 4px; cursor: pointer;";
          removeDupsBtn.addEventListener("click", () => {
            this.removeDuplicates(duplicates);
            document.body.removeChild(dialog);
          });
          const closeBtn = document.createElement("button");
          closeBtn.textContent = "Close";
          closeBtn.style.cssText = "padding: 8px 16px; border: 1px solid var(--border-color); background: transparent; color: var(--text-color); border-radius: 4px; cursor: pointer;";
          closeBtn.addEventListener("click", () => document.body.removeChild(dialog));
          buttonContainer.appendChild(removeDupsBtn);
          buttonContainer.appendChild(closeBtn);
          dialogContent.appendChild(buttonContainer);
          dialog.appendChild(dialogContent);
          document.body.appendChild(dialog);
          this.updateStatus(`Found ${duplicates.length} duplicate bookmark(s).`);
        };
        removeDuplicates = async (duplicates) => {
          const indicesToRemove = new Set(duplicates.map((d) => d.duplicate));
          const uniqueBookmarks = this.state.lastExtraction.filter((_, index) => !indicesToRemove.has(index));
          this.state.lastExtraction = uniqueBookmarks;
          await chrome.storage.local.set({
            lastExtraction: {
              timestamp: Date.now(),
              bookmarks: uniqueBookmarks
            }
          });
          this.updateStatus(`Removed ${duplicates.length} duplicate(s). ${uniqueBookmarks.length} unique bookmarks remaining.`);
          this.updateUI();
        };
        // FEATURE: Sort bookmarks by engagement metrics
        sortBookmarks = (criteria) => {
          if (!this.state.lastExtraction || this.state.lastExtraction.length === 0) {
            this.updateStatus("No bookmarks to sort.");
            return;
          }
          const bookmarksToSort = this.state.filteredBookmarks || this.state.lastExtraction;
          let sorted = [...bookmarksToSort];
          switch (criteria) {
            case "likes":
              sorted.sort((a, b) => (parseInt(b.likes) || 0) - (parseInt(a.likes) || 0));
              break;
            case "retweets":
              sorted.sort((a, b) => (parseInt(b.retweets) || 0) - (parseInt(a.retweets) || 0));
              break;
            case "replies":
              sorted.sort((a, b) => (parseInt(b.replies) || 0) - (parseInt(a.replies) || 0));
              break;
            case "views":
              sorted.sort((a, b) => (parseInt(b.views) || 0) - (parseInt(a.views) || 0));
              break;
            case "date":
              sorted.sort((a, b) => new Date(b.dateTime) - new Date(a.dateTime));
              break;
            case "engagement":
              sorted.sort((a, b) => {
                const scoreA = (parseInt(a.likes) || 0) * 2 + (parseInt(a.retweets) || 0) * 3 + (parseInt(a.replies) || 0) * 1;
                const scoreB = (parseInt(b.likes) || 0) * 2 + (parseInt(b.retweets) || 0) * 3 + (parseInt(b.replies) || 0) * 1;
                return scoreB - scoreA;
              });
              break;
            default:
              break;
          }
          this.state.filteredBookmarks = sorted;
          this.updateStatus(`Sorted by ${criteria}.`);
        };
        // FEATURE: Show sort dialog
        showSortDialog = () => {
          const dialog = document.createElement("div");
          dialog.setAttribute("role", "dialog");
          dialog.setAttribute("aria-modal", "true");
          dialog.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.7); display: flex;
      align-items: center; justify-content: center; z-index: 1000;
    `;
          const dialogContent = document.createElement("div");
          dialogContent.style.cssText = `
      background: var(--bg-color); padding: 24px; border-radius: 8px;
      max-width: 350px; width: 90%;
    `;
          const title = document.createElement("h2");
          title.style.cssText = "margin-top: 0; color: var(--text-color);";
          title.textContent = "Sort Bookmarks";
          dialogContent.appendChild(title);
          const sortOptions = [
            { value: "engagement", label: "Total Engagement (Likes + Retweets + Replies)" },
            { value: "likes", label: "Most Likes" },
            { value: "retweets", label: "Most Retweets" },
            { value: "replies", label: "Most Replies" },
            { value: "views", label: "Most Views" },
            { value: "date", label: "Most Recent" }
          ];
          sortOptions.forEach((option) => {
            const btn = document.createElement("button");
            btn.textContent = option.label;
            btn.style.cssText = `
        width: 100%; padding: 12px; margin-bottom: 8px; border: 1px solid var(--border-color);
        background: var(--bg-color); color: var(--text-color); border-radius: 4px;
        cursor: pointer; text-align: left; transition: background 0.2s;
      `;
            btn.addEventListener("mouseover", () => {
              btn.style.background = "var(--hover-color)";
            });
            btn.addEventListener("mouseout", () => {
              btn.style.background = "var(--bg-color)";
            });
            btn.addEventListener("click", () => {
              this.sortBookmarks(option.value);
              document.body.removeChild(dialog);
            });
            dialogContent.appendChild(btn);
          });
          const cancelBtn = document.createElement("button");
          cancelBtn.textContent = "Cancel";
          cancelBtn.style.cssText = "width: 100%; padding: 12px; margin-top: 8px; border: 1px solid var(--border-color); background: transparent; color: var(--text-color); border-radius: 4px; cursor: pointer;";
          cancelBtn.addEventListener("click", () => document.body.removeChild(dialog));
          dialogContent.appendChild(cancelBtn);
          dialog.appendChild(dialogContent);
          document.body.appendChild(dialog);
          dialog.addEventListener("click", (e) => {
            if (e.target === dialog)
              document.body.removeChild(dialog);
          });
        };
        // FEATURE: HTML Export with styling
        generateHTML = () => {
          const bookmarks = this.state.filteredBookmarks || this.state.lastExtraction;
          if (!bookmarks || bookmarks.length === 0)
            return "";
          const stats = this.calculateBasicStats(bookmarks);
          const analysis = this.state.aiAnalysis;
          let html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>X Bookmarks Export - ${(/* @__PURE__ */ new Date()).toLocaleDateString()}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
           line-height: 1.6; color: #333; background: #f5f5f5; padding: 20px; }
    .container { max-width: 900px; margin: 0 auto; background: white; padding: 40px;
                 border-radius: 12px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
    h1 { color: #1d9bf0; margin-bottom: 10px; font-size: 32px; }
    h2 { color: #14171a; margin: 30px 0 15px; font-size: 24px; border-bottom: 2px solid #1d9bf0; padding-bottom: 8px; }
    h3 { color: #14171a; margin: 20px 0 10px; font-size: 18px; }
    .header { text-align: center; margin-bottom: 40px; }
    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
             gap: 15px; margin: 20px 0; }
    .stat-card { background: #f7f9fa; padding: 20px; border-radius: 8px; border-left: 4px solid #1d9bf0; }
    .stat-label { font-size: 12px; color: #657786; text-transform: uppercase; letter-spacing: 0.5px; }
    .stat-value { font-size: 24px; font-weight: bold; color: #14171a; margin-top: 5px; }
    .bookmark { background: #fff; border: 1px solid #e1e8ed; border-radius: 8px;
                padding: 20px; margin-bottom: 15px; transition: box-shadow 0.2s; }
    .bookmark:hover { box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    .bookmark-header { display: flex; justify-content: space-between; align-items: start; margin-bottom: 12px; }
    .author { font-weight: bold; color: #14171a; font-size: 16px; }
    .username { color: #657786; font-size: 14px; margin-left: 5px; }
    .date { color: #657786; font-size: 13px; }
    .text { color: #14171a; margin: 12px 0; font-size: 15px; line-height: 1.5; }
    .metrics { display: flex; gap: 20px; margin-top: 12px; flex-wrap: wrap; }
    .metric { display: flex; align-items: center; gap: 5px; color: #657786; font-size: 13px; }
    .metric-value { font-weight: 600; color: #14171a; }
    .link { color: #1d9bf0; text-decoration: none; word-break: break-all; font-size: 13px; }
    .link:hover { text-decoration: underline; }
    .tags { display: flex; flex-wrap: wrap; gap: 8px; margin: 15px 0; }
    .tag { background: #1d9bf0; color: white; padding: 5px 15px; border-radius: 20px;
           font-size: 12px; font-weight: 500; }
    .categories { list-style: none; }
    .categories li { padding: 8px 0; color: #14171a; border-bottom: 1px solid #e1e8ed; }
    .categories li:last-child { border-bottom: none; }
    .summary { background: #e8f5fd; padding: 20px; border-radius: 8px; margin: 20px 0;
               border-left: 4px solid #1d9bf0; color: #14171a; line-height: 1.6; }
    .footer { text-align: center; margin-top: 40px; padding-top: 20px;
              border-top: 1px solid #e1e8ed; color: #657786; font-size: 13px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>\u{1F4DA} X Bookmarks Export</h1>
      <p style="color: #657786; margin-top: 10px;">Generated on ${(/* @__PURE__ */ new Date()).toLocaleString()}</p>
      <p style="color: #657786;">Total Bookmarks: ${bookmarks.length}</p>
    </div>
`;
          if (analysis) {
            html += `
    <h2>\u{1F4CA} AI Analysis</h2>
    <div class="summary">${this.escapeHtml(analysis.overallSummary || "No summary available.")}</div>
`;
            if (analysis.tags && analysis.tags.length > 0) {
              html += `
    <h3>\u{1F3F7}\uFE0F Tags</h3>
    <div class="tags">
      ${analysis.tags.map((tag) => `<span class="tag">${this.escapeHtml(tag)}</span>`).join("")}
    </div>
`;
            }
            if (analysis.categories && analysis.categories.length > 0) {
              html += `
    <h3>\u{1F4C1} Categories</h3>
    <ul class="categories">
      ${analysis.categories.map((cat) => `<li>${this.escapeHtml(cat)}</li>`).join("")}
    </ul>
`;
            }
          }
          html += `
    <h2>\u{1F4C8} Statistics</h2>
    <div class="stats">
      <div class="stat-card">
        <div class="stat-label">Total Likes</div>
        <div class="stat-value">${stats.totalLikes.toLocaleString()}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Total Retweets</div>
        <div class="stat-value">${stats.totalRetweets.toLocaleString()}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Avg Likes/Bookmark</div>
        <div class="stat-value">${Math.round(stats.avgLikes)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Top Author</div>
        <div class="stat-value" style="font-size: 18px;">@${stats.topAuthor.username || "N/A"}</div>
      </div>
    </div>
`;
          html += `
    <h2>\u{1F516} Bookmarks</h2>
`;
          bookmarks.forEach((b, index) => {
            html += `
    <div class="bookmark">
      <div class="bookmark-header">
        <div>
          <span class="author">${this.escapeHtml(b.displayName || "Unknown")}</span>
          <span class="username">@${this.escapeHtml(b.username || "unknown")}</span>
        </div>
        <div class="date">${b.dateTime ? new Date(b.dateTime).toLocaleDateString() : "N/A"}</div>
      </div>
      <div class="text">${this.escapeHtml(b.text || "(No text)")}</div>
      <div class="metrics">
        ${b.likes ? `<div class="metric">\u2764\uFE0F <span class="metric-value">${b.likes}</span></div>` : ""}
        ${b.retweets ? `<div class="metric">\u{1F504} <span class="metric-value">${b.retweets}</span></div>` : ""}
        ${b.replies ? `<div class="metric">\u{1F4AC} <span class="metric-value">${b.replies}</span></div>` : ""}
        ${b.views ? `<div class="metric">\u{1F441}\uFE0F <span class="metric-value">${b.views}</span></div>` : ""}
      </div>
      <a href="${b.url}" target="_blank" class="link">View on X \u2192</a>
    </div>
`;
          });
          html += `
    <div class="footer">
      <p>Exported with X Bookmarks Analyzer v0.11.0</p>
      <p>Total bookmarks in this export: ${bookmarks.length}</p>
    </div>
  </div>
</body>
</html>`;
          return html;
        };
        escapeHtml = (text) => {
          const div = document.createElement("div");
          div.textContent = text;
          return div.innerHTML;
        };
        downloadHTML = () => {
          const html = this.generateHTML();
          if (!html) {
            this.updateStatus("No bookmarks to export.");
            return;
          }
          const blob = new Blob([html], { type: "text/html" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `x-bookmarks-${Date.now()}.html`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          this.updateStatus("Downloaded HTML file!");
        };
        // FEATURE: Notion Export
        generateNotionMarkdown = () => {
          const bookmarks = this.state.filteredBookmarks || this.state.lastExtraction;
          if (!bookmarks || bookmarks.length === 0)
            return "";
          const lines = [];
          lines.push("# X Bookmarks Export\n");
          lines.push(`> Exported on ${(/* @__PURE__ */ new Date()).toLocaleDateString()}
`);
          lines.push(`> Total: ${bookmarks.length} bookmarks

`);
          lines.push("## Bookmarks Database\n\n");
          bookmarks.forEach((bookmark, index) => {
            lines.push(`### ${bookmark.displayName || "Unknown"} (@${bookmark.username || "unknown"})

`);
            if (bookmark.text) {
              lines.push(`${bookmark.text}

`);
            }
            lines.push("**Properties:**\n");
            lines.push(`- **Author:** ${bookmark.displayName || "Unknown"}
`);
            lines.push(`- **Username:** @${bookmark.username || "unknown"}
`);
            lines.push(`- **Date:** ${bookmark.dateTime ? new Date(bookmark.dateTime).toLocaleDateString() : "N/A"}
`);
            lines.push(`- **Likes:** ${bookmark.likes || 0}
`);
            lines.push(`- **Retweets:** ${bookmark.retweets || 0}
`);
            lines.push(`- **Replies:** ${bookmark.replies || 0}
`);
            if (bookmark.views)
              lines.push(`- **Views:** ${bookmark.views}
`);
            lines.push(`- **URL:** ${bookmark.url}
`);
            const customTags = this.getCustomTags(bookmark.url);
            if (customTags.length > 0) {
              lines.push(`- **Tags:** ${customTags.join(", ")}
`);
            }
            const note = this.getBookmarkNote(bookmark.url);
            if (note) {
              lines.push(`
**Notes:**
> ${note}
`);
            }
            lines.push("\n---\n\n");
          });
          return lines.join("");
        };
        downloadNotion = () => {
          const md = this.generateNotionMarkdown();
          if (!md) {
            this.updateStatus("No bookmarks to export.");
            return;
          }
          const blob = new Blob([md], { type: "text/markdown" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `x-bookmarks-notion-${Date.now()}.md`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          this.updateStatus("Downloaded Notion-compatible Markdown!");
        };
        // FEATURE: Obsidian Export
        generateObsidianMarkdown = () => {
          const bookmarks = this.state.filteredBookmarks || this.state.lastExtraction;
          if (!bookmarks || bookmarks.length === 0)
            return "";
          const lines = [];
          lines.push("# X Bookmarks Export\n\n");
          lines.push("---\n");
          lines.push(`export_date: ${(/* @__PURE__ */ new Date()).toISOString()}
`);
          lines.push(`total_bookmarks: ${bookmarks.length}
`);
          lines.push("tags:\n");
          lines.push("  - twitter\n");
          lines.push("  - bookmarks\n");
          if (this.state.aiAnalysis && this.state.aiAnalysis.tags) {
            this.state.aiAnalysis.tags.slice(0, 5).forEach((tag) => {
              lines.push(`  - ${tag}
`);
            });
          }
          lines.push("---\n\n");
          lines.push("## Summary\n\n");
          lines.push(`This vault contains [[${bookmarks.length} bookmarks]] from X (Twitter).

`);
          bookmarks.forEach((bookmark, index) => {
            const safeFilename = `${bookmark.username}-${Date.now()}-${index}`.replace(/[^a-zA-Z0-9-]/g, "_");
            lines.push(`## [[${safeFilename}|${bookmark.displayName || "Unknown"}]]

`);
            if (bookmark.text) {
              lines.push(`${bookmark.text}

`);
            }
            const customTags = this.getCustomTags(bookmark.url);
            if (customTags.length > 0) {
              lines.push("**Tags:** ");
              lines.push(customTags.map((tag) => `#${tag.replace(/\s+/g, "_")}`).join(" "));
              lines.push("\n\n");
            }
            lines.push("**Metadata:**\n");
            lines.push(`- Author: [[${bookmark.username || "unknown"}]]
`);
            lines.push(`- Date: ${bookmark.dateTime ? new Date(bookmark.dateTime).toLocaleDateString() : "N/A"}
`);
            lines.push(`- Engagement: ${bookmark.likes || 0}\u2764\uFE0F ${bookmark.retweets || 0}\u{1F504} ${bookmark.replies || 0}\u{1F4AC}
`);
            lines.push(`- [View on X](${bookmark.url})

`);
            const note = this.getBookmarkNote(bookmark.url);
            if (note) {
              lines.push("**My Notes:**\n");
              lines.push(`> ${note}

`);
            }
            lines.push("---\n\n");
          });
          return lines.join("");
        };
        downloadObsidian = () => {
          const md = this.generateObsidianMarkdown();
          if (!md) {
            this.updateStatus("No bookmarks to export.");
            return;
          }
          const blob = new Blob([md], { type: "text/markdown" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `x-bookmarks-obsidian-${Date.now()}.md`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          this.updateStatus("Downloaded Obsidian-compatible Markdown!");
        };
        // FEATURE: Auto-save bookmarks
        enableAutoSave = (intervalMinutes = 5) => {
          if (this.autoSaveTimer) {
            clearInterval(this.autoSaveTimer);
          }
          this.autoSaveTimer = setInterval(async () => {
            if (this.state.lastExtraction && this.state.lastExtraction.length > 0) {
              await chrome.storage.local.set({
                lastExtraction: {
                  timestamp: Date.now(),
                  bookmarks: this.state.lastExtraction
                },
                autoSaveTime: (/* @__PURE__ */ new Date()).toISOString()
              });
              console.log("[Auto-save] Bookmarks saved automatically");
            }
          }, intervalMinutes * 60 * 1e3);
          console.log(`[Auto-save] Enabled with ${intervalMinutes} minute interval`);
        };
        // ====== NEW FEATURES v0.10.0 ======
        // FEATURE: Read/Unread Status
        toggleReadStatus = async (bookmarkUrl) => {
          if (!this.state.bookmarkMetadata[bookmarkUrl]) {
            this.state.bookmarkMetadata[bookmarkUrl] = { read: false, notes: "", customTags: [], favorite: false };
          }
          this.state.bookmarkMetadata[bookmarkUrl].read = !this.state.bookmarkMetadata[bookmarkUrl].read;
          await this.saveSettings();
          return this.state.bookmarkMetadata[bookmarkUrl].read;
        };
        markAsRead = async (bookmarkUrl) => {
          if (!this.state.bookmarkMetadata[bookmarkUrl]) {
            this.state.bookmarkMetadata[bookmarkUrl] = { read: true, notes: "", customTags: [], favorite: false };
          } else {
            this.state.bookmarkMetadata[bookmarkUrl].read = true;
          }
          await this.saveSettings();
        };
        markAsUnread = async (bookmarkUrl) => {
          if (!this.state.bookmarkMetadata[bookmarkUrl]) {
            this.state.bookmarkMetadata[bookmarkUrl] = { read: false, notes: "", customTags: [], favorite: false };
          } else {
            this.state.bookmarkMetadata[bookmarkUrl].read = false;
          }
          await this.saveSettings();
        };
        getReadStatus = (bookmarkUrl) => {
          var _a;
          return ((_a = this.state.bookmarkMetadata[bookmarkUrl]) == null ? void 0 : _a.read) || false;
        };
        // FEATURE: Personal Notes
        setBookmarkNote = async (bookmarkUrl, note) => {
          if (!this.state.bookmarkMetadata[bookmarkUrl]) {
            this.state.bookmarkMetadata[bookmarkUrl] = { read: false, notes: "", customTags: [], favorite: false };
          }
          this.state.bookmarkMetadata[bookmarkUrl].notes = note;
          await this.saveSettings();
        };
        getBookmarkNote = (bookmarkUrl) => {
          var _a;
          return ((_a = this.state.bookmarkMetadata[bookmarkUrl]) == null ? void 0 : _a.notes) || "";
        };
        showNotesDialog = (bookmark) => {
          var _a;
          const dialog = document.createElement("div");
          dialog.setAttribute("role", "dialog");
          dialog.setAttribute("aria-modal", "true");
          dialog.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.7); display: flex;
      align-items: center; justify-content: center; z-index: 1000;
    `;
          const dialogContent = document.createElement("div");
          dialogContent.style.cssText = `
      background: var(--bg-color); padding: 24px; border-radius: 8px;
      max-width: 500px; width: 90%; max-height: 80vh; overflow-y: auto;
    `;
          const title = document.createElement("h2");
          title.style.cssText = "margin-top: 0; color: var(--text-color);";
          title.textContent = "Add Note";
          dialogContent.appendChild(title);
          const bookmarkInfo = document.createElement("p");
          bookmarkInfo.style.cssText = "color: var(--disabled-color); font-size: 13px; margin-bottom: 16px;";
          bookmarkInfo.textContent = `@${bookmark.username}: ${(_a = bookmark.text) == null ? void 0 : _a.substring(0, 60)}...`;
          dialogContent.appendChild(bookmarkInfo);
          const textarea = document.createElement("textarea");
          textarea.value = this.getBookmarkNote(bookmark.url);
          textarea.placeholder = "Add your personal notes here...";
          textarea.style.cssText = `
      width: 100%; min-height: 120px; padding: 12px; margin-bottom: 16px;
      border: 1px solid var(--border-color); border-radius: 8px;
      background: var(--bg-color); color: var(--text-color); font-size: 14px;
      font-family: inherit; resize: vertical;
    `;
          dialogContent.appendChild(textarea);
          const buttonContainer = document.createElement("div");
          buttonContainer.style.cssText = "display: flex; gap: 8px; justify-content: flex-end;";
          const cancelBtn = document.createElement("button");
          cancelBtn.textContent = "Cancel";
          cancelBtn.style.cssText = "padding: 8px 16px; border: 1px solid var(--border-color); background: transparent; color: var(--text-color); border-radius: 4px; cursor: pointer;";
          cancelBtn.addEventListener("click", () => document.body.removeChild(dialog));
          const saveBtn = document.createElement("button");
          saveBtn.textContent = "Save Note";
          saveBtn.style.cssText = "padding: 8px 16px; border: none; background: var(--primary-color); color: white; border-radius: 4px; cursor: pointer;";
          saveBtn.addEventListener("click", async () => {
            await this.setBookmarkNote(bookmark.url, textarea.value);
            this.updateStatus("Note saved successfully!");
            document.body.removeChild(dialog);
          });
          buttonContainer.appendChild(cancelBtn);
          buttonContainer.appendChild(saveBtn);
          dialogContent.appendChild(buttonContainer);
          dialog.appendChild(dialogContent);
          document.body.appendChild(dialog);
          textarea.focus();
        };
        // FEATURE: Custom Tags
        addCustomTag = async (bookmarkUrl, tag) => {
          if (!this.state.bookmarkMetadata[bookmarkUrl]) {
            this.state.bookmarkMetadata[bookmarkUrl] = { read: false, notes: "", customTags: [], favorite: false };
          }
          if (!this.state.bookmarkMetadata[bookmarkUrl].customTags) {
            this.state.bookmarkMetadata[bookmarkUrl].customTags = [];
          }
          if (!this.state.bookmarkMetadata[bookmarkUrl].customTags.includes(tag)) {
            this.state.bookmarkMetadata[bookmarkUrl].customTags.push(tag);
            await this.saveSettings();
          }
        };
        removeCustomTag = async (bookmarkUrl, tag) => {
          var _a;
          if ((_a = this.state.bookmarkMetadata[bookmarkUrl]) == null ? void 0 : _a.customTags) {
            this.state.bookmarkMetadata[bookmarkUrl].customTags = this.state.bookmarkMetadata[bookmarkUrl].customTags.filter((t) => t !== tag);
            await this.saveSettings();
          }
        };
        getCustomTags = (bookmarkUrl) => {
          var _a;
          return ((_a = this.state.bookmarkMetadata[bookmarkUrl]) == null ? void 0 : _a.customTags) || [];
        };
        showTagsDialog = (bookmark) => {
          var _a;
          const dialog = document.createElement("div");
          dialog.setAttribute("role", "dialog");
          dialog.setAttribute("aria-modal", "true");
          dialog.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.7); display: flex;
      align-items: center; justify-content: center; z-index: 1000;
    `;
          const dialogContent = document.createElement("div");
          dialogContent.style.cssText = `
      background: var(--bg-color); padding: 24px; border-radius: 8px;
      max-width: 500px; width: 90%; max-height: 80vh; overflow-y: auto;
    `;
          const title = document.createElement("h2");
          title.style.cssText = "margin-top: 0; color: var(--text-color);";
          title.textContent = "Manage Tags";
          dialogContent.appendChild(title);
          const bookmarkInfo = document.createElement("p");
          bookmarkInfo.style.cssText = "color: var(--disabled-color); font-size: 13px; margin-bottom: 16px;";
          bookmarkInfo.textContent = `@${bookmark.username}: ${(_a = bookmark.text) == null ? void 0 : _a.substring(0, 60)}...`;
          dialogContent.appendChild(bookmarkInfo);
          const tagsContainer = document.createElement("div");
          tagsContainer.id = "current-tags";
          tagsContainer.style.cssText = "margin-bottom: 16px; min-height: 40px;";
          const renderTags = () => {
            tagsContainer.innerHTML = "";
            const tags = this.getCustomTags(bookmark.url);
            if (tags.length === 0) {
              const emptyMsg = document.createElement("p");
              emptyMsg.style.cssText = "color: var(--disabled-color); font-style: italic;";
              emptyMsg.textContent = "No tags yet";
              tagsContainer.appendChild(emptyMsg);
            } else {
              tags.forEach((tag) => {
                const tagSpan = document.createElement("span");
                tagSpan.style.cssText = `
            display: inline-block; background: var(--primary-color); color: white;
            padding: 6px 12px; margin: 4px; border-radius: 16px; font-size: 13px;
          `;
                tagSpan.textContent = tag;
                const removeBtn = document.createElement("button");
                removeBtn.textContent = "\xD7";
                removeBtn.style.cssText = `
            background: none; border: none; color: white; font-size: 18px;
            cursor: pointer; margin-left: 6px; padding: 0 4px;
          `;
                removeBtn.addEventListener("click", async () => {
                  await this.removeCustomTag(bookmark.url, tag);
                  renderTags();
                });
                tagSpan.appendChild(removeBtn);
                tagsContainer.appendChild(tagSpan);
              });
            }
          };
          renderTags();
          dialogContent.appendChild(tagsContainer);
          const inputContainer = document.createElement("div");
          inputContainer.style.cssText = "display: flex; gap: 8px; margin-bottom: 16px;";
          const tagInput = document.createElement("input");
          tagInput.type = "text";
          tagInput.placeholder = "Add new tag...";
          tagInput.style.cssText = `
      flex: 1; padding: 8px 12px; border: 1px solid var(--border-color);
      border-radius: 4px; background: var(--bg-color); color: var(--text-color);
    `;
          const addTagBtn = document.createElement("button");
          addTagBtn.textContent = "Add";
          addTagBtn.style.cssText = "padding: 8px 16px; border: none; background: var(--primary-color); color: white; border-radius: 4px; cursor: pointer;";
          addTagBtn.addEventListener("click", async () => {
            const tag = tagInput.value.trim();
            if (tag) {
              await this.addCustomTag(bookmark.url, tag);
              tagInput.value = "";
              renderTags();
            }
          });
          tagInput.addEventListener("keypress", (e) => {
            if (e.key === "Enter") {
              addTagBtn.click();
            }
          });
          inputContainer.appendChild(tagInput);
          inputContainer.appendChild(addTagBtn);
          dialogContent.appendChild(inputContainer);
          const closeBtn = document.createElement("button");
          closeBtn.textContent = "Close";
          closeBtn.style.cssText = "width: 100%; padding: 8px 16px; border: 1px solid var(--border-color); background: transparent; color: var(--text-color); border-radius: 4px; cursor: pointer;";
          closeBtn.addEventListener("click", () => document.body.removeChild(dialog));
          dialogContent.appendChild(closeBtn);
          dialog.appendChild(dialogContent);
          document.body.appendChild(dialog);
          tagInput.focus();
        };
        // FEATURE: Saved Searches
        saveCurrentSearch = async () => {
          const searchName = prompt("Name this search:");
          if (!searchName)
            return;
          const savedSearch = {
            id: Date.now().toString(),
            name: searchName,
            query: this.state.searchQuery,
            filters: { ...this.state.filterOptions }
          };
          this.state.savedSearches.push(savedSearch);
          await this.saveSettings();
          this.updateStatus(`Search "${searchName}" saved!`);
        };
        loadSavedSearch = async (searchId) => {
          const search = this.state.savedSearches.find((s) => s.id === searchId);
          if (!search)
            return;
          this.state.searchQuery = search.query;
          this.state.filterOptions = { ...search.filters };
          if (this.elements.searchInput) {
            this.elements.searchInput.value = search.query;
          }
          this.performSearch();
          this.applyFilters();
          this.updateStatus(`Loaded search: ${search.name}`);
        };
        deleteSavedSearch = async (searchId) => {
          this.state.savedSearches = this.state.savedSearches.filter((s) => s.id !== searchId);
          await this.saveSettings();
        };
        showSavedSearchesDialog = () => {
          const dialog = document.createElement("div");
          dialog.setAttribute("role", "dialog");
          dialog.setAttribute("aria-modal", "true");
          dialog.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.7); display: flex;
      align-items: center; justify-content: center; z-index: 1000;
    `;
          const dialogContent = document.createElement("div");
          dialogContent.style.cssText = `
      background: var(--bg-color); padding: 24px; border-radius: 8px;
      max-width: 500px; width: 90%; max-height: 80vh; overflow-y: auto;
    `;
          const title = document.createElement("h2");
          title.style.cssText = "margin-top: 0; color: var(--text-color);";
          title.textContent = "Saved Searches";
          dialogContent.appendChild(title);
          if (this.state.savedSearches.length === 0) {
            const emptyMsg = document.createElement("p");
            emptyMsg.style.cssText = "color: var(--disabled-color); text-align: center; padding: 20px;";
            emptyMsg.textContent = "No saved searches yet";
            dialogContent.appendChild(emptyMsg);
          } else {
            this.state.savedSearches.forEach((search) => {
              const searchItem = document.createElement("div");
              searchItem.style.cssText = `
          display: flex; justify-content: space-between; align-items: center;
          padding: 12px; margin-bottom: 8px; background: var(--hover-color);
          border-radius: 6px; border: 1px solid var(--border-color);
        `;
              const info = document.createElement("div");
              info.style.cssText = "flex: 1;";
              const name = document.createElement("div");
              name.style.cssText = "color: var(--text-color); font-weight: 600; margin-bottom: 4px;";
              name.textContent = search.name;
              const query = document.createElement("div");
              query.style.cssText = "color: var(--disabled-color); font-size: 12px;";
              query.textContent = search.query || "(no query)";
              info.appendChild(name);
              info.appendChild(query);
              const actions = document.createElement("div");
              actions.style.cssText = "display: flex; gap: 8px;";
              const loadBtn = document.createElement("button");
              loadBtn.textContent = "Load";
              loadBtn.style.cssText = "padding: 6px 12px; border: none; background: var(--primary-color); color: white; border-radius: 4px; cursor: pointer; font-size: 12px;";
              loadBtn.addEventListener("click", () => {
                this.loadSavedSearch(search.id);
                document.body.removeChild(dialog);
              });
              const deleteBtn = document.createElement("button");
              deleteBtn.textContent = "\xD7";
              deleteBtn.style.cssText = "padding: 6px 10px; border: none; background: var(--danger-color); color: white; border-radius: 4px; cursor: pointer; font-size: 14px;";
              deleteBtn.addEventListener("click", async () => {
                await this.deleteSavedSearch(search.id);
                document.body.removeChild(dialog);
                this.showSavedSearchesDialog();
              });
              actions.appendChild(loadBtn);
              actions.appendChild(deleteBtn);
              searchItem.appendChild(info);
              searchItem.appendChild(actions);
              dialogContent.appendChild(searchItem);
            });
          }
          const buttonContainer = document.createElement("div");
          buttonContainer.style.cssText = "display: flex; gap: 8px; justify-content: space-between; margin-top: 16px;";
          const saveCurrentBtn = document.createElement("button");
          saveCurrentBtn.textContent = "Save Current Search";
          saveCurrentBtn.style.cssText = "flex: 1; padding: 10px; border: none; background: var(--success-color); color: white; border-radius: 4px; cursor: pointer;";
          saveCurrentBtn.addEventListener("click", async () => {
            await this.saveCurrentSearch();
            document.body.removeChild(dialog);
            this.showSavedSearchesDialog();
          });
          const closeBtn = document.createElement("button");
          closeBtn.textContent = "Close";
          closeBtn.style.cssText = "padding: 10px 20px; border: 1px solid var(--border-color); background: transparent; color: var(--text-color); border-radius: 4px; cursor: pointer;";
          closeBtn.addEventListener("click", () => document.body.removeChild(dialog));
          buttonContainer.appendChild(saveCurrentBtn);
          buttonContainer.appendChild(closeBtn);
          dialogContent.appendChild(buttonContainer);
          dialog.appendChild(dialogContent);
          document.body.appendChild(dialog);
        };
        // FEATURE: View Mode Toggle
        toggleViewMode = async () => {
          const modes = ["list", "grid", "card"];
          const currentIndex = modes.indexOf(this.state.viewMode);
          this.state.viewMode = modes[(currentIndex + 1) % modes.length];
          await this.saveSettings();
          this.updateStatus(`View mode: ${this.state.viewMode}`);
        };
        // FEATURE: Collections
        createCollection = async (name, color = "#1DA1F2") => {
          const collection = {
            id: Date.now().toString(),
            name,
            color,
            bookmarkCount: 0
          };
          this.state.collections.push(collection);
          await this.saveSettings();
          return collection;
        };
        addToCollection = async (bookmarkUrl, collectionId) => {
          if (!this.state.bookmarkMetadata[bookmarkUrl]) {
            this.state.bookmarkMetadata[bookmarkUrl] = { read: false, notes: "", customTags: [], favorite: false };
          }
          this.state.bookmarkMetadata[bookmarkUrl].collection = collectionId;
          await this.saveSettings();
        };
        showCollectionsDialog = () => {
          const dialog = document.createElement("div");
          dialog.setAttribute("role", "dialog");
          dialog.setAttribute("aria-modal", "true");
          dialog.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.7); display: flex;
      align-items: center; justify-content: center; z-index: 1000;
    `;
          const dialogContent = document.createElement("div");
          dialogContent.style.cssText = `
      background: var(--bg-color); padding: 24px; border-radius: 8px;
      max-width: 500px; width: 90%; max-height: 80vh; overflow-y: auto;
    `;
          const title = document.createElement("h2");
          title.style.cssText = "margin-top: 0; color: var(--text-color);";
          title.textContent = "Collections";
          dialogContent.appendChild(title);
          if (this.state.collections.length === 0) {
            const emptyMsg = document.createElement("p");
            emptyMsg.style.cssText = "color: var(--disabled-color); text-align: center; padding: 20px;";
            emptyMsg.textContent = "No collections yet. Create one to organize your bookmarks!";
            dialogContent.appendChild(emptyMsg);
          } else {
            this.state.collections.forEach((collection) => {
              const collectionItem = document.createElement("div");
              collectionItem.style.cssText = `
          padding: 12px; margin-bottom: 8px; background: var(--hover-color);
          border-radius: 6px; border-left: 4px solid ${collection.color};
        `;
              const name = document.createElement("div");
              name.style.cssText = "color: var(--text-color); font-weight: 600;";
              name.textContent = collection.name;
              collectionItem.appendChild(name);
              dialogContent.appendChild(collectionItem);
            });
          }
          const createBtn = document.createElement("button");
          createBtn.textContent = "+ Create Collection";
          createBtn.style.cssText = "width: 100%; padding: 12px; margin: 16px 0 8px 0; border: none; background: var(--primary-color); color: white; border-radius: 4px; cursor: pointer;";
          createBtn.addEventListener("click", () => {
            const name = prompt("Collection name:");
            if (name) {
              this.createCollection(name);
              document.body.removeChild(dialog);
              this.showCollectionsDialog();
            }
          });
          const closeBtn = document.createElement("button");
          closeBtn.textContent = "Close";
          closeBtn.style.cssText = "width: 100%; padding: 12px; border: 1px solid var(--border-color); background: transparent; color: var(--text-color); border-radius: 4px; cursor: pointer;";
          closeBtn.addEventListener("click", () => document.body.removeChild(dialog));
          dialogContent.appendChild(createBtn);
          dialogContent.appendChild(closeBtn);
          dialog.appendChild(dialogContent);
          document.body.appendChild(dialog);
        };
        // FEATURE: Sentiment Analysis
        analyzeSentiment = (text) => {
          const positiveWords = ["good", "great", "awesome", "excellent", "amazing", "love", "best", "wonderful", "fantastic", "happy", "excited", "perfect", "brilliant"];
          const negativeWords = ["bad", "terrible", "awful", "hate", "worst", "horrible", "disappointed", "sad", "angry", "frustrating", "annoying", "poor"];
          const lowerText = text.toLowerCase();
          let score = 0;
          positiveWords.forEach((word) => {
            if (lowerText.includes(word))
              score += 1;
          });
          negativeWords.forEach((word) => {
            if (lowerText.includes(word))
              score -= 1;
          });
          if (score > 0)
            return "positive";
          if (score < 0)
            return "negative";
          return "neutral";
        };
        showSentimentAnalysis = () => {
          if (!this.state.lastExtraction || this.state.lastExtraction.length === 0) {
            this.updateStatus("No bookmarks to analyze.");
            return;
          }
          const sentiments = { positive: 0, neutral: 0, negative: 0 };
          this.state.lastExtraction.forEach((bookmark) => {
            if (bookmark.text) {
              const sentiment = this.analyzeSentiment(bookmark.text);
              sentiments[sentiment]++;
            }
          });
          const dialog = document.createElement("div");
          dialog.setAttribute("role", "dialog");
          dialog.setAttribute("aria-modal", "true");
          dialog.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.7); display: flex;
      align-items: center; justify-content: center; z-index: 1000;
    `;
          const dialogContent = document.createElement("div");
          dialogContent.style.cssText = `
      background: var(--bg-color); padding: 24px; border-radius: 8px;
      max-width: 400px; width: 90%;
    `;
          const total = this.state.lastExtraction.length;
          const posPercent = Math.round(sentiments.positive / total * 100);
          const neuPercent = Math.round(sentiments.neutral / total * 100);
          const negPercent = Math.round(sentiments.negative / total * 100);
          dialogContent.innerHTML = `
      <h2 style="margin-top: 0; color: var(--text-color);">Sentiment Analysis</h2>
      <div style="margin: 20px 0;">
        <div style="margin-bottom: 16px;">
          <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
            <span style="color: var(--text-color);">\u{1F60A} Positive</span>
            <span style="color: var(--text-color); font-weight: 600;">${sentiments.positive} (${posPercent}%)</span>
          </div>
          <div style="background: var(--border-color); height: 8px; border-radius: 4px; overflow: hidden;">
            <div style="background: var(--success-color); height: 100%; width: ${posPercent}%;"></div>
          </div>
        </div>
        <div style="margin-bottom: 16px;">
          <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
            <span style="color: var(--text-color);">\u{1F610} Neutral</span>
            <span style="color: var(--text-color); font-weight: 600;">${sentiments.neutral} (${neuPercent}%)</span>
          </div>
          <div style="background: var(--border-color); height: 8px; border-radius: 4px; overflow: hidden;">
            <div style="background: var(--disabled-color); height: 100%; width: ${neuPercent}%;"></div>
          </div>
        </div>
        <div style="margin-bottom: 16px;">
          <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
            <span style="color: var(--text-color);">\u{1F61E} Negative</span>
            <span style="color: var(--text-color); font-weight: 600;">${sentiments.negative} (${negPercent}%)</span>
          </div>
          <div style="background: var(--border-color); height: 8px; border-radius: 4px; overflow: hidden;">
            <div style="background: var(--danger-color); height: 100%; width: ${negPercent}%;"></div>
          </div>
        </div>
      </div>
      <button id="closeDialog" style="width: 100%; padding: 12px; border: none; background: var(--primary-color); color: white; border-radius: 4px; cursor: pointer;">Close</button>
    `;
          dialog.appendChild(dialogContent);
          document.body.appendChild(dialog);
          const closeDialog = () => document.body.removeChild(dialog);
          document.getElementById("closeDialog").addEventListener("click", closeDialog);
          dialog.addEventListener("click", (e) => {
            if (e.target === dialog)
              closeDialog();
          });
        };
        // FEATURE: AI Q&A over bookmarks
        showAIQADialog = () => {
          const dialog = document.createElement("div");
          dialog.setAttribute("role", "dialog");
          dialog.setAttribute("aria-modal", "true");
          dialog.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.7); display: flex;
      align-items: center; justify-content: center; z-index: 1000;
    `;
          const dialogContent = document.createElement("div");
          dialogContent.style.cssText = `
      background: var(--bg-color); padding: 24px; border-radius: 8px;
      max-width: 600px; width: 90%; max-height: 80vh; overflow-y: auto;
    `;
          const title = document.createElement("h2");
          title.style.cssText = "margin-top: 0; color: var(--text-color);";
          title.textContent = "Ask AI About Your Bookmarks";
          dialogContent.appendChild(title);
          const info = document.createElement("p");
          info.style.cssText = "color: var(--disabled-color); font-size: 13px; margin-bottom: 16px;";
          info.textContent = "Ask questions about your bookmarks. The AI will search through your bookmarks to find relevant answers.";
          dialogContent.appendChild(info);
          const input = document.createElement("input");
          input.type = "text";
          input.placeholder = "e.g., Find tweets about React hooks";
          input.style.cssText = `
      width: 100%; padding: 12px; margin-bottom: 16px;
      border: 1px solid var(--border-color); border-radius: 8px;
      background: var(--bg-color); color: var(--text-color); font-size: 14px;
    `;
          dialogContent.appendChild(input);
          const answerDiv = document.createElement("div");
          answerDiv.id = "ai-answer";
          answerDiv.style.cssText = `
      min-height: 100px; padding: 16px; margin-bottom: 16px;
      background: var(--hover-color); border-radius: 8px;
      border: 1px solid var(--border-color); color: var(--text-color);
      display: none;
    `;
          dialogContent.appendChild(answerDiv);
          const buttonContainer = document.createElement("div");
          buttonContainer.style.cssText = "display: flex; gap: 8px;";
          const askBtn = document.createElement("button");
          askBtn.textContent = "Ask";
          askBtn.style.cssText = "flex: 1; padding: 12px; border: none; background: var(--primary-color); color: white; border-radius: 4px; cursor: pointer;";
          askBtn.addEventListener("click", () => {
            const question = input.value.trim();
            if (!question)
              return;
            answerDiv.style.display = "block";
            answerDiv.textContent = "Searching bookmarks...";
            setTimeout(() => {
              const keywords = question.toLowerCase().split(" ").filter((w) => w.length > 3);
              const results = (this.state.lastExtraction || []).filter((b) => {
                var _a;
                const text = ((_a = b.text) == null ? void 0 : _a.toLowerCase()) || "";
                return keywords.some((keyword) => text.includes(keyword));
              });
              if (results.length === 0) {
                answerDiv.textContent = "No relevant bookmarks found for your question.";
              } else {
                answerDiv.innerHTML = `
            <strong style="color: var(--text-color);">Found ${results.length} relevant bookmarks:</strong><br><br>
            ${results.slice(0, 5).map((b, i) => {
                  var _a;
                  return `
              <div style="margin-bottom: 12px; padding-bottom: 12px; border-bottom: 1px solid var(--border-color);">
                <strong style="color: var(--text-color);">@${b.username}</strong>: ${(_a = b.text) == null ? void 0 : _a.substring(0, 150)}...
                <br><a href="${b.url}" target="_blank" style="color: var(--primary-color); font-size: 12px;">View tweet</a>
              </div>
            `;
                }).join("")}
          `;
              }
            }, 500);
          });
          const closeBtn = document.createElement("button");
          closeBtn.textContent = "Close";
          closeBtn.style.cssText = "padding: 12px 20px; border: 1px solid var(--border-color); background: transparent; color: var(--text-color); border-radius: 4px; cursor: pointer;";
          closeBtn.addEventListener("click", () => document.body.removeChild(dialog));
          buttonContainer.appendChild(askBtn);
          buttonContainer.appendChild(closeBtn);
          dialogContent.appendChild(buttonContainer);
          dialog.appendChild(dialogContent);
          document.body.appendChild(dialog);
          input.focus();
        };
        // SUBSCRIPTION & QUOTA UI
        updateSubscriptionUI = () => {
          const { isPro } = this.state.quota;
          if (isPro) {
            if (this.elements.upgradeBtn)
              this.elements.upgradeBtn.style.display = "none";
            if (this.elements.subscriptionStatus) {
              this.elements.subscriptionStatus.style.display = "block";
              this.elements.subscriptionStatus.textContent = "\u{1F31F} Pro Plan Active (Unlimited Analysis)";
            }
          } else {
            if (this.elements.upgradeBtn) {
              this.elements.upgradeBtn.style.display = "block";
              this.elements.upgradeBtn.textContent = `\u{1F451} Upgrade to Pro (${this.state.quota.count}/${this.state.quota.limit} used today)`;
            }
            if (this.elements.subscriptionStatus)
              this.elements.subscriptionStatus.style.display = "none";
          }
        };
        handleUpgrade = () => {
          const dialog = document.createElement("div");
          dialog.className = "modal-overlay";
          dialog.innerHTML = `
      <div class="modal-content">
        <span class="modal-icon">\u{1F451}</span>
        <h2 class="modal-title">Upgrade to Pro</h2>
        <p class="modal-text">
          Unlock unlimited AI analysis and advanced features!<br>
          Current Plan: 10 bookmarks/day<br>
          Pro Plan: Unlimited
        </p>
        <div class="modal-actions">
          <button id="confirmUpgradeBtn" class="modal-primary-btn">Unlock Now ($9.99)</button>
          <button id="cancelUpgradeBtn" class="modal-secondary-btn">Maybe Later</button>
        </div>
      </div>
    `;
          document.body.appendChild(dialog);
          document.getElementById("confirmUpgradeBtn").onclick = async () => {
            await this.subscriptionManager.upgrade();
            this.state.quota.isPro = true;
            this.updateSubscriptionUI();
            document.body.removeChild(dialog);
            this.updateStatus("\u{1F31F} Upgraded to Pro! Enjoy unlimited access.");
          };
          document.getElementById("cancelUpgradeBtn").onclick = () => {
            document.body.removeChild(dialog);
          };
        };
        showLimitReachedModal = () => {
          const dialog = document.createElement("div");
          dialog.className = "modal-overlay";
          dialog.innerHTML = `
      <div class="modal-content">
        <span class="modal-icon">\u{1F6D1}</span>
        <h2 class="modal-title">Daily Limit Reached</h2>
        <p class="modal-text">
          You have reached your daily limit of ${this.quotaManager.DAILY_LIMIT} AI analyses.<br>
          Upgrade to Pro for unlimited access or come back tomorrow!
        </p>
        <div class="modal-actions">
          <button id="limitUpgradeBtn" class="modal-primary-btn">Upgrade to Pro</button>
          <button id="limitCloseBtn" class="modal-secondary-btn">Close</button>
        </div>
      </div>
    `;
          document.body.appendChild(dialog);
          document.getElementById("limitUpgradeBtn").onclick = () => {
            document.body.removeChild(dialog);
            this.handleUpgrade();
          };
          document.getElementById("limitCloseBtn").onclick = () => {
            document.body.removeChild(dialog);
          };
        };
        // FEATURE: Find Similar Bookmarks
        findSimilarBookmarks = (bookmarkUrl) => {
          var _a;
          const targetBookmark = (_a = this.state.lastExtraction) == null ? void 0 : _a.find((b) => b.url === bookmarkUrl);
          if (!targetBookmark)
            return [];
          const targetWords = new Set(
            (targetBookmark.text || "").toLowerCase().split(/\s+/).filter((w) => w.length > 4)
          );
          const similarities = (this.state.lastExtraction || []).filter((b) => b.url !== bookmarkUrl).map((bookmark) => {
            const words = (bookmark.text || "").toLowerCase().split(/\s+/).filter((w) => w.length > 4);
            const commonWords = words.filter((w) => targetWords.has(w)).length;
            const similarity = commonWords / Math.max(targetWords.size, words.length);
            return { bookmark, similarity };
          }).filter((item) => item.similarity > 0.1).sort((a, b) => b.similarity - a.similarity).slice(0, 10);
          return similarities;
        };
        showSimilarBookmarksDialog = (bookmark) => {
          var _a;
          const similar = this.findSimilarBookmarks(bookmark.url);
          const dialog = document.createElement("div");
          dialog.setAttribute("role", "dialog");
          dialog.setAttribute("aria-modal", "true");
          dialog.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.7); display: flex;
      align-items: center; justify-content: center; z-index: 1000;
    `;
          const dialogContent = document.createElement("div");
          dialogContent.style.cssText = `
      background: var(--bg-color); padding: 24px; border-radius: 8px;
      max-width: 600px; width: 90%; max-height: 80vh; overflow-y: auto;
    `;
          const title = document.createElement("h2");
          title.style.cssText = "margin-top: 0; color: var(--text-color);";
          title.textContent = "Similar Bookmarks";
          dialogContent.appendChild(title);
          const info = document.createElement("p");
          info.style.cssText = "color: var(--disabled-color); font-size: 13px; margin-bottom: 16px;";
          info.textContent = `Finding bookmarks similar to: ${(_a = bookmark.text) == null ? void 0 : _a.substring(0, 60)}...`;
          dialogContent.appendChild(info);
          if (similar.length === 0) {
            const emptyMsg = document.createElement("p");
            emptyMsg.style.cssText = "color: var(--disabled-color); text-align: center; padding: 20px;";
            emptyMsg.textContent = "No similar bookmarks found";
            dialogContent.appendChild(emptyMsg);
          } else {
            similar.forEach(({ bookmark: b, similarity }) => {
              var _a2;
              const item = document.createElement("div");
              item.style.cssText = `
          padding: 12px; margin-bottom: 12px; background: var(--hover-color);
          border-radius: 6px; border-left: 4px solid var(--primary-color);
        `;
              const author = document.createElement("div");
              author.style.cssText = "color: var(--text-color); font-weight: 600; margin-bottom: 4px;";
              author.textContent = `@${b.username} (${Math.round(similarity * 100)}% similar)`;
              const text = document.createElement("div");
              text.style.cssText = "color: var(--text-color); font-size: 13px; margin-bottom: 8px;";
              text.textContent = ((_a2 = b.text) == null ? void 0 : _a2.substring(0, 150)) + "...";
              const link = document.createElement("a");
              link.href = b.url;
              link.target = "_blank";
              link.style.cssText = "color: var(--primary-color); font-size: 12px; text-decoration: none;";
              link.textContent = "View tweet \u2192";
              item.appendChild(author);
              item.appendChild(text);
              item.appendChild(link);
              dialogContent.appendChild(item);
            });
          }
          const closeBtn = document.createElement("button");
          closeBtn.textContent = "Close";
          closeBtn.style.cssText = "width: 100%; padding: 12px; margin-top: 16px; border: 1px solid var(--border-color); background: transparent; color: var(--text-color); border-radius: 4px; cursor: pointer;";
          closeBtn.addEventListener("click", () => document.body.removeChild(dialog));
          dialogContent.appendChild(closeBtn);
          dialog.appendChild(dialogContent);
          document.body.appendChild(dialog);
        };
        // FEATURE: Reminder System
        setReminder = async (bookmarkUrl, reminderDate, message = "") => {
          const reminder = {
            id: Date.now().toString(),
            bookmarkUrl,
            reminderDate: reminderDate.toISOString(),
            message,
            created: (/* @__PURE__ */ new Date()).toISOString()
          };
          this.state.reminders.push(reminder);
          await this.saveSettings();
          return reminder;
        };
        checkReminders = () => {
          const now = /* @__PURE__ */ new Date();
          const dueReminders = this.state.reminders.filter((r) => {
            return new Date(r.reminderDate) <= now;
          });
          if (dueReminders.length > 0) {
            dueReminders.forEach((reminder) => {
              var _a, _b;
              const bookmark = (_a = this.state.lastExtraction) == null ? void 0 : _a.find((b) => b.url === reminder.bookmarkUrl);
              if (bookmark) {
                this.updateStatus(`Reminder: ${reminder.message || ((_b = bookmark.text) == null ? void 0 : _b.substring(0, 50))}`);
              }
            });
            this.state.reminders = this.state.reminders.filter((r) => {
              return new Date(r.reminderDate) > now;
            });
            this.saveSettings();
          }
        };
        // ====== NEW FEATURES v0.11.0 (LOW COMPLEXITY) ======
        // FEATURE: Favorites/Stars
        toggleFavorite = async (bookmarkUrl) => {
          if (!this.state.bookmarkMetadata[bookmarkUrl]) {
            this.state.bookmarkMetadata[bookmarkUrl] = { read: false, notes: "", customTags: [], favorite: false };
          }
          this.state.bookmarkMetadata[bookmarkUrl].favorite = !this.state.bookmarkMetadata[bookmarkUrl].favorite;
          await this.saveSettings();
          return this.state.bookmarkMetadata[bookmarkUrl].favorite;
        };
        isFavorite = (bookmarkUrl) => {
          var _a;
          return ((_a = this.state.bookmarkMetadata[bookmarkUrl]) == null ? void 0 : _a.favorite) || false;
        };
        getFavorites = () => {
          return (this.state.lastExtraction || []).filter((b) => this.isFavorite(b.url));
        };
        // FEATURE: Archive
        toggleArchive = async (bookmarkUrl) => {
          if (!this.state.bookmarkMetadata[bookmarkUrl]) {
            this.state.bookmarkMetadata[bookmarkUrl] = { read: false, notes: "", customTags: [], favorite: false, archived: false };
          }
          this.state.bookmarkMetadata[bookmarkUrl].archived = !this.state.bookmarkMetadata[bookmarkUrl].archived;
          await this.saveSettings();
          return this.state.bookmarkMetadata[bookmarkUrl].archived;
        };
        isArchived = (bookmarkUrl) => {
          var _a;
          return ((_a = this.state.bookmarkMetadata[bookmarkUrl]) == null ? void 0 : _a.archived) || false;
        };
        getArchived = () => {
          return (this.state.lastExtraction || []).filter((b) => this.isArchived(b.url));
        };
        // FEATURE: Bulk Selection
        toggleBulkSelection = (bookmarkUrl) => {
          const index = this.state.bulkSelection.indexOf(bookmarkUrl);
          if (index > -1) {
            this.state.bulkSelection.splice(index, 1);
          } else {
            this.state.bulkSelection.push(bookmarkUrl);
          }
        };
        selectAll = () => {
          const bookmarks = this.state.filteredBookmarks || this.state.lastExtraction || [];
          this.state.bulkSelection = bookmarks.map((b) => b.url);
        };
        deselectAll = () => {
          this.state.bulkSelection = [];
        };
        bulkMarkAsRead = async () => {
          for (const url of this.state.bulkSelection) {
            await this.markAsRead(url);
          }
          this.updateStatus(`Marked ${this.state.bulkSelection.length} bookmarks as read`);
        };
        bulkAddToCollection = async (collectionId) => {
          for (const url of this.state.bulkSelection) {
            await this.addToCollection(url, collectionId);
          }
          this.updateStatus(`Added ${this.state.bulkSelection.length} bookmarks to collection`);
        };
        bulkDelete = async () => {
          this.state.lastExtraction = (this.state.lastExtraction || []).filter(
            (b) => !this.state.bulkSelection.includes(b.url)
          );
          await chrome.storage.local.set({
            lastExtraction: {
              timestamp: Date.now(),
              bookmarks: this.state.lastExtraction
            }
          });
          this.updateStatus(`Deleted ${this.state.bulkSelection.length} bookmarks`);
          this.state.bulkSelection = [];
          this.updateUI();
          this.updateStatus(`Deleted ${this.state.bulkSelection.length} bookmarks`);
          this.state.bulkSelection = [];
          this.updateUI();
        };
        // FEATURE: Reading Time Estimation
        estimateReadingTime = (text) => {
          if (!text)
            return 0;
          const wordsPerMinute = 200;
          const words = text.trim().split(/\s+/).length;
          return Math.ceil(words / wordsPerMinute);
        };
        // FEATURE: Content Type Detection
        detectContentType = (bookmark) => {
          const text = bookmark.text || "";
          const hasLinks = /https?:\/\//.test(text);
          const hasHashtags = /#\w+/.test(text);
          const hasMentions = /@\w+/.test(text);
          const isThread = text.includes("\u{1F9F5}") || text.includes("1/") || text.includes("Thread:");
          const isQuestion = text.includes("?");
          if (isThread)
            return "thread";
          if (bookmark.replies > 50)
            return "discussion";
          if (hasLinks && text.length < 100)
            return "link-share";
          if (isQuestion)
            return "question";
          if (text.length > 500)
            return "long-form";
          if (hasHashtags)
            return "tagged";
          return "standard";
        };
        // FEATURE: Keyboard Shortcuts
        setupKeyboardShortcuts = () => {
          document.addEventListener("keydown", (e) => {
            var _a;
            if ((e.ctrlKey || e.metaKey) && e.key === "k") {
              e.preventDefault();
              (_a = this.elements.searchInput) == null ? void 0 : _a.focus();
            }
            if ((e.ctrlKey || e.metaKey) && e.key === "f") {
              e.preventDefault();
              this.showFilterDialog();
            }
            if ((e.ctrlKey || e.metaKey) && e.key === "s") {
              e.preventDefault();
              this.showSortDialog();
            }
            if ((e.ctrlKey || e.metaKey) && e.key === "e") {
              e.preventDefault();
              this.downloadMarkdown();
            }
            if ((e.ctrlKey || e.metaKey) && e.key === "a" && e.target.tagName !== "INPUT" && e.target.tagName !== "TEXTAREA") {
              e.preventDefault();
              this.selectAll();
              this.updateStatus(`Selected all ${this.state.bulkSelection.length} bookmarks`);
            }
            if (e.key === "Escape") {
              this.deselectAll();
              this.updateStatus("Cleared selection");
            }
            if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
              e.preventDefault();
              this.undo();
            }
            if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "z" || (e.ctrlKey || e.metaKey) && e.key === "y") {
              e.preventDefault();
              this.redo();
            }
          });
        };
        // FEATURE: Author Frequency Analytics
        getAuthorAnalytics = () => {
          const authorStats = {};
          (this.state.lastExtraction || []).forEach((bookmark) => {
            const username = bookmark.username || "unknown";
            if (!authorStats[username]) {
              authorStats[username] = {
                count: 0,
                totalLikes: 0,
                totalRetweets: 0,
                displayName: bookmark.displayName || username,
                bookmarks: []
              };
            }
            authorStats[username].count++;
            authorStats[username].totalLikes += parseInt(bookmark.likes || 0);
            authorStats[username].totalRetweets += parseInt(bookmark.retweets || 0);
            authorStats[username].bookmarks.push(bookmark);
          });
          return Object.entries(authorStats).map(([username, stats]) => ({
            username,
            ...stats,
            avgLikes: Math.round(stats.totalLikes / stats.count),
            avgRetweets: Math.round(stats.totalRetweets / stats.count)
          })).sort((a, b) => b.count - a.count);
        };
        showAuthorAnalytics = () => {
          const authors = this.getAuthorAnalytics();
          const dialog = document.createElement("div");
          dialog.setAttribute("role", "dialog");
          dialog.setAttribute("aria-modal", "true");
          dialog.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.7); display: flex;
      align-items: center; justify-content: center; z-index: 1000;
    `;
          const dialogContent = document.createElement("div");
          dialogContent.style.cssText = `
      background: var(--bg-color); padding: 24px; border-radius: 8px;
      max-width: 600px; width: 90%; max-height: 80vh; overflow-y: auto;
    `;
          const title = document.createElement("h2");
          title.style.cssText = "margin-top: 0; color: var(--text-color);";
          title.textContent = "Author Analytics";
          dialogContent.appendChild(title);
          authors.slice(0, 20).forEach((author, index) => {
            const item = document.createElement("div");
            item.style.cssText = `
        padding: 12px; margin-bottom: 8px; background: var(--hover-color);
        border-radius: 6px; border-left: 4px solid var(--primary-color);
      `;
            const header = document.createElement("div");
            header.style.cssText = "display: flex; justify-content: space-between; margin-bottom: 8px;";
            const name = document.createElement("div");
            name.style.cssText = "color: var(--text-color); font-weight: 600;";
            name.textContent = `${index + 1}. ${author.displayName} (@${author.username})`;
            const count = document.createElement("div");
            count.style.cssText = "color: var(--primary-color); font-weight: 600;";
            count.textContent = `${author.count} bookmarks`;
            header.appendChild(name);
            header.appendChild(count);
            const stats = document.createElement("div");
            stats.style.cssText = "color: var(--disabled-color); font-size: 13px;";
            stats.textContent = `Avg: ${author.avgLikes} likes \u2022 ${author.avgRetweets} retweets`;
            item.appendChild(header);
            item.appendChild(stats);
            dialogContent.appendChild(item);
          });
          const closeBtn = document.createElement("button");
          closeBtn.textContent = "Close";
          closeBtn.style.cssText = "width: 100%; padding: 12px; margin-top: 16px; border: 1px solid var(--border-color); background: transparent; color: var(--text-color); border-radius: 4px; cursor: pointer;";
          closeBtn.addEventListener("click", () => document.body.removeChild(dialog));
          dialogContent.appendChild(closeBtn);
          dialog.appendChild(dialogContent);
          document.body.appendChild(dialog);
        };
        // FEATURE: Undo/Redo System
        saveState = (action) => {
          this.state.undoStack.push({
            action,
            timestamp: Date.now(),
            data: JSON.stringify({
              lastExtraction: this.state.lastExtraction,
              bookmarkMetadata: this.state.bookmarkMetadata
            })
          });
          if (this.state.undoStack.length > 20) {
            this.state.undoStack.shift();
          }
          this.state.redoStack = [];
        };
        undo = () => {
          if (this.state.undoStack.length === 0) {
            this.updateStatus("Nothing to undo");
            return;
          }
          this.state.redoStack.push({
            action: "redo point",
            timestamp: Date.now(),
            data: JSON.stringify({
              lastExtraction: this.state.lastExtraction,
              bookmarkMetadata: this.state.bookmarkMetadata
            })
          });
          const previousState = this.state.undoStack.pop();
          const restored = JSON.parse(previousState.data);
          this.state.lastExtraction = restored.lastExtraction;
          this.state.bookmarkMetadata = restored.bookmarkMetadata;
          this.updateStatus(`Undone: ${previousState.action}`);
          this.updateUI();
        };
        redo = () => {
          if (this.state.redoStack.length === 0) {
            this.updateStatus("Nothing to redo");
            return;
          }
          const nextState = this.state.redoStack.pop();
          const restored = JSON.parse(nextState.data);
          this.state.lastExtraction = restored.lastExtraction;
          this.state.bookmarkMetadata = restored.bookmarkMetadata;
          this.updateStatus("Redone action");
          this.updateUI();
        };
        // FEATURE: Hidden Gems Finder
        findHiddenGems = () => {
          if (!this.state.lastExtraction || this.state.lastExtraction.length === 0) {
            return [];
          }
          const avgLikes = this.state.lastExtraction.reduce((sum, b) => sum + (parseInt(b.likes) || 0), 0) / this.state.lastExtraction.length;
          return this.state.lastExtraction.filter((b) => {
            const likes = parseInt(b.likes) || 0;
            const hasLinks = /https?:\/\//.test(b.text || "");
            const isLongForm = (b.text || "").length > 400;
            const readingTime = this.estimateReadingTime(b.text);
            return likes < avgLikes * 0.5 && (hasLinks || isLongForm || readingTime >= 2);
          }).slice(0, 20);
        };
        showHiddenGems = () => {
          const gems = this.findHiddenGems();
          const dialog = document.createElement("div");
          dialog.setAttribute("role", "dialog");
          dialog.setAttribute("aria-modal", "true");
          dialog.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.7); display: flex;
      align-items: center; justify-content: center; z-index: 1000;
    `;
          const dialogContent = document.createElement("div");
          dialogContent.style.cssText = `
      background: var(--bg-color); padding: 24px; border-radius: 8px;
      max-width: 600px; width: 90%; max-height: 80vh; overflow-y: auto;
    `;
          const title = document.createElement("h2");
          title.style.cssText = "margin-top: 0; color: var(--text-color);";
          title.textContent = "\u{1F48E} Hidden Gems";
          dialogContent.appendChild(title);
          const info = document.createElement("p");
          info.style.cssText = "color: var(--disabled-color); font-size: 13px; margin-bottom: 16px;";
          info.textContent = "Quality bookmarks with lower engagement that you might have missed.";
          dialogContent.appendChild(info);
          if (gems.length === 0) {
            const emptyMsg = document.createElement("p");
            emptyMsg.style.cssText = "color: var(--disabled-color); text-align: center; padding: 20px;";
            emptyMsg.textContent = "No hidden gems found";
            dialogContent.appendChild(emptyMsg);
          } else {
            gems.forEach((gem) => {
              var _a;
              const item = document.createElement("div");
              item.style.cssText = `
          padding: 12px; margin-bottom: 12px; background: var(--hover-color);
          border-radius: 6px; border-left: 4px solid #FFD700;
        `;
              const author = document.createElement("div");
              author.style.cssText = "color: var(--text-color); font-weight: 600; margin-bottom: 4px;";
              author.textContent = `@${gem.username}`;
              const text = document.createElement("div");
              text.style.cssText = "color: var(--text-color); font-size: 13px; margin-bottom: 8px;";
              text.textContent = ((_a = gem.text) == null ? void 0 : _a.substring(0, 200)) + "...";
              const meta = document.createElement("div");
              meta.style.cssText = "color: var(--disabled-color); font-size: 12px;";
              meta.textContent = `\u{1F4D6} ${this.estimateReadingTime(gem.text)} min read \u2022 ${gem.likes || 0} likes`;
              const link = document.createElement("a");
              link.href = gem.url;
              link.target = "_blank";
              link.style.cssText = "color: var(--primary-color); font-size: 12px; text-decoration: none; display: inline-block; margin-top: 8px;";
              link.textContent = "View tweet \u2192";
              item.appendChild(author);
              item.appendChild(text);
              item.appendChild(meta);
              item.appendChild(link);
              dialogContent.appendChild(item);
            });
          }
          const closeBtn = document.createElement("button");
          closeBtn.textContent = "Close";
          closeBtn.style.cssText = "width: 100%; padding: 12px; margin-top: 16px; border: 1px solid var(--border-color); background: transparent; color: var(--text-color); border-radius: 4px; cursor: pointer;";
          closeBtn.addEventListener("click", () => document.body.removeChild(dialog));
          dialogContent.appendChild(closeBtn);
          dialog.appendChild(dialogContent);
          document.body.appendChild(dialog);
        };
        // ====== MEDIUM COMPLEXITY FEATURES v0.11.0 ======
        // FEATURE: Reading Queue with Priorities
        addToReadingQueue = async (bookmarkUrl, priority = 1) => {
          const existing = this.state.readingQueue.find((item) => item.bookmarkUrl === bookmarkUrl);
          if (existing) {
            existing.priority = priority;
          } else {
            this.state.readingQueue.push({
              bookmarkUrl,
              priority,
              addedDate: (/* @__PURE__ */ new Date()).toISOString()
            });
          }
          await this.saveSettings();
        };
        showReadingQueue = () => {
          const queue = this.state.readingQueue.sort((a, b) => b.priority - a.priority).map((item) => {
            var _a;
            const bookmark = (_a = this.state.lastExtraction) == null ? void 0 : _a.find((b) => b.url === item.bookmarkUrl);
            return { ...item, bookmark };
          }).filter((item) => item.bookmark);
          this.updateStatus(`Reading queue: ${queue.length} items`);
        };
        // FEATURE: Thread Reader/Unroller
        detectThread = (bookmark) => {
          const text = bookmark.text || "";
          const indicators = ["\u{1F9F5}", "1/", "Thread:", "THREAD:", "\u{1F447}", "1) ", "1. "];
          return indicators.some((indicator) => text.includes(indicator));
        };
        // FEATURE: Tag Cloud Visualization
        generateTagCloud = () => {
          const tagFrequency = {};
          if (this.state.aiAnalysis && this.state.aiAnalysis.tags) {
            this.state.aiAnalysis.tags.forEach((tag) => {
              tagFrequency[tag] = (tagFrequency[tag] || 0) + 1;
            });
          }
          Object.values(this.state.bookmarkMetadata).forEach((meta) => {
            if (meta.customTags) {
              meta.customTags.forEach((tag) => {
                tagFrequency[tag] = (tagFrequency[tag] || 0) + 3;
              });
            }
          });
          return Object.entries(tagFrequency).sort((a, b) => b[1] - a[1]).slice(0, 50);
        };
        // ====== HIGH COMPLEXITY FEATURES v0.11.0 ======
        // FEATURE: Engagement Tracking Over Time
        trackEngagement = async (bookmark) => {
          if (!this.state.engagementHistory[bookmark.url]) {
            this.state.engagementHistory[bookmark.url] = [];
          }
          this.state.engagementHistory[bookmark.url].push({
            timestamp: (/* @__PURE__ */ new Date()).toISOString(),
            likes: parseInt(bookmark.likes) || 0,
            retweets: parseInt(bookmark.retweets) || 0,
            replies: parseInt(bookmark.replies) || 0,
            views: parseInt(bookmark.views) || 0
          });
          if (this.state.engagementHistory[bookmark.url].length > 30) {
            this.state.engagementHistory[bookmark.url] = this.state.engagementHistory[bookmark.url].slice(-30);
          }
          await this.saveSettings();
        };
        trackAllEngagements = async () => {
          if (!this.state.lastExtraction)
            return;
          for (const bookmark of this.state.lastExtraction) {
            await this.trackEngagement(bookmark);
          }
          this.updateStatus(`Tracked engagement for ${this.state.lastExtraction.length} bookmarks`);
        };
        getEngagementGrowth = (bookmarkUrl) => {
          const history = this.state.engagementHistory[bookmarkUrl];
          if (!history || history.length < 2)
            return null;
          const first = history[0];
          const last = history[history.length - 1];
          return {
            likesGrowth: last.likes - first.likes,
            retweetsGrowth: last.retweets - first.retweets,
            repliesGrowth: last.replies - first.replies,
            viewsGrowth: last.views - first.views,
            timespan: new Date(last.timestamp) - new Date(first.timestamp)
          };
        };
        // FEATURE: Deleted Tweet Detection
        checkForDeletedTweets = async () => {
          if (!this.state.lastExtraction)
            return [];
          const deleted = [];
          const sampleSize = Math.min(20, this.state.lastExtraction.length);
          for (let i = 0; i < sampleSize; i++) {
            const bookmark = this.state.lastExtraction[i];
            const daysOld = (Date.now() - new Date(bookmark.dateTime)) / (1e3 * 60 * 60 * 24);
            if (daysOld > 365) {
              deleted.push(bookmark);
            }
          }
          return deleted;
        };
        archiveDeletedTweets = async () => {
          const deleted = await this.checkForDeletedTweets();
          deleted.forEach((bookmark) => {
            if (!this.state.bookmarkMetadata[bookmark.url]) {
              this.state.bookmarkMetadata[bookmark.url] = {};
            }
            this.state.bookmarkMetadata[bookmark.url].archivedContent = {
              text: bookmark.text,
              author: bookmark.displayName,
              username: bookmark.username,
              dateTime: bookmark.dateTime,
              archivedAt: (/* @__PURE__ */ new Date()).toISOString()
            };
          });
          await this.saveSettings();
          this.updateStatus(`Archived ${deleted.length} potentially deleted tweets`);
        };
        // ====== END NEW FEATURES v0.11.0 ======
      };
      var LLMProvider = class {
        constructor(constants) {
          this.constants = constants || {
            AI_ANALYSIS_LIMIT: 50,
            AI_MAX_TOKENS: 500,
            AI_TEMPERATURE: 0.7,
            MAX_TAGS: 20,
            MAX_CATEGORIES: 10
          };
        }
        prepareBookmarkTexts(bookmarks) {
          return bookmarks.filter((b) => b.text && b.text.trim()).slice(0, this.constants.AI_ANALYSIS_LIMIT).map((b) => `@${b.username}: ${b.text}`).join("\n\n");
        }
        parseJSONResponse(content) {
          let analysis = null;
          try {
            analysis = JSON.parse(content);
            return analysis;
          } catch (e) {
            const codeBlockMatch = content.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
            if (codeBlockMatch) {
              try {
                analysis = JSON.parse(codeBlockMatch[1]);
                return analysis;
              } catch (e2) {
              }
            }
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              try {
                analysis = JSON.parse(jsonMatch[0]);
                return analysis;
              } catch (e3) {
                throw new Error("Failed to parse response as JSON");
              }
            } else {
              throw new Error("No JSON found in response");
            }
          }
        }
        validateAnalysis(analysis) {
          if (!analysis || typeof analysis !== "object") {
            throw new Error("Analysis is not a valid object");
          }
          const validatedAnalysis = {
            overallSummary: typeof analysis.overallSummary === "string" ? analysis.overallSummary : "",
            tags: Array.isArray(analysis.tags) ? analysis.tags.filter((t) => typeof t === "string").slice(0, this.constants.MAX_TAGS) : [],
            categories: Array.isArray(analysis.categories) ? analysis.categories.filter((c) => typeof c === "string").slice(0, this.constants.MAX_CATEGORIES) : [],
            timestamp: Date.now()
          };
          if (!validatedAnalysis.overallSummary && validatedAnalysis.tags.length === 0 && validatedAnalysis.categories.length === 0) {
            throw new Error("Response contained no useful analysis data");
          }
          return validatedAnalysis;
        }
        async analyzeBookmarks(bookmarks) {
          throw new Error("analyzeBookmarks must be implemented by subclass");
        }
      };
      var OpenAIProvider = class extends LLMProvider {
        constructor(apiKey, constants) {
          super(constants);
          this.apiKey = apiKey;
          this.apiUrl = "https://api.openai.com/v1/chat/completions";
          this.model = "gpt-3.5-turbo";
        }
        async analyzeBookmarks(bookmarks) {
          var _a;
          const bookmarkTexts = this.prepareBookmarkTexts(bookmarks);
          if (!bookmarkTexts) {
            throw new Error("No bookmark content to analyze");
          }
          const prompt2 = `Analyze these Twitter/X bookmarks and provide:
1. An overall summary (2-3 sentences) of the main themes
2. A list of 5-10 relevant tags/keywords
3. 3-5 main categories these bookmarks fall into

Bookmarks:
${bookmarkTexts}

Respond in JSON format:
{
  "overallSummary": "...",
  "tags": ["tag1", "tag2", ...],
  "categories": ["category1", "category2", ...]
}`;
          try {
            const response = await fetch(this.apiUrl, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${this.apiKey}`
              },
              body: JSON.stringify({
                model: this.model,
                messages: [
                  {
                    role: "system",
                    content: "You are a helpful assistant that analyzes social media content and provides structured summaries."
                  },
                  {
                    role: "user",
                    content: prompt2
                  }
                ],
                temperature: this.constants.AI_TEMPERATURE,
                max_tokens: this.constants.AI_MAX_TOKENS
              })
            });
            if (!response.ok) {
              const errorData = await response.json().catch(() => ({}));
              throw new Error(((_a = errorData.error) == null ? void 0 : _a.message) || `API error: ${response.status}`);
            }
            const data = await response.json();
            if (!data.choices || !Array.isArray(data.choices) || data.choices.length === 0) {
              throw new Error("Invalid API response structure");
            }
            if (!data.choices[0].message || !data.choices[0].message.content) {
              throw new Error("Missing content in API response");
            }
            const content = data.choices[0].message.content;
            const analysis = this.parseJSONResponse(content);
            return this.validateAnalysis(analysis);
          } catch (error) {
            console.error("OpenAI Analysis error:", error);
            throw error;
          }
        }
      };
      var AnthropicProvider = class extends LLMProvider {
        constructor(apiKey, constants) {
          super(constants);
          this.apiKey = apiKey;
          this.apiUrl = "https://api.anthropic.com/v1/messages";
          this.model = "claude-3-5-sonnet-20241022";
        }
        async analyzeBookmarks(bookmarks) {
          var _a;
          const bookmarkTexts = this.prepareBookmarkTexts(bookmarks);
          if (!bookmarkTexts) {
            throw new Error("No bookmark content to analyze");
          }
          const prompt2 = `Analyze these Twitter/X bookmarks and provide:
1. An overall summary (2-3 sentences) of the main themes
2. A list of 5-10 relevant tags/keywords
3. 3-5 main categories these bookmarks fall into

Bookmarks:
${bookmarkTexts}

Respond in JSON format:
{
  "overallSummary": "...",
  "tags": ["tag1", "tag2", ...],
  "categories": ["category1", "category2", ...]
}`;
          try {
            const response = await fetch(this.apiUrl, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-api-key": this.apiKey,
                "anthropic-version": "2023-06-01"
              },
              body: JSON.stringify({
                model: this.model,
                max_tokens: this.constants.AI_MAX_TOKENS,
                messages: [
                  {
                    role: "user",
                    content: prompt2
                  }
                ]
              })
            });
            if (!response.ok) {
              const errorData = await response.json().catch(() => ({}));
              throw new Error(((_a = errorData.error) == null ? void 0 : _a.message) || `API error: ${response.status}`);
            }
            const data = await response.json();
            if (!data.content || !Array.isArray(data.content) || data.content.length === 0) {
              throw new Error("Invalid API response structure");
            }
            const content = data.content[0].text;
            const analysis = this.parseJSONResponse(content);
            return this.validateAnalysis(analysis);
          } catch (error) {
            console.error("Anthropic Analysis error:", error);
            throw error;
          }
        }
      };
      var LLMFreeProvider = class extends LLMProvider {
        constructor(constants) {
          super(constants);
        }
        async analyzeBookmarks(bookmarks) {
          if (!bookmarks || bookmarks.length === 0) {
            throw new Error("No bookmark content to analyze");
          }
          const wordFrequency = {};
          const authorFrequency = {};
          const allText = [];
          bookmarks.forEach((b) => {
            if (b.text) {
              allText.push(b.text.toLowerCase());
              const words = b.text.toLowerCase().replace(/[^\w\s#@]/g, " ").split(/\s+/).filter((w) => w.length > 3 && !this.isStopWord(w));
              words.forEach((word) => {
                wordFrequency[word] = (wordFrequency[word] || 0) + 1;
              });
            }
            if (b.username) {
              authorFrequency[b.username] = (authorFrequency[b.username] || 0) + 1;
            }
          });
          const tags = Object.entries(wordFrequency).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([word]) => word);
          const categories = this.detectCategories(allText.join(" "));
          const topAuthor = Object.entries(authorFrequency).sort((a, b) => b[1] - a[1])[0];
          const summary = `This collection contains ${bookmarks.length} bookmarks. Most frequently bookmarked author: @${topAuthor ? topAuthor[0] : "N/A"}. Common topics include: ${tags.slice(0, 3).join(", ")}.`;
          return {
            overallSummary: summary,
            tags,
            categories,
            timestamp: Date.now()
          };
        }
        isStopWord(word) {
          const stopWords = ["that", "this", "with", "from", "have", "will", "your", "they", "been", "more", "when", "there", "their", "would", "about", "which", "these", "https"];
          return stopWords.includes(word);
        }
        detectCategories(text) {
          const categories = [];
          const lowerText = text.toLowerCase();
          const categoryKeywords = {
            "Technology": ["tech", "software", "code", "programming", "developer", "ai", "data", "cloud", "api"],
            "Business": ["business", "startup", "entrepreneur", "market", "company", "revenue", "growth"],
            "News & Politics": ["news", "political", "government", "election", "policy", "breaking"],
            "Science": ["science", "research", "study", "paper", "scientific", "discovery"],
            "Entertainment": ["movie", "music", "game", "entertainment", "show", "video"],
            "Sports": ["sport", "team", "player", "game", "match", "football", "basketball"],
            "Education": ["learn", "education", "course", "tutorial", "teaching", "university"],
            "Health": ["health", "medical", "wellness", "fitness", "mental", "exercise"]
          };
          for (const [category, keywords] of Object.entries(categoryKeywords)) {
            const matches = keywords.filter((keyword) => lowerText.includes(keyword)).length;
            if (matches >= 2) {
              categories.push(category);
            }
          }
          if (categories.length === 0) {
            categories.push("General");
          }
          return categories.slice(0, 5);
        }
        // ============================================
        // NEW v0.12.0: ENHANCED AUTHORS DASHBOARD
        // ============================================
        getAuthorsDashboardData = () => {
          const authorStats = {};
          const allBookmarks = this.state.lastExtraction || [];
          allBookmarks.forEach((bookmark) => {
            const username = bookmark.username || "unknown";
            if (!authorStats[username]) {
              authorStats[username] = {
                count: 0,
                totalLikes: 0,
                totalRetweets: 0,
                totalReplies: 0,
                totalViews: 0,
                displayName: bookmark.displayName || username,
                bookmarks: [],
                topics: /* @__PURE__ */ new Map()
              };
            }
            authorStats[username].count++;
            authorStats[username].totalLikes += parseInt(bookmark.likes || 0);
            authorStats[username].totalRetweets += parseInt(bookmark.retweets || 0);
            authorStats[username].totalReplies += parseInt(bookmark.replies || 0);
            authorStats[username].totalViews += parseInt(bookmark.views || 0);
            authorStats[username].bookmarks.push(bookmark);
            const topics = this.extractTopicsFromText(bookmark.text);
            topics.forEach((topic) => {
              const current = authorStats[username].topics.get(topic) || 0;
              authorStats[username].topics.set(topic, current + 1);
            });
          });
          return Object.entries(authorStats).map(([username, stats]) => ({
            username,
            ...stats,
            avgLikes: Math.round(stats.totalLikes / stats.count),
            avgRetweets: Math.round(stats.totalRetweets / stats.count),
            avgReplies: Math.round(stats.totalReplies / stats.count),
            avgViews: Math.round(stats.totalViews / stats.count),
            topTopics: Array.from(stats.topics.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([topic]) => topic)
          })).sort((a, b) => b.count - a.count);
        };
        extractTopicsFromText = (text) => {
          if (!text)
            return [];
          const words = text.toLowerCase().replace(/[^\w\s#]/g, " ").split(/\s+/).filter((word) => word.length > 3 && !this.isStopWord(word));
          const hashtags = text.match(/#\w+/g) || [];
          const hashtagWords = hashtags.map((tag) => tag.substring(1).toLowerCase());
          const wordCounts = {};
          [...words, ...hashtagWords].forEach((word) => {
            wordCounts[word] = (wordCounts[word] || 0) + 1;
          });
          return Object.entries(wordCounts).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([word]) => word);
        };
        showAuthorsDashboard = async () => {
          const storage = await chrome.storage.local.get("manualBookmarks");
          const manualBookmarks = storage.manualBookmarks || [];
          const originalExtraction = this.state.lastExtraction;
          this.state.lastExtraction = [
            ...originalExtraction || [],
            ...manualBookmarks
          ];
          const authors = this.getAuthorsDashboardData();
          this.state.lastExtraction = originalExtraction;
          if (authors.length === 0) {
            this.updateStatus("No bookmarks found. Extract bookmarks first.");
            return;
          }
          const dialog = document.createElement("div");
          dialog.setAttribute("role", "dialog");
          dialog.setAttribute("aria-modal", "true");
          dialog.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.8); display: flex;
      align-items: center; justify-content: center; z-index: 1000;
    `;
          const dialogContent = document.createElement("div");
          dialogContent.style.cssText = `
      background: var(--bg-color); padding: 24px; border-radius: 12px;
      max-width: 800px; width: 95%; max-height: 85vh; overflow-y: auto;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
    `;
          const header = document.createElement("div");
          header.style.cssText = "margin-bottom: 20px; border-bottom: 2px solid var(--border-color); padding-bottom: 16px;";
          header.innerHTML = `
      <h2 style="margin: 0 0 8px 0; color: var(--text-color); font-size: 24px;">
        \u{1F465} Authors Dashboard
      </h2>
      <p style="margin: 0; color: var(--disabled-color); font-size: 14px;">
        Discover who you bookmark most and what topics they cover
      </p>
    `;
          dialogContent.appendChild(header);
          const sortControls = document.createElement("div");
          sortControls.style.cssText = "margin-bottom: 20px; display: flex; gap: 8px; flex-wrap: wrap;";
          sortControls.innerHTML = `
      <button class="author-sort-btn" data-sort="count" style="padding: 8px 16px; background: var(--primary-color); color: white; border: none; border-radius: 20px; cursor: pointer; font-size: 13px; font-weight: 600;">
        Most Bookmarks
      </button>
      <button class="author-sort-btn" data-sort="engagement" style="padding: 8px 16px; background: var(--hover-color); color: var(--text-color); border: none; border-radius: 20px; cursor: pointer; font-size: 13px;">
        Highest Engagement
      </button>
      <button class="author-sort-btn" data-sort="recent" style="padding: 8px 16px; background: var(--hover-color); color: var(--text-color); border: none; border-radius: 20px; cursor: pointer; font-size: 13px;">
        Most Recent
      </button>
    `;
          dialogContent.appendChild(sortControls);
          const authorsContainer = document.createElement("div");
          authorsContainer.id = "authors-list-container";
          dialogContent.appendChild(authorsContainer);
          const renderAuthors = (sortBy = "count") => {
            let sortedAuthors = [...authors];
            if (sortBy === "engagement") {
              sortedAuthors.sort((a, b) => b.avgLikes + b.avgRetweets - (a.avgLikes + a.avgRetweets));
            } else if (sortBy === "recent") {
              sortedAuthors.sort((a, b) => {
                const aLatest = Math.max(...a.bookmarks.map((bm) => new Date(bm.dateTime || 0).getTime()));
                const bLatest = Math.max(...b.bookmarks.map((bm) => new Date(bm.dateTime || 0).getTime()));
                return bLatest - aLatest;
              });
            }
            authorsContainer.innerHTML = "";
            sortedAuthors.forEach((author, index) => {
              const item = document.createElement("div");
              item.style.cssText = `
          padding: 16px; margin-bottom: 12px;
          background: var(--hover-color);
          border-radius: 8px;
          border-left: 4px solid var(--primary-color);
          transition: transform 0.2s;
          cursor: pointer;
        `;
              item.addEventListener("mouseenter", () => {
                item.style.transform = "translateX(4px)";
              });
              item.addEventListener("mouseleave", () => {
                item.style.transform = "translateX(0)";
              });
              const headerRow = document.createElement("div");
              headerRow.style.cssText = "display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;";
              const nameSection = document.createElement("div");
              nameSection.innerHTML = `
          <div style="color: var(--text-color); font-weight: 700; font-size: 16px; margin-bottom: 4px;">
            ${index + 1}. ${author.displayName}
          </div>
          <div style="color: var(--disabled-color); font-size: 13px;">
            @${author.username}
          </div>
        `;
              const countBadge = document.createElement("div");
              countBadge.style.cssText = `
          background: var(--primary-color);
          color: white;
          padding: 6px 12px;
          border-radius: 20px;
          font-weight: 700;
          font-size: 14px;
        `;
              countBadge.textContent = `${author.count} bookmarks`;
              headerRow.appendChild(nameSection);
              headerRow.appendChild(countBadge);
              const statsRow = document.createElement("div");
              statsRow.style.cssText = "display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 12px;";
              statsRow.innerHTML = `
          <div style="text-align: center; padding: 8px; background: var(--bg-color); border-radius: 6px;">
            <div style="color: var(--disabled-color); font-size: 11px; margin-bottom: 4px;">AVG LIKES</div>
            <div style="color: var(--text-color); font-weight: 600; font-size: 15px;">${author.avgLikes.toLocaleString()}</div>
          </div>
          <div style="text-align: center; padding: 8px; background: var(--bg-color); border-radius: 6px;">
            <div style="color: var(--disabled-color); font-size: 11px; margin-bottom: 4px;">AVG RTs</div>
            <div style="color: var(--text-color); font-weight: 600; font-size: 15px;">${author.avgRetweets.toLocaleString()}</div>
          </div>
          <div style="text-align: center; padding: 8px; background: var(--bg-color); border-radius: 6px;">
            <div style="color: var(--disabled-color); font-size: 11px; margin-bottom: 4px;">AVG REPLIES</div>
            <div style="color: var(--text-color); font-weight: 600; font-size: 15px;">${author.avgReplies.toLocaleString()}</div>
          </div>
          <div style="text-align: center; padding: 8px; background: var(--bg-color); border-radius: 6px;">
            <div style="color: var(--disabled-color); font-size: 11px; margin-bottom: 4px;">AVG VIEWS</div>
            <div style="color: var(--text-color); font-weight: 600; font-size: 15px;">${author.avgViews.toLocaleString()}</div>
          </div>
        `;
              const topicsRow = document.createElement("div");
              topicsRow.style.cssText = "margin-top: 12px;";
              topicsRow.innerHTML = `
          <div style="color: var(--disabled-color); font-size: 11px; margin-bottom: 6px; font-weight: 600;">TOP TOPICS</div>
          <div style="display: flex; gap: 6px; flex-wrap: wrap;">
            ${author.topTopics.map((topic) => `
              <span style="
                background: var(--primary-color);
                color: white;
                padding: 4px 10px;
                border-radius: 12px;
                font-size: 12px;
                font-weight: 500;
              ">${topic}</span>
            `).join("")}
          </div>
        `;
              item.appendChild(headerRow);
              item.appendChild(statsRow);
              item.appendChild(topicsRow);
              item.addEventListener("click", () => {
                this.state.filterOptions.author = author.username;
                this.applyFilters();
                document.body.removeChild(dialog);
                this.updateStatus(`Filtered by author: @${author.username}`);
              });
              authorsContainer.appendChild(item);
            });
          };
          renderAuthors("count");
          sortControls.querySelectorAll(".author-sort-btn").forEach((btn) => {
            btn.addEventListener("click", (e) => {
              sortControls.querySelectorAll(".author-sort-btn").forEach((b) => {
                b.style.background = "var(--hover-color)";
                b.style.color = "var(--text-color)";
              });
              e.target.style.background = "var(--primary-color)";
              e.target.style.color = "white";
              renderAuthors(e.target.dataset.sort);
            });
          });
          const closeBtn = document.createElement("button");
          closeBtn.textContent = "Close";
          closeBtn.style.cssText = `
      width: 100%; padding: 14px; margin-top: 20px;
      border: 1px solid var(--border-color);
      background: transparent;
      color: var(--text-color);
      border-radius: 8px;
      cursor: pointer;
      font-weight: 600;
      font-size: 14px;
    `;
          closeBtn.addEventListener("click", () => document.body.removeChild(dialog));
          closeBtn.addEventListener("mouseenter", () => {
            closeBtn.style.background = "var(--hover-color)";
          });
          closeBtn.addEventListener("mouseleave", () => {
            closeBtn.style.background = "transparent";
          });
          dialogContent.appendChild(closeBtn);
          dialog.appendChild(dialogContent);
          document.body.appendChild(dialog);
        };
        // ============================================
        // NEW v0.12.0: MEDIA GALLERY VIEW
        // ============================================
        extractMediaFromBookmarks = async () => {
          const storage = await chrome.storage.local.get("manualBookmarks");
          const manualBookmarks = storage.manualBookmarks || [];
          const allBookmarks = [
            ...this.state.lastExtraction || [],
            ...manualBookmarks
          ];
          const mediaBookmarks = [];
          for (const bookmark of allBookmarks) {
            const mediaUrls = this.extractMediaUrls(bookmark.text, bookmark.url);
            if (mediaUrls.length > 0) {
              mediaBookmarks.push({
                ...bookmark,
                mediaUrls,
                mediaTypes: mediaUrls.map((url) => this.getMediaType(url))
              });
            }
          }
          return mediaBookmarks;
        };
        extractMediaUrls = (text, tweetUrl) => {
          const urls = [];
          const imgRegex = /https?:\/\/[^\s]+\.(jpg|jpeg|png|gif|webp)/gi;
          const imgMatches = text.match(imgRegex) || [];
          urls.push(...imgMatches);
          const videoRegex = /https?:\/\/[^\s]+\.(mp4|webm|mov)/gi;
          const videoMatches = text.match(videoRegex) || [];
          urls.push(...videoMatches);
          const twitterMediaRegex = /https?:\/\/pbs\.twimg\.com\/media\/[^\s]+/gi;
          const twitterMediaMatches = text.match(twitterMediaRegex) || [];
          urls.push(...twitterMediaMatches);
          if (tweetUrl && urls.length === 0) {
            urls.push(tweetUrl + "#embed");
          }
          return [...new Set(urls)];
        };
        getMediaType = (url) => {
          if (url.includes("#embed"))
            return "tweet-embed";
          if (url.match(/\.(mp4|webm|mov)$/i))
            return "video";
          if (url.match(/\.(gif)$/i))
            return "gif";
          return "image";
        };
        showMediaGallery = async () => {
          const mediaBookmarks = await this.extractMediaFromBookmarks();
          if (mediaBookmarks.length === 0) {
            this.updateStatus("No media found in bookmarks.");
            return;
          }
          const dialog = document.createElement("div");
          dialog.setAttribute("role", "dialog");
          dialog.setAttribute("aria-modal", "true");
          dialog.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.95); display: flex;
      align-items: center; justify-content: center; z-index: 1000;
    `;
          const dialogContent = document.createElement("div");
          dialogContent.style.cssText = `
      background: var(--bg-color); padding: 24px; border-radius: 12px;
      max-width: 1200px; width: 95%; max-height: 90vh; overflow-y: auto;
    `;
          const header = document.createElement("div");
          header.style.cssText = "margin-bottom: 20px; border-bottom: 2px solid var(--border-color); padding-bottom: 16px;";
          header.innerHTML = `
      <h2 style="margin: 0 0 8px 0; color: var(--text-color); font-size: 24px;">
        \u{1F3A8} Media Gallery
      </h2>
      <p style="margin: 0; color: var(--disabled-color); font-size: 14px;">
        ${mediaBookmarks.length} bookmarks with media \u2022 Click any image to view full size
      </p>
    `;
          dialogContent.appendChild(header);
          const filterControls = document.createElement("div");
          filterControls.style.cssText = "margin-bottom: 20px; display: flex; gap: 8px; flex-wrap: wrap;";
          filterControls.innerHTML = `
      <button class="media-filter-btn" data-filter="all" style="padding: 8px 16px; background: var(--primary-color); color: white; border: none; border-radius: 20px; cursor: pointer; font-size: 13px; font-weight: 600;">
        All Media
      </button>
      <button class="media-filter-btn" data-filter="image" style="padding: 8px 16px; background: var(--hover-color); color: var(--text-color); border: none; border-radius: 20px; cursor: pointer; font-size: 13px;">
        Images Only
      </button>
      <button class="media-filter-btn" data-filter="video" style="padding: 8px 16px; background: var(--hover-color); color: var(--text-color); border: none; border-radius: 20px; cursor: pointer; font-size: 13px;">
        Videos Only
      </button>
      <button class="media-filter-btn" data-filter="gif" style="padding: 8px 16px; background: var(--hover-color); color: var(--text-color); border: none; border-radius: 20px; cursor: pointer; font-size: 13px;">
        GIFs Only
      </button>
    `;
          dialogContent.appendChild(filterControls);
          const galleryGrid = document.createElement("div");
          galleryGrid.id = "media-gallery-grid";
          galleryGrid.style.cssText = `
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
      gap: 16px;
      margin-bottom: 20px;
    `;
          dialogContent.appendChild(galleryGrid);
          const renderGallery = (filter = "all") => {
            galleryGrid.innerHTML = "";
            const filteredBookmarks = filter === "all" ? mediaBookmarks : mediaBookmarks.filter((bm) => bm.mediaTypes.includes(filter));
            filteredBookmarks.forEach((bookmark) => {
              bookmark.mediaUrls.forEach((mediaUrl, idx) => {
                const mediaType = bookmark.mediaTypes[idx];
                if (filter !== "all" && mediaType !== filter)
                  return;
                const card = document.createElement("div");
                card.style.cssText = `
            position: relative;
            background: var(--hover-color);
            border-radius: 8px;
            overflow: hidden;
            cursor: pointer;
            transition: transform 0.2s;
            aspect-ratio: 1;
          `;
                card.addEventListener("mouseenter", () => {
                  card.style.transform = "scale(1.05)";
                });
                card.addEventListener("mouseleave", () => {
                  card.style.transform = "scale(1)";
                });
                if (mediaType === "tweet-embed") {
                  card.innerHTML = `
              <div style="
                width: 100%;
                height: 100%;
                display: flex;
                align-items: center;
                justify-content: center;
                background: linear-gradient(135deg, var(--primary-color), #1a8cd8);
                color: white;
                font-size: 48px;
              ">
                \u{1F426}
              </div>
            `;
                } else if (mediaType === "video" || mediaType === "gif") {
                  card.innerHTML = `
              <div style="
                width: 100%;
                height: 100%;
                display: flex;
                align-items: center;
                justify-content: center;
                background: var(--bg-color);
                color: var(--text-color);
                font-size: 48px;
              ">
                ${mediaType === "video" ? "\u{1F3A5}" : "\u{1F3AC}"}
              </div>
            `;
                } else {
                  card.innerHTML = `
              <img src="${mediaUrl}" alt="Media" style="
                width: 100%;
                height: 100%;
                object-fit: cover;
              " onerror="this.parentElement.innerHTML = '<div style=\\"display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-color);\\">\u274C</div>'">
            `;
                }
                const overlay = document.createElement("div");
                overlay.style.cssText = `
            position: absolute;
            bottom: 0;
            left: 0;
            right: 0;
            background: linear-gradient(to top, rgba(0,0,0,0.8), transparent);
            padding: 12px;
            color: white;
            opacity: 0;
            transition: opacity 0.2s;
          `;
                overlay.innerHTML = `
            <div style="font-size: 12px; font-weight: 600;">@${bookmark.username}</div>
            <div style="font-size: 11px; opacity: 0.8; margin-top: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
              ${bookmark.text.substring(0, 50)}...
            </div>
          `;
                card.addEventListener("mouseenter", () => {
                  overlay.style.opacity = "1";
                });
                card.addEventListener("mouseleave", () => {
                  overlay.style.opacity = "0";
                });
                card.appendChild(overlay);
                card.addEventListener("click", () => {
                  this.showMediaLightbox(mediaUrl, mediaType, bookmark);
                });
                galleryGrid.appendChild(card);
              });
            });
            if (filteredBookmarks.length === 0) {
              galleryGrid.innerHTML = `
          <div style="
            grid-column: 1 / -1;
            text-align: center;
            padding: 40px;
            color: var(--disabled-color);
            font-size: 16px;
          ">
            No ${filter === "all" ? "" : filter + " "}media found
          </div>
        `;
            }
          };
          renderGallery("all");
          filterControls.querySelectorAll(".media-filter-btn").forEach((btn) => {
            btn.addEventListener("click", (e) => {
              filterControls.querySelectorAll(".media-filter-btn").forEach((b) => {
                b.style.background = "var(--hover-color)";
                b.style.color = "var(--text-color)";
              });
              e.target.style.background = "var(--primary-color)";
              e.target.style.color = "white";
              renderGallery(e.target.dataset.filter);
            });
          });
          const closeBtn = document.createElement("button");
          closeBtn.textContent = "Close";
          closeBtn.style.cssText = `
      width: 100%; padding: 14px; margin-top: 20px;
      border: 1px solid var(--border-color);
      background: transparent;
      color: var(--text-color);
      border-radius: 8px;
      cursor: pointer;
      font-weight: 600;
      font-size: 14px;
    `;
          closeBtn.addEventListener("click", () => document.body.removeChild(dialog));
          closeBtn.addEventListener("mouseenter", () => {
            closeBtn.style.background = "var(--hover-color)";
          });
          closeBtn.addEventListener("mouseleave", () => {
            closeBtn.style.background = "transparent";
          });
          dialogContent.appendChild(closeBtn);
          dialog.appendChild(dialogContent);
          document.body.appendChild(dialog);
        };
        showMediaLightbox = (mediaUrl, mediaType, bookmark) => {
          const lightbox = document.createElement("div");
          lightbox.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.95);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 2000;
      padding: 40px;
    `;
          const content = document.createElement("div");
          content.style.cssText = `
      max-width: 90%;
      max-height: 90%;
      position: relative;
    `;
          if (mediaType === "tweet-embed") {
            content.innerHTML = `
        <div style="background: white; padding: 40px; border-radius: 12px; text-align: center;">
          <p style="margin-bottom: 20px; color: #333;">Open tweet to view embedded media</p>
          <a href="${mediaUrl.replace("#embed", "")}" target="_blank" style="
            display: inline-block;
            padding: 12px 24px;
            background: var(--primary-color);
            color: white;
            text-decoration: none;
            border-radius: 20px;
            font-weight: 600;
          ">View Tweet on X</a>
        </div>
      `;
          } else if (mediaType === "video") {
            content.innerHTML = `
        <video src="${mediaUrl}" controls autoplay style="max-width: 100%; max-height: 80vh; border-radius: 8px;">
        </video>
      `;
          } else {
            content.innerHTML = `
        <img src="${mediaUrl}" alt="Media" style="max-width: 100%; max-height: 80vh; border-radius: 8px;">
      `;
          }
          const closeBtn = document.createElement("button");
          closeBtn.textContent = "\u2715";
          closeBtn.style.cssText = `
      position: absolute;
      top: -40px;
      right: 0;
      background: rgba(255, 255, 255, 0.2);
      color: white;
      border: none;
      width: 36px;
      height: 36px;
      border-radius: 50%;
      cursor: pointer;
      font-size: 20px;
      font-weight: bold;
    `;
          closeBtn.addEventListener("click", () => document.body.removeChild(lightbox));
          content.appendChild(closeBtn);
          const info = document.createElement("div");
          info.style.cssText = `
      margin-top: 16px;
      color: white;
      text-align: center;
    `;
          info.innerHTML = `
      <div style="font-weight: 600; margin-bottom: 4px;">@${bookmark.username}</div>
      <div style="font-size: 14px; opacity: 0.8;">${bookmark.text.substring(0, 150)}${bookmark.text.length > 150 ? "..." : ""}</div>
      <a href="${bookmark.url}" target="_blank" style="
        display: inline-block;
        margin-top: 12px;
        padding: 8px 16px;
        background: var(--primary-color);
        color: white;
        text-decoration: none;
        border-radius: 20px;
        font-size: 13px;
        font-weight: 600;
      ">View Tweet</a>
    `;
          content.appendChild(info);
          lightbox.appendChild(content);
          lightbox.addEventListener("click", (e) => {
            if (e.target === lightbox) {
              document.body.removeChild(lightbox);
            }
          });
          document.body.appendChild(lightbox);
        };
        // ============================================
        // NEW v0.12.0: ARTICLE SUMMARIZATION
        // ============================================
        showArticleSummaryDialog = async () => {
          if (this.state.llmProvider === "none") {
            this.updateStatus("Please configure an LLM provider in settings first.");
            this.showSettingsDialog();
            return;
          }
          const storage = await chrome.storage.local.get(["manualBookmarks", "articleSummaries"]);
          const manualBookmarks = storage.manualBookmarks || [];
          const cachedSummaries = storage.articleSummaries || {};
          const allBookmarks = [
            ...this.state.lastExtraction || [],
            ...manualBookmarks
          ];
          const bookmarksWithLinks = allBookmarks.filter((bm) => {
            const urls = this.extractArticleUrls(bm.text);
            return urls.length > 0;
          });
          if (bookmarksWithLinks.length === 0) {
            this.updateStatus("No bookmarks with article links found.");
            return;
          }
          const dialog = document.createElement("div");
          dialog.setAttribute("role", "dialog");
          dialog.setAttribute("aria-modal", "true");
          dialog.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.8); display: flex;
      align-items: center; justify-content: center; z-index: 1000;
    `;
          const dialogContent = document.createElement("div");
          dialogContent.style.cssText = `
      background: var(--bg-color); padding: 24px; border-radius: 12px;
      max-width: 900px; width: 95%; max-height: 85vh; overflow-y: auto;
    `;
          const header = document.createElement("div");
          header.style.cssText = "margin-bottom: 20px; border-bottom: 2px solid var(--border-color); padding-bottom: 16px;";
          header.innerHTML = `
      <h2 style="margin: 0 0 8px 0; color: var(--text-color); font-size: 24px;">
        \u{1F4F0} Article Summaries
      </h2>
      <p style="margin: 0; color: var(--disabled-color); font-size: 14px;">
        ${bookmarksWithLinks.length} bookmarks with article links \u2022 Click "Summarize" to generate AI summary
      </p>
    `;
          dialogContent.appendChild(header);
          const articlesList = document.createElement("div");
          articlesList.id = "articles-list";
          articlesList.style.cssText = "margin-bottom: 20px;";
          bookmarksWithLinks.slice(0, 20).forEach((bookmark, index) => {
            const urls = this.extractArticleUrls(bookmark.text);
            const articleUrl = urls[0];
            const card = document.createElement("div");
            card.style.cssText = `
        padding: 16px;
        margin-bottom: 12px;
        background: var(--hover-color);
        border-radius: 8px;
        border-left: 4px solid var(--primary-color);
      `;
            const cardHeader = document.createElement("div");
            cardHeader.style.cssText = "display: flex; justify-content: space-between; align-items: start; margin-bottom: 12px;";
            const tweetInfo = document.createElement("div");
            tweetInfo.style.cssText = "flex: 1; margin-right: 12px;";
            tweetInfo.innerHTML = `
        <div style="color: var(--text-color); font-weight: 600; margin-bottom: 4px;">
          @${bookmark.username}
        </div>
        <div style="color: var(--disabled-color); font-size: 13px; margin-bottom: 8px;">
          ${bookmark.text.substring(0, 100)}${bookmark.text.length > 100 ? "..." : ""}
        </div>
        <a href="${articleUrl}" target="_blank" style="
          color: var(--primary-color);
          font-size: 12px;
          text-decoration: none;
          word-break: break-all;
        ">${articleUrl.substring(0, 60)}${articleUrl.length > 60 ? "..." : ""}</a>
      `;
            const actionBtn = document.createElement("button");
            actionBtn.className = `summarize-btn-${index}`;
            actionBtn.style.cssText = `
        padding: 8px 16px;
        background: var(--primary-color);
        color: white;
        border: none;
        border-radius: 20px;
        cursor: pointer;
        font-size: 13px;
        font-weight: 600;
        white-space: nowrap;
      `;
            const cacheKey = this.getArticleCacheKey(articleUrl);
            if (cachedSummaries[cacheKey]) {
              actionBtn.textContent = "View Summary";
              actionBtn.style.background = "var(--success-color, #00BA7C)";
            } else {
              actionBtn.textContent = "Summarize";
            }
            cardHeader.appendChild(tweetInfo);
            cardHeader.appendChild(actionBtn);
            card.appendChild(cardHeader);
            const summaryContainer = document.createElement("div");
            summaryContainer.style.cssText = "display: none; margin-top: 12px; padding: 12px; background: var(--bg-color); border-radius: 6px;";
            summaryContainer.id = `summary-${index}`;
            card.appendChild(summaryContainer);
            actionBtn.addEventListener("click", async () => {
              if (cachedSummaries[cacheKey]) {
                this.displaySummary(summaryContainer, cachedSummaries[cacheKey]);
                summaryContainer.style.display = "block";
                actionBtn.textContent = "Hide Summary";
                actionBtn.addEventListener("click", () => {
                  if (summaryContainer.style.display === "none") {
                    summaryContainer.style.display = "block";
                    actionBtn.textContent = "Hide Summary";
                  } else {
                    summaryContainer.style.display = "none";
                    actionBtn.textContent = "View Summary";
                  }
                }, { once: true });
              } else {
                actionBtn.textContent = "Summarizing...";
                actionBtn.disabled = true;
                actionBtn.style.opacity = "0.6";
                try {
                  const summary = await this.summarizeArticle(articleUrl);
                  cachedSummaries[cacheKey] = summary;
                  await chrome.storage.local.set({ articleSummaries: cachedSummaries });
                  this.displaySummary(summaryContainer, summary);
                  summaryContainer.style.display = "block";
                  actionBtn.textContent = "Hide Summary";
                  actionBtn.disabled = false;
                  actionBtn.style.opacity = "1";
                  actionBtn.style.background = "var(--success-color, #00BA7C)";
                } catch (error) {
                  summaryContainer.innerHTML = `
              <div style="color: var(--danger-color, #F4212E); font-size: 14px;">
                \u274C Error: ${error.message}
              </div>
            `;
                  summaryContainer.style.display = "block";
                  actionBtn.textContent = "Retry";
                  actionBtn.disabled = false;
                  actionBtn.style.opacity = "1";
                }
              }
            });
            articlesList.appendChild(card);
          });
          dialogContent.appendChild(articlesList);
          const closeBtn = document.createElement("button");
          closeBtn.textContent = "Close";
          closeBtn.style.cssText = `
      width: 100%; padding: 14px;
      border: 1px solid var(--border-color);
      background: transparent;
      color: var(--text-color);
      border-radius: 8px;
      cursor: pointer;
      font-weight: 600;
      font-size: 14px;
    `;
          closeBtn.addEventListener("click", () => document.body.removeChild(dialog));
          dialogContent.appendChild(closeBtn);
          dialog.appendChild(dialogContent);
          document.body.appendChild(dialog);
        };
        extractArticleUrls = (text) => {
          const urlRegex = /https?:\/\/[^\s]+/g;
          const urls = text.match(urlRegex) || [];
          return urls.filter((url) => {
            const lowerUrl = url.toLowerCase();
            return !lowerUrl.includes("twitter.com") && !lowerUrl.includes("x.com") && !lowerUrl.includes("pbs.twimg.com") && !lowerUrl.match(/\.(jpg|jpeg|png|gif|webp|mp4|webm|mov)$/i);
          });
        };
        getArticleCacheKey = (url) => {
          return btoa(url).substring(0, 50);
        };
        summarizeArticle = async (articleUrl) => {
          var _a;
          this.updateStatus("Fetching article content...");
          const jinaUrl = `https://r.jina.ai/${articleUrl}`;
          const jinaResponse = await fetch(jinaUrl, {
            headers: {
              "Accept": "application/json",
              "X-Return-Format": "markdown"
            }
          });
          if (!jinaResponse.ok) {
            throw new Error("Failed to fetch article content");
          }
          const jinaData = await jinaResponse.json();
          const articleText = ((_a = jinaData.data) == null ? void 0 : _a.content) || jinaData.content || "";
          if (!articleText || articleText.length < 100) {
            throw new Error("Article content too short or empty");
          }
          const truncatedText = articleText.substring(0, 4e3);
          this.updateStatus("Generating summary with AI...");
          const prompt2 = `Please provide a concise summary of the following article in 3-5 bullet points. Focus on the key takeaways and main arguments.

Article:
${truncatedText}

Summary (3-5 bullet points):`;
          let summary;
          if (this.state.llmProvider === "openai") {
            const response = await fetch("https://api.openai.com/v1/chat/completions", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${this.state.apiKey}`
              },
              body: JSON.stringify({
                model: "gpt-3.5-turbo",
                messages: [
                  { role: "system", content: "You are a helpful assistant that summarizes articles concisely." },
                  { role: "user", content: prompt2 }
                ],
                max_tokens: 300,
                temperature: 0.5
              })
            });
            if (!response.ok) {
              throw new Error("OpenAI API request failed");
            }
            const data = await response.json();
            summary = data.choices[0].message.content;
          } else if (this.state.llmProvider === "anthropic") {
            const response = await fetch("https://api.anthropic.com/v1/messages", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-api-key": this.state.apiKey,
                "anthropic-version": "2023-06-01"
              },
              body: JSON.stringify({
                model: "claude-3-5-sonnet-20241022",
                max_tokens: 300,
                messages: [
                  { role: "user", content: prompt2 }
                ]
              })
            });
            if (!response.ok) {
              throw new Error("Anthropic API request failed");
            }
            const data = await response.json();
            summary = data.content[0].text;
          } else {
            summary = this.extractKeySentences(truncatedText, 5);
          }
          this.updateStatus("Summary generated successfully!");
          return {
            summary,
            url: articleUrl,
            timestamp: Date.now(),
            provider: this.state.llmProvider
          };
        };
        extractKeySentences = (text, count = 5) => {
          const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 20);
          const scoredSentences = sentences.map((sentence, index) => ({
            text: sentence.trim(),
            score: sentence.length + (index < 5 ? 50 : 0)
            // Boost early sentences
          }));
          const topSentences = scoredSentences.sort((a, b) => b.score - a.score).slice(0, count).map((s) => "\u2022 " + s.text);
          return topSentences.join("\n");
        };
        displaySummary = (container, summaryData) => {
          const timeAgo = this.getTimeAgo(summaryData.timestamp);
          container.innerHTML = `
      <div style="margin-bottom: 8px; color: var(--disabled-color); font-size: 12px;">
        Generated ${timeAgo} \u2022 Provider: ${summaryData.provider || "local"}
      </div>
      <div style="color: var(--text-color); font-size: 14px; line-height: 1.6; white-space: pre-wrap;">
        ${summaryData.summary}
      </div>
      <a href="${summaryData.url}" target="_blank" style="
        display: inline-block;
        margin-top: 12px;
        padding: 6px 12px;
        background: var(--primary-color);
        color: white;
        text-decoration: none;
        border-radius: 16px;
        font-size: 12px;
        font-weight: 600;
      ">Read Full Article \u2192</a>
    `;
        };
        getTimeAgo = (timestamp) => {
          const seconds = Math.floor((Date.now() - timestamp) / 1e3);
          if (seconds < 60)
            return "just now";
          if (seconds < 3600)
            return `${Math.floor(seconds / 60)} minutes ago`;
          if (seconds < 86400)
            return `${Math.floor(seconds / 3600)} hours ago`;
          return `${Math.floor(seconds / 86400)} days ago`;
        };
        // ── Tier UI ────────────────────────────────────────────────────────────────
        updateTierUI = async () => {
          const status = await this.tierManager.getStatus();
          const isPro = status.valid === true && status.tier === "pro";
          let remaining;
          if (isPro) {
            remaining = typeof status.remainingToday === "number" ? status.remainingToday : status.dailyLimit || 50;
          } else {
            const used = await this.tierManager.getLocalUsageCount();
            remaining = Math.max(0, 50 - used);
          }
          const bookmarkLimit = isPro ? this.tierManager.PRO_BOOKMARK_LIMIT : this.tierManager.FREE_BOOKMARK_LIMIT;
          if (this.elements.tierBadge) {
            this.elements.tierBadge.textContent = isPro ? "Pro" : "Free";
            this.elements.tierBadge.className = `tier-badge ${isPro ? "tier-pro" : "tier-free"}`;
          }
          if (this.elements.rateLimitText) {
            this.elements.rateLimitText.textContent = `${remaining} of 50 analyses remaining today`;
          }
          if (this.elements.kbBtnSubtitle) {
            const modelLabel = isPro ? "Gemini 2.5 Pro" : "Gemini 2.0 Flash";
            this.elements.kbBtnSubtitle.textContent = `Analyzes ${bookmarkLimit} bookmarks \xB7 ${modelLabel}`;
          }
          if (this.elements.subTierDisplay) {
            this.elements.subTierDisplay.textContent = isPro ? "Pro \u2713" : "Free";
          }
          if (this.elements.subscriptionStatus) {
            this.elements.subscriptionStatus.className = `subscription-status ${isPro ? "pro" : "free"}`;
          }
          if (this.elements.subDescription) {
            if (isPro && status.expiresAt) {
              const expDate = new Date(status.expiresAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
              this.elements.subDescription.textContent = `Pro plan \u2013 Gemini 2.5 Pro, ${bookmarkLimit} bookmarks/export. ${remaining}/50 analyses remaining today. Renews ${expDate}.`;
            } else {
              this.elements.subDescription.textContent = `Free plan \u2013 analyzes your 3 most recent bookmarks with Gemini 2.0 Flash using your own API key.`;
            }
          }
          if (this.elements.deactivateLicenseBtn) {
            this.elements.deactivateLicenseBtn.style.display = isPro ? "inline-block" : "none";
          }
          if (this.elements.bmcUpgradeBox) {
            this.elements.bmcUpgradeBox.style.display = isPro ? "none" : "block";
          }
          this.updateExportButtons();
        };
        // ── License activation ─────────────────────────────────────────────────────
        handleActivateLicense = async () => {
          var _a, _b;
          const rawToken = (_b = (_a = this.elements.licenseKeyInput) == null ? void 0 : _a.value) == null ? void 0 : _b.trim();
          if (!rawToken) {
            this.showLicenseMsg("Please enter your activation token.", "error");
            return;
          }
          if (this.elements.activateLicenseBtn) {
            this.elements.activateLicenseBtn.disabled = true;
            this.elements.activateLicenseBtn.classList.add("verifying");
            this.elements.activateLicenseBtn.textContent = "Verifying\u2026";
          }
          this.showLicenseMsg("Contacting verification server\u2026", "");
          const result = await this.tierManager.activateToken(rawToken);
          if (this.elements.activateLicenseBtn) {
            this.elements.activateLicenseBtn.disabled = false;
            this.elements.activateLicenseBtn.classList.remove("verifying");
            this.elements.activateLicenseBtn.textContent = "Verify & Activate";
          }
          this.showLicenseMsg(result.message, result.success ? "success" : "error");
          if (result.success) {
            if (this.elements.licenseKeyInput)
              this.elements.licenseKeyInput.value = "";
            await this.updateTierUI();
          }
        };
        handleDeactivateLicense = async () => {
          await this.tierManager.deactivate();
          this.showLicenseMsg("Token removed. Reverted to Free plan.", "");
          await this.updateTierUI();
        };
        showLicenseMsg = (msg, type) => {
          if (!this.elements.licenseMsg)
            return;
          this.elements.licenseMsg.textContent = msg;
          this.elements.licenseMsg.className = `settings-hint${type ? " " + type : ""}`;
        };
        // ── Knowledge Base export ──────────────────────────────────────────────────
        exportKnowledgeBase = async () => {
          const bookmarks = this.state.lastExtraction;
          if (!bookmarks || bookmarks.length === 0) {
            this.updateStatus("No bookmarks to export.");
            return;
          }
          const isPro = await this.tierManager.isProUser();
          if (!isPro && (this.state.llmProvider !== "gemini" || !this.state.apiKey)) {
            this.updateStatus("Free plan: select Gemini as provider and add your Gemini API key in Settings.");
            return;
          }
          if (!isPro) {
            const { allowed, reason } = await this.tierManager.canAnalyzeFree();
            if (!allowed) {
              this.updateStatus(reason);
              this.showToast(reason, "warning");
              return;
            }
          }
          const bookmarkLimit = await this.tierManager.getBookmarkLimit();
          const toProcess = bookmarks.slice(0, bookmarkLimit);
          if (this.elements.exportKbBtn)
            this.elements.exportKbBtn.disabled = true;
          if (this.elements.kbProgress)
            this.elements.kbProgress.style.display = "block";
          const setKbProgress = (pct, text) => {
            if (this.elements.kbProgressFill)
              this.elements.kbProgressFill.style.width = `${pct}%`;
            if (this.elements.kbProgressText)
              this.elements.kbProgressText.textContent = text;
          };
          setKbProgress(5, "Initializing\u2026");
          this.updateStatus(`Exporting Knowledge Base (${toProcess.length} bookmarks)\u2026`);
          try {
            const gemini = await this.createGeminiProvider();
            setKbProgress(10, "Generating collection overview\u2026");
            let aiAnalysis = this.state.aiAnalysis;
            if (!aiAnalysis) {
              try {
                aiAnalysis = await gemini.analyzeBookmarks(toProcess);
                this.state.aiAnalysis = aiAnalysis;
              } catch (e) {
                console.warn("Collection analysis failed, continuing without it:", e.message);
              }
            }
            const deepAnalyses = [];
            const imageTextsPerBookmark = [];
            const totalSteps = toProcess.length;
            for (let i = 0; i < toProcess.length; i++) {
              const bookmark = toProcess[i];
              const pct = 10 + Math.round((i + 1) / totalSteps * 80);
              setKbProgress(pct, `Analyzing bookmark ${i + 1} of ${totalSteps}\u2026`);
              let imageTexts = [];
              if (bookmark.media && bookmark.media.some((m) => m.type !== "video")) {
                try {
                  imageTexts = await gemini.extractBookmarkImageTexts(bookmark);
                } catch (e) {
                  console.warn("Image extraction failed for bookmark", i, ":", e.message);
                }
              }
              imageTextsPerBookmark.push(imageTexts);
              let deepAnalysis = null;
              try {
                deepAnalysis = await gemini.analyzeBookmark(bookmark, imageTexts);
              } catch (e) {
                console.warn("Deep analysis failed for bookmark", i, ":", e.message);
              }
              deepAnalyses.push(deepAnalysis);
              if (!isPro) {
                await this.tierManager.incrementLocalUsage(1);
              }
            }
            setKbProgress(95, "Generating Markdown\u2026");
            const getCustomTags = (url) => {
              var _a;
              const meta = (_a = this.state.bookmarkMetadata) == null ? void 0 : _a[url];
              return (meta == null ? void 0 : meta.customTags) || [];
            };
            downloadKnowledgeBase(toProcess, {
              aiAnalysis,
              deepAnalyses,
              imageTextsPerBookmark,
              getCustomTags
            });
            setKbProgress(100, "Done!");
            this.updateStatus(`Knowledge Base exported with ${toProcess.length} bookmarks.`);
            if (!isPro && bookmarks.length > bookmarkLimit) {
              this.showToast(
                `Free plan: exported ${bookmarkLimit} of ${bookmarks.length} bookmarks. Upgrade to Pro for up to 50.`,
                "info"
              );
            }
            await this.updateTierUI();
          } catch (error) {
            console.error("Knowledge Base export error:", error);
            this.updateStatus(`Export failed: ${error.message}`);
            this.showToast(`Export failed: ${error.message}`, "error");
          } finally {
            if (this.elements.exportKbBtn)
              this.elements.exportKbBtn.disabled = false;
            setTimeout(() => {
              if (this.elements.kbProgress)
                this.elements.kbProgress.style.display = "none";
            }, 2e3);
          }
        };
      };
      document.addEventListener("DOMContentLoaded", () => {
        new PopupController();
      });
      if (typeof module !== "undefined" && module.exports) {
        module.exports = { PopupController, GeminiProviderClass, LLMProvider, OpenAIProvider, AnthropicProvider, LLMFreeProvider };
      }
    }
  });
  require_popup();
})();
//# sourceMappingURL=popup.js.map
