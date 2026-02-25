(() => {
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __commonJS = (cb, mod) => function __require() {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  };

  // src/core/contracts/messages.js
  var require_messages = __commonJS({
    "src/core/contracts/messages.js"(exports, module) {
      var EXTRACTION_SCOPES = ["bookmarks", "likes"];
      var QUERY_SCOPES = ["bookmarks", "likes", "all"];
      var EXTRACTION_MODES = ["full", "visible"];
      var MESSAGE_TYPES = {
        EXTRACTION_START: "EXTRACTION_START",
        EXTRACTION_PROGRESS: "EXTRACTION_PROGRESS",
        EXTRACTION_COMPLETE: "EXTRACTION_COMPLETE",
        EXTRACTION_ERROR: "EXTRACTION_ERROR",
        EXTRACTION_CANCEL: "EXTRACTION_CANCEL",
        DATA_QUERY: "DATA_QUERY",
        XA_START_EXTRACTION: "XA_START_EXTRACTION",
        XA_GET_SETTINGS: "XA_GET_SETTINGS",
        XA_SAVE_SETTINGS: "XA_SAVE_SETTINGS"
      };
      function isPlainObject(value) {
        return !!value && typeof value === "object" && !Array.isArray(value);
      }
      function validateExtractionStart(payload) {
        if (!isPlainObject(payload)) {
          return { valid: false, error: "Payload must be an object" };
        }
        if (!EXTRACTION_SCOPES.includes(payload.scope)) {
          return { valid: false, error: "scope must be bookmarks or likes" };
        }
        const mode = payload.mode || "full";
        if (!EXTRACTION_MODES.includes(mode)) {
          return { valid: false, error: "mode must be full or visible" };
        }
        return {
          valid: true,
          value: {
            scope: payload.scope,
            mode,
            runId: typeof payload.runId === "string" ? payload.runId : `run-${Date.now()}`
          }
        };
      }
      function validateDataQuery(payload) {
        if (!isPlainObject(payload)) {
          return { valid: false, error: "Payload must be an object" };
        }
        const scope = payload.scope || "all";
        if (!QUERY_SCOPES.includes(scope)) {
          return { valid: false, error: "scope must be bookmarks, likes, or all" };
        }
        const filter = isPlainObject(payload.filter) ? payload.filter : {};
        const sort = typeof payload.sort === "string" ? payload.sort : "capturedAt:desc";
        const page = isPlainObject(payload.page) ? payload.page : {};
        const offset = Number.isInteger(page.offset) && page.offset >= 0 ? page.offset : 0;
        const limit = Number.isInteger(page.limit) && page.limit > 0 ? page.limit : 5e3;
        return {
          valid: true,
          value: {
            scope,
            filter,
            sort,
            page: { offset, limit }
          }
        };
      }
      module.exports = {
        MESSAGE_TYPES,
        EXTRACTION_SCOPES,
        QUERY_SCOPES,
        EXTRACTION_MODES,
        validateExtractionStart,
        validateDataQuery,
        isPlainObject
      };
    }
  });

  // src/extraction/route-detector.js
  var require_route_detector = __commonJS({
    "src/extraction/route-detector.js"(exports, module) {
      function detectScopeFromUrl(url = "") {
        const normalized = String(url).toLowerCase();
        if (normalized.includes("/i/bookmarks")) {
          return "bookmarks";
        }
        if (/\/[^/]+\/likes(?:\?|$|\/)/.test(normalized)) {
          return "likes";
        }
        return "unknown";
      }
      function scopeToRecordScope(scope) {
        return scope === "likes" ? "like" : "bookmark";
      }
      function getScopeUrl(scope, username = "") {
        if (scope === "bookmarks") {
          return "https://x.com/i/bookmarks";
        }
        if (!username) {
          throw new Error("Username is required for likes extraction");
        }
        return `https://x.com/${username}/likes`;
      }
      function endpointScopeHint(url = "") {
        const lower = String(url).toLowerCase();
        if (lower.includes("bookmarks"))
          return "bookmarks";
        if (lower.includes("likes"))
          return "likes";
        return "unknown";
      }
      module.exports = {
        detectScopeFromUrl,
        scopeToRecordScope,
        getScopeUrl,
        endpointScopeHint
      };
    }
  });

  // src/extraction/parser-dom.js
  var require_parser_dom = __commonJS({
    "src/extraction/parser-dom.js"(exports, module) {
      function parseCount(text) {
        if (!text)
          return null;
        const match = String(text).trim().match(/([\d,.]+)\s*([KMBkmb])?/);
        if (!match)
          return null;
        const value = Number(match[1].replace(/,/g, ""));
        if (!Number.isFinite(value))
          return null;
        const suffix = match[2] ? match[2].toUpperCase() : null;
        const multiplier = suffix === "K" ? 1e3 : suffix === "M" ? 1e6 : suffix === "B" ? 1e9 : 1;
        return Math.round(value * multiplier);
      }
      function extractDomMedia(article) {
        const media = [];
        const images = article.querySelectorAll('img[src*="twimg.com/media"]');
        images.forEach((img) => {
          if (img.src) {
            media.push({ type: "photo", url: img.src });
          }
        });
        const videos = article.querySelectorAll("video");
        videos.forEach((video) => {
          const source = video.querySelector("source");
          const url = source?.src || video.src;
          if (url) {
            media.push({ type: "video", url });
          }
        });
        return media;
      }
      function parseArticle(article, scope, route) {
        const link = article.querySelector('a[href*="/status/"]');
        const url = link?.href || "";
        if (!url)
          return null;
        const idMatch = url.match(/\/status\/(\d+)/);
        const id = idMatch ? idMatch[1] : "";
        let username = "";
        let displayName = "";
        const spans = article.querySelectorAll("span");
        for (const span of spans) {
          const content = span.textContent?.trim() || "";
          if (!username && content.startsWith("@")) {
            username = content.slice(1);
          } else if (!displayName && content && !content.startsWith("@")) {
            displayName = content;
          }
        }
        if (!username) {
          const match = url.match(/x\.com\/([^/]+)\/status/);
          username = match ? match[1] : "";
        }
        const text = Array.from(article.querySelectorAll('[data-testid="tweetText"]')).map((node) => node.textContent?.trim() || "").filter(Boolean).join(" ");
        const timeNode = article.querySelector("time");
        const tweetPostedAt = timeNode?.getAttribute("datetime") || null;
        const likes = parseCount(article.querySelector('[data-testid="like"]')?.textContent || "");
        const retweets = parseCount(article.querySelector('[data-testid="retweet"]')?.textContent || "");
        const replies = parseCount(article.querySelector('[data-testid="reply"]')?.textContent || "");
        let views = null;
        const viewNode = Array.from(article.querySelectorAll('a[aria-label*="View"], span[aria-label*="View"]')).find((node) => {
          return /view/i.test(node.getAttribute("aria-label") || "");
        });
        if (viewNode) {
          views = parseCount(viewNode.getAttribute("aria-label") || "");
        }
        return {
          id,
          url,
          scope: scope === "likes" ? "like" : "bookmark",
          capturedAt: (/* @__PURE__ */ new Date()).toISOString(),
          tweetPostedAt,
          author: {
            username,
            displayName
          },
          text,
          media: extractDomMedia(article),
          metrics: {
            likes,
            retweets,
            replies,
            views
          },
          source: {
            route,
            via: "dom"
          }
        };
      }
      function parseVisibleArticles(scope, route) {
        const articles = Array.from(document.querySelectorAll("article"));
        const parsed = [];
        for (const article of articles) {
          const item = parseArticle(article, scope, route);
          if (item)
            parsed.push(item);
        }
        return {
          scannedCount: articles.length,
          records: parsed
        };
      }
      module.exports = {
        parseVisibleArticles,
        parseArticle,
        parseCount,
        extractDomMedia
      };
    }
  });

  // src/core/contracts/record.js
  var require_record = __commonJS({
    "src/core/contracts/record.js"(exports, module) {
      var VALID_SCOPE_VALUES = ["bookmark", "like"];
      var VALID_MEDIA_TYPES = ["photo", "video", "gif"];
      function toNullableNumber(value) {
        if (value === null || value === void 0 || value === "") {
          return null;
        }
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
      }
      function normalizeMediaType(value) {
        if (value === "animated_gif")
          return "gif";
        if (value === "photo" || value === "video" || value === "gif")
          return value;
        return "photo";
      }
      function extractTweetIdFromUrl(url) {
        if (typeof url !== "string")
          return null;
        const match = url.match(/\/status\/(\d+)/);
        return match ? match[1] : null;
      }
      function buildRecordId(raw) {
        if (raw.id && typeof raw.id === "string")
          return raw.id;
        const idFromUrl = extractTweetIdFromUrl(raw.url);
        if (idFromUrl)
          return idFromUrl;
        const text = `${raw.url || ""}|${raw.text || ""}|${raw.author?.username || ""}`;
        let hash = 0;
        for (let i = 0; i < text.length; i += 1) {
          hash = (hash << 5) - hash + text.charCodeAt(i) | 0;
        }
        return `fallback-${Math.abs(hash)}`;
      }
      function normalizeTweetRecord(raw) {
        const scope = raw.scope === "likes" || raw.scope === "like" ? "like" : "bookmark";
        const author = raw.author || {};
        const media = Array.isArray(raw.media) ? raw.media : [];
        const metrics = raw.metrics || {};
        return {
          id: buildRecordId(raw),
          url: typeof raw.url === "string" ? raw.url : "",
          scope,
          capturedAt: raw.capturedAt || (/* @__PURE__ */ new Date()).toISOString(),
          tweetPostedAt: raw.tweetPostedAt || null,
          author: {
            username: typeof author.username === "string" ? author.username : "",
            displayName: typeof author.displayName === "string" ? author.displayName : "",
            userId: typeof author.userId === "string" ? author.userId : void 0
          },
          text: typeof raw.text === "string" ? raw.text : "",
          media: media.filter((item) => item && typeof item.url === "string" && item.url).map((item) => ({
            type: normalizeMediaType(item.type),
            url: item.url,
            previewUrl: typeof item.previewUrl === "string" ? item.previewUrl : void 0,
            durationMs: toNullableNumber(item.durationMs)
          })),
          metrics: {
            likes: toNullableNumber(metrics.likes),
            retweets: toNullableNumber(metrics.retweets),
            replies: toNullableNumber(metrics.replies),
            views: toNullableNumber(metrics.views)
          },
          source: {
            route: typeof raw.source?.route === "string" ? raw.source.route : "",
            via: raw.source?.via === "network" ? "network" : "dom"
          },
          ai: raw.ai && typeof raw.ai === "object" ? {
            categories: Array.isArray(raw.ai.categories) ? raw.ai.categories.filter(Boolean) : [],
            tags: Array.isArray(raw.ai.tags) ? raw.ai.tags.filter(Boolean) : [],
            confidence: typeof raw.ai.confidence === "number" ? raw.ai.confidence : 0,
            rationale: typeof raw.ai.rationale === "string" ? raw.ai.rationale : ""
          } : void 0
        };
      }
      function validateTweetRecordV2(record) {
        if (!record || typeof record !== "object") {
          return { valid: false, error: "Record must be an object" };
        }
        if (!record.id || typeof record.id !== "string") {
          return { valid: false, error: "Record id is required" };
        }
        if (!record.url || typeof record.url !== "string") {
          return { valid: false, error: "Record url is required" };
        }
        if (!VALID_SCOPE_VALUES.includes(record.scope)) {
          return { valid: false, error: "Record scope must be bookmark or like" };
        }
        if (!record.author || typeof record.author !== "object") {
          return { valid: false, error: "Record author is required" };
        }
        if (!Array.isArray(record.media)) {
          return { valid: false, error: "Record media must be an array" };
        }
        if (record.media.some((item) => !VALID_MEDIA_TYPES.includes(item.type))) {
          return { valid: false, error: "Record media type is invalid" };
        }
        return { valid: true, value: record };
      }
      module.exports = {
        VALID_SCOPE_VALUES,
        VALID_MEDIA_TYPES,
        extractTweetIdFromUrl,
        normalizeTweetRecord,
        validateTweetRecordV2,
        normalizeMediaType,
        toNullableNumber
      };
    }
  });

  // src/extraction/normalizer.js
  var require_normalizer = __commonJS({
    "src/extraction/normalizer.js"(exports, module) {
      var { normalizeTweetRecord } = require_record();
      var { scopeToRecordScope } = require_route_detector();
      function normalizeExtractedTweet(rawTweet, scope, sourceMeta = {}) {
        return normalizeTweetRecord({
          ...rawTweet,
          scope: scopeToRecordScope(scope),
          source: {
            route: sourceMeta.route || "",
            via: sourceMeta.via || "dom"
          }
        });
      }
      function dedupeRecords(records) {
        const byId = /* @__PURE__ */ new Map();
        for (const record of records) {
          byId.set(record.id, record);
        }
        return Array.from(byId.values());
      }
      module.exports = {
        normalizeExtractedTweet,
        dedupeRecords
      };
    }
  });

  // src/extraction/engine.js
  var require_engine = __commonJS({
    "src/extraction/engine.js"(exports, module) {
      var { detectScopeFromUrl } = require_route_detector();
      var { parseVisibleArticles } = require_parser_dom();
      var { normalizeExtractedTweet, dedupeRecords } = require_normalizer();
      function wait(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
      }
      var ExtractionEngine = class {
        constructor(options = {}) {
          this.scrollDelay = options.scrollDelay || 1200;
          this.maxLoops = options.maxLoops || 80;
          this.stableLoops = options.stableLoops || 3;
        }
        collectOnce(scope, route, networkRecords = []) {
          const domSnapshot = parseVisibleArticles(scope, route);
          const all = [
            ...domSnapshot.records.map((record) => normalizeExtractedTweet(record, scope, { route, via: "dom" })),
            ...networkRecords.filter((record) => {
              return scope === "bookmarks" ? record.scope === "bookmark" : record.scope === "like";
            }).map((record) => normalizeExtractedTweet(record, scope, { route, via: "network" }))
          ];
          return {
            scannedCount: domSnapshot.scannedCount,
            records: dedupeRecords(all)
          };
        }
        async extract({ scope, mode, runId, getNetworkRecords, onProgress, isCancelled }) {
          const startedAt = Date.now();
          const route = window.location.pathname;
          const detectedScope = detectScopeFromUrl(window.location.href);
          if (detectedScope !== scope) {
            const error = new Error(`Route mismatch: expected ${scope}, got ${detectedScope}`);
            error.code = "ROUTE_MISMATCH";
            throw error;
          }
          let merged = /* @__PURE__ */ new Map();
          let scannedCount = 0;
          const pushRecords = (records2) => {
            for (const record of records2) {
              merged.set(record.id, record);
            }
          };
          const runCollect = () => {
            const snapshot = this.collectOnce(scope, route, getNetworkRecords());
            scannedCount += snapshot.scannedCount;
            pushRecords(snapshot.records);
            return snapshot;
          };
          runCollect();
          if (mode === "full") {
            let lastHeight = 0;
            let stableCount = 0;
            let loop = 0;
            while (loop < this.maxLoops && stableCount < this.stableLoops) {
              if (isCancelled()) {
                const error = new Error("Extraction cancelled");
                error.code = "CANCELLED";
                throw error;
              }
              window.scrollTo(0, document.body.scrollHeight);
              await wait(this.scrollDelay);
              const newHeight = document.body.scrollHeight;
              if (newHeight === lastHeight) {
                stableCount += 1;
              } else {
                stableCount = 0;
              }
              lastHeight = newHeight;
              const snapshot = runCollect();
              if (typeof onProgress === "function") {
                onProgress({
                  type: "EXTRACTION_PROGRESS",
                  runId,
                  scope,
                  scannedCount,
                  capturedCount: merged.size,
                  cursorState: {
                    loop,
                    stableCount
                  },
                  status: `Scanning ${scope}...`
                });
              }
              if (snapshot.records.length === 0 && stableCount >= this.stableLoops) {
                break;
              }
              loop += 1;
            }
          }
          const records = Array.from(merged.values());
          return {
            runId,
            scope,
            route,
            scannedCount,
            records,
            totalCount: records.length,
            durationMs: Date.now() - startedAt
          };
        }
      };
      module.exports = {
        ExtractionEngine
      };
    }
  });

  // src/extraction/parser-network.js
  var require_parser_network = __commonJS({
    "src/extraction/parser-network.js"(exports, module) {
      var { endpointScopeHint } = require_route_detector();
      function collectTweetResultNodes(node, output, visited = /* @__PURE__ */ new WeakSet()) {
        if (!node || typeof node !== "object")
          return;
        if (visited.has(node))
          return;
        visited.add(node);
        if (node.legacy && node.core && node.core.user_results) {
          output.push(node);
        }
        if (node.tweet_results && node.tweet_results.result) {
          collectTweetResultNodes(node.tweet_results.result, output, visited);
        }
        for (const value of Object.values(node)) {
          if (value && typeof value === "object") {
            collectTweetResultNodes(value, output, visited);
          }
        }
      }
      function selectBestVideoVariant(variants) {
        if (!Array.isArray(variants))
          return null;
        const mp4s = variants.filter((item) => item && item.content_type === "video/mp4" && item.url).sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
        return mp4s.length > 0 ? mp4s[0] : null;
      }
      function parseNetworkMedia(legacy = {}) {
        const mediaEntities = legacy.extended_entities?.media || legacy.entities?.media || [];
        return mediaEntities.map((item) => {
          const type = item.type === "animated_gif" ? "gif" : item.type || "photo";
          if (type === "video" || type === "gif") {
            const bestVariant = selectBestVideoVariant(item.video_info?.variants || []);
            return {
              type,
              url: bestVariant?.url || item.media_url_https || "",
              previewUrl: item.media_url_https || void 0,
              durationMs: item.video_info?.duration_millis || null
            };
          }
          return {
            type: "photo",
            url: item.media_url_https || item.media_url || ""
          };
        }).filter((item) => item.url);
      }
      function parseTweetResult(resultNode, scopeHint, route) {
        const legacy = resultNode.legacy;
        const core = resultNode.core?.user_results?.result?.legacy;
        if (!legacy || !core) {
          return null;
        }
        const id = legacy.id_str || resultNode.rest_id;
        const username = core.screen_name || "";
        const noteText = resultNode.note_tweet?.note_tweet_results?.result?.text;
        const text = noteText || legacy.full_text || "";
        return {
          id,
          url: id && username ? `https://x.com/${username}/status/${id}` : "",
          scope: scopeHint === "likes" ? "like" : "bookmark",
          capturedAt: (/* @__PURE__ */ new Date()).toISOString(),
          tweetPostedAt: legacy.created_at ? new Date(legacy.created_at).toISOString() : null,
          author: {
            username,
            displayName: core.name || "",
            userId: core.id_str || void 0
          },
          text,
          media: parseNetworkMedia(legacy),
          metrics: {
            likes: legacy.favorite_count,
            retweets: legacy.retweet_count,
            replies: legacy.reply_count,
            views: resultNode.views?.count || null
          },
          source: {
            route,
            via: "network"
          }
        };
      }
      function parseNetworkPayload(payload, endpointUrl = "") {
        const nodes = [];
        collectTweetResultNodes(payload, nodes);
        const scopeHint = endpointScopeHint(endpointUrl);
        const route = scopeHint === "likes" ? "/likes" : "/i/bookmarks";
        return nodes.map((node) => parseTweetResult(node, scopeHint, route)).filter((item) => item && item.url);
      }
      module.exports = {
        parseNetworkPayload,
        parseNetworkMedia,
        collectTweetResultNodes
      };
    }
  });

  // src/extraction/bounded-cache.js
  var require_bounded_cache = __commonJS({
    "src/extraction/bounded-cache.js"(exports, module) {
      var BoundedMap = class {
        constructor(limit = 5e3) {
          this.limit = limit;
          this.map = /* @__PURE__ */ new Map();
        }
        set(key, value) {
          if (this.map.has(key)) {
            this.map.delete(key);
          }
          this.map.set(key, value);
          if (this.map.size > this.limit) {
            const oldestKey = this.map.keys().next().value;
            this.map.delete(oldestKey);
          }
        }
        get(key) {
          return this.map.get(key);
        }
        values() {
          return Array.from(this.map.values());
        }
        clear() {
          this.map.clear();
        }
        get size() {
          return this.map.size;
        }
      };
      module.exports = {
        BoundedMap
      };
    }
  });

  // src/extraction/index.js
  var require_extraction = __commonJS({
    "src/extraction/index.js"(exports, module) {
      var { ExtractionEngine } = require_engine();
      var { parseNetworkPayload } = require_parser_network();
      var { parseVisibleArticles } = require_parser_dom();
      var { detectScopeFromUrl, getScopeUrl, endpointScopeHint } = require_route_detector();
      var { BoundedMap } = require_bounded_cache();
      module.exports = {
        ExtractionEngine,
        parseNetworkPayload,
        parseVisibleArticles,
        detectScopeFromUrl,
        getScopeUrl,
        endpointScopeHint,
        BoundedMap
      };
    }
  });

  // src/content-script/index.js
  var require_content_script = __commonJS({
    "src/content-script/index.js"(exports, module) {
      var {
        MESSAGE_TYPES,
        validateExtractionStart
      } = require_messages();
      var {
        ExtractionEngine,
        parseNetworkPayload,
        BoundedMap,
        detectScopeFromUrl
      } = require_extraction();
      var XAssistantContentScript = class {
        constructor() {
          this.engine = new ExtractionEngine();
          this.networkCache = new BoundedMap(5e3);
          this.runTokens = /* @__PURE__ */ new Map();
          this.installInjectedInterceptor();
          this.setupNetworkListener();
          this.setupRuntimeListener();
        }
        installInjectedInterceptor() {
          const script = document.createElement("script");
          script.src = chrome.runtime.getURL("dist/injected.js");
          script.onload = function cleanup() {
            this.remove();
          };
          (document.head || document.documentElement).appendChild(script);
        }
        setupNetworkListener() {
          window.addEventListener("x-assistant-network", (event) => {
            const detail = event.detail || {};
            if (!detail.payload)
              return;
            const parsed = parseNetworkPayload(detail.payload, detail.url || "");
            parsed.forEach((record) => {
              this.networkCache.set(record.id, record);
            });
            chrome.runtime.sendMessage({
              type: MESSAGE_TYPES.EXTRACTION_PROGRESS,
              scope: detectScopeFromUrl(window.location.href),
              scannedCount: 0,
              capturedCount: this.networkCache.size,
              cursorState: { loop: 0, stableCount: 0 },
              status: `Network captured ${parsed.length} items`,
              __relay: false
            }).catch(() => {
            });
          });
        }
        setupRuntimeListener() {
          chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            if (!message || typeof message !== "object")
              return;
            if (message.type === MESSAGE_TYPES.EXTRACTION_START) {
              this.handleExtractionStart(message.payload).then((result) => sendResponse({ success: true, ...result })).catch((error) => sendResponse({ success: false, error: error.message, code: error.code || "EXTRACTION_FAILED" }));
              return true;
            }
            if (message.type === MESSAGE_TYPES.EXTRACTION_CANCEL) {
              const runId = message.payload?.runId;
              if (runId && this.runTokens.has(runId)) {
                this.runTokens.get(runId).cancelled = true;
              }
              sendResponse({ success: true });
            }
          });
        }
        async handleExtractionStart(payload) {
          const validation = validateExtractionStart(payload);
          if (!validation.valid) {
            const error = new Error(validation.error);
            error.code = "INVALID_REQUEST";
            throw error;
          }
          const { scope, mode, runId } = validation.value;
          const token = { cancelled: false };
          this.runTokens.set(runId, token);
          try {
            const result = await this.engine.extract({
              scope,
              mode,
              runId,
              getNetworkRecords: () => this.networkCache.values(),
              isCancelled: () => token.cancelled,
              onProgress: (progress) => {
                chrome.runtime.sendMessage({ ...progress, __relay: false }).catch(() => {
                });
              }
            });
            const completion = {
              type: MESSAGE_TYPES.EXTRACTION_COMPLETE,
              runId: result.runId,
              scope: result.scope,
              totalCount: result.totalCount,
              durationMs: result.durationMs,
              records: result.records,
              __relay: false
            };
            chrome.runtime.sendMessage(completion).catch(() => {
            });
            return completion;
          } catch (error) {
            const failure = {
              type: MESSAGE_TYPES.EXTRACTION_ERROR,
              runId,
              scope,
              code: error.code || "EXTRACTION_FAILED",
              message: error.message,
              recoverable: error.code !== "ROUTE_MISMATCH",
              __relay: false
            };
            chrome.runtime.sendMessage(failure).catch(() => {
            });
            throw error;
          } finally {
            this.runTokens.delete(runId);
          }
        }
      };
      new XAssistantContentScript();
      if (typeof module !== "undefined" && module.exports) {
        module.exports = { XAssistantContentScript };
      }
    }
  });
  require_content_script();
})();
//# sourceMappingURL=content-script.js.map
