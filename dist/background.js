(() => {
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __commonJS = (cb, mod) => function __require() {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  };

  // src/core/contracts/messages.js
  var require_messages = __commonJS({
    "src/core/contracts/messages.js"(exports, module) {
      var EXTRACTION_MODES = ["full", "visible"];
      var EXTRACTION_TARGETS = {
        x: ["bookmark", "like", "all"],
        instagram: ["saved", "all"]
      };
      var QUERY_PLATFORMS = ["x", "instagram", "all"];
      var QUERY_TARGETS = ["bookmark", "like", "saved", "all"];
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
      function getSupportedTargets(platform) {
        return EXTRACTION_TARGETS[platform] || [];
      }
      function validateExtractionStart(payload) {
        if (!isPlainObject(payload)) {
          return { valid: false, error: "Payload must be an object" };
        }
        const platform = payload.platform === "instagram" ? "instagram" : payload.platform === "x" ? "x" : "";
        if (!platform) {
          return { valid: false, error: "platform must be x or instagram" };
        }
        const supportedTargets = getSupportedTargets(platform);
        const target = typeof payload.target === "string" ? payload.target : "";
        if (!supportedTargets.includes(target)) {
          return { valid: false, error: `target must be one of: ${supportedTargets.join(", ")}` };
        }
        const mode = payload.mode || "full";
        if (!EXTRACTION_MODES.includes(mode)) {
          return { valid: false, error: "mode must be full or visible" };
        }
        const input = isPlainObject(payload.input) ? payload.input : {};
        return {
          valid: true,
          value: {
            platform,
            target,
            mode,
            input,
            runId: typeof payload.runId === "string" ? payload.runId : `run-${Date.now()}`
          }
        };
      }
      function validateDataQuery(payload) {
        if (!isPlainObject(payload)) {
          return { valid: false, error: "Payload must be an object" };
        }
        const platform = payload.platform || "all";
        if (!QUERY_PLATFORMS.includes(platform)) {
          return { valid: false, error: "platform must be x, instagram, or all" };
        }
        const target = payload.target || "all";
        if (!QUERY_TARGETS.includes(target)) {
          return { valid: false, error: "target must be bookmark, like, saved, or all" };
        }
        const filter = isPlainObject(payload.filter) ? payload.filter : {};
        const sort = typeof payload.sort === "string" ? payload.sort : "capturedAt:desc";
        const page = isPlainObject(payload.page) ? payload.page : {};
        const offset = Number.isInteger(page.offset) && page.offset >= 0 ? page.offset : 0;
        const limit = Number.isInteger(page.limit) && page.limit > 0 ? page.limit : 5e3;
        return {
          valid: true,
          value: {
            platform,
            target,
            filter,
            sort,
            page: { offset, limit }
          }
        };
      }
      module.exports = {
        MESSAGE_TYPES,
        EXTRACTION_MODES,
        EXTRACTION_TARGETS,
        QUERY_PLATFORMS,
        QUERY_TARGETS,
        validateExtractionStart,
        validateDataQuery,
        getSupportedTargets,
        isPlainObject
      };
    }
  });

  // src/core/contracts/record.js
  var require_record = __commonJS({
    "src/core/contracts/record.js"(exports, module) {
      var VALID_PLATFORMS = ["x", "instagram"];
      var VALID_TARGETS = ["bookmark", "like", "saved"];
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
      function extractXStatusIdFromUrl(url) {
        if (typeof url !== "string")
          return null;
        const match = url.match(/\/status\/(\d+)/);
        return match ? match[1] : null;
      }
      function extractInstagramMediaIdFromUrl(url) {
        if (typeof url !== "string")
          return null;
        const match = url.match(/\/(?:p|reel|tv)\/([^/?#]+)/);
        return match ? match[1] : null;
      }
      function extractRecordIdFromUrl(url, platform = "") {
        if (platform === "instagram") {
          return extractInstagramMediaIdFromUrl(url);
        }
        return extractXStatusIdFromUrl(url);
      }
      function normalizeMetrics(metrics = {}) {
        return {
          likes: toNullableNumber(metrics.likes),
          replies: toNullableNumber(metrics.replies),
          views: toNullableNumber(metrics.views),
          shares: toNullableNumber(metrics.shares),
          saves: toNullableNumber(metrics.saves),
          platform: metrics.platform && typeof metrics.platform === "object" ? Object.fromEntries(
            Object.entries(metrics.platform).map(([key, value]) => [key, toNullableNumber(value)]).filter(([, value]) => value !== null)
          ) : {}
        };
      }
      function buildRecordId(raw) {
        if (raw.id && typeof raw.id === "string")
          return raw.id;
        const platform = typeof raw.platform === "string" ? raw.platform : "x";
        const urlId = extractRecordIdFromUrl(raw.url, platform);
        if (urlId) {
          return `${platform}:${urlId}`;
        }
        const text = [
          platform,
          raw.target || "",
          raw.url || "",
          raw.text || "",
          raw.author?.username || ""
        ].join("|");
        let hash = 0;
        for (let i = 0; i < text.length; i += 1) {
          hash = (hash << 5) - hash + text.charCodeAt(i) | 0;
        }
        return `${platform}:fallback-${Math.abs(hash)}`;
      }
      function normalizeRecord(raw) {
        const author = raw.author || {};
        const media = Array.isArray(raw.media) ? raw.media : [];
        const platform = VALID_PLATFORMS.includes(raw.platform) ? raw.platform : "x";
        const target = VALID_TARGETS.includes(raw.target) ? raw.target : raw.scope === "like" || raw.scope === "likes" ? "like" : "bookmark";
        return {
          id: buildRecordId({ ...raw, platform, target }),
          platform,
          target,
          url: typeof raw.url === "string" ? raw.url : "",
          capturedAt: raw.capturedAt || (/* @__PURE__ */ new Date()).toISOString(),
          postedAt: raw.postedAt || raw.tweetPostedAt || null,
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
          metrics: normalizeMetrics(raw.metrics || {}),
          source: {
            route: typeof raw.source?.route === "string" ? raw.source.route : "",
            via: raw.source?.via === "network" ? "network" : "dom"
          },
          meta: raw.meta && typeof raw.meta === "object" ? raw.meta : {}
        };
      }
      function validateRecord(record) {
        if (!record || typeof record !== "object") {
          return { valid: false, error: "Record must be an object" };
        }
        if (!record.id || typeof record.id !== "string") {
          return { valid: false, error: "Record id is required" };
        }
        if (!VALID_PLATFORMS.includes(record.platform)) {
          return { valid: false, error: "Record platform is invalid" };
        }
        if (!VALID_TARGETS.includes(record.target)) {
          return { valid: false, error: "Record target is invalid" };
        }
        if (!record.url || typeof record.url !== "string") {
          return { valid: false, error: "Record url is required" };
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
        VALID_PLATFORMS,
        VALID_TARGETS,
        VALID_MEDIA_TYPES,
        normalizeRecord,
        validateRecord,
        normalizeMediaType,
        toNullableNumber,
        extractXStatusIdFromUrl,
        extractInstagramMediaIdFromUrl,
        extractRecordIdFromUrl,
        normalizeTweetRecord: normalizeRecord,
        validateTweetRecordV2: validateRecord,
        extractTweetIdFromUrl: extractXStatusIdFromUrl
      };
    }
  });

  // src/core/contracts/storage.js
  var require_storage = __commonJS({
    "src/core/contracts/storage.js"(exports, module) {
      var STORAGE_VERSION = 3;
      var STATE_KEY = "xAssistantState";
      var ONBOARDING_GUIDE_VERSION = 2;
      function normalizePlatformSettings(platform, settings = {}) {
        if (platform === "x") {
          return {
            username: typeof settings.username === "string" ? settings.username : ""
          };
        }
        if (platform === "instagram") {
          return {
            username: typeof settings.username === "string" ? settings.username : ""
          };
        }
        return {};
      }
      function normalizeSettings(settings = {}) {
        const settingsByPlatform = settings.settingsByPlatform && typeof settings.settingsByPlatform === "object" ? settings.settingsByPlatform : {};
        return {
          onboardingSeen: settings.onboardingSeen === true,
          guideVersion: Number.isInteger(settings.guideVersion) ? settings.guideVersion : ONBOARDING_GUIDE_VERSION,
          selectedPlatform: settings.selectedPlatform === "instagram" ? "instagram" : "x",
          selectedTarget: typeof settings.selectedTarget === "string" ? settings.selectedTarget : "all",
          settingsByPlatform: {
            x: normalizePlatformSettings("x", settingsByPlatform.x || settings),
            instagram: normalizePlatformSettings("instagram", settingsByPlatform.instagram || {})
          }
        };
      }
      function getDefaultState() {
        return {
          storageVersion: STORAGE_VERSION,
          recordsById: {},
          recordOrder: [],
          settings: normalizeSettings(),
          runs: []
        };
      }
      function validateStorageState(state) {
        if (!state || typeof state !== "object") {
          return { valid: false, error: "State must be an object" };
        }
        if (state.storageVersion !== STORAGE_VERSION) {
          return { valid: false, error: "State version is invalid" };
        }
        if (!state.recordsById || typeof state.recordsById !== "object") {
          return { valid: false, error: "recordsById must be an object" };
        }
        if (!Array.isArray(state.recordOrder)) {
          return { valid: false, error: "recordOrder must be an array" };
        }
        if (!state.settings || typeof state.settings !== "object") {
          return { valid: false, error: "settings must be an object" };
        }
        if (!state.settings.settingsByPlatform || typeof state.settings.settingsByPlatform !== "object") {
          return { valid: false, error: "settingsByPlatform must be an object" };
        }
        if (!Array.isArray(state.runs)) {
          return { valid: false, error: "runs must be an array" };
        }
        return { valid: true, value: state };
      }
      module.exports = {
        STORAGE_VERSION,
        STATE_KEY,
        ONBOARDING_GUIDE_VERSION,
        normalizeSettings,
        normalizePlatformSettings,
        getDefaultState,
        validateStorageState,
        validateStorageStateV2: validateStorageState
      };
    }
  });

  // src/core/contracts/index.js
  var require_contracts = __commonJS({
    "src/core/contracts/index.js"(exports, module) {
      var messages = require_messages();
      var record = require_record();
      var storage = require_storage();
      module.exports = {
        ...messages,
        ...record,
        ...storage
      };
    }
  });

  // src/storage/migration.js
  var require_migration = __commonJS({
    "src/storage/migration.js"(exports, module) {
      var {
        STATE_KEY,
        STORAGE_VERSION,
        getDefaultState,
        normalizeRecord,
        normalizeSettings,
        extractXStatusIdFromUrl
      } = require_contracts();
      function inferTargetFromLegacyBookmark(bookmark) {
        if (bookmark.scope === "like")
          return "like";
        return "bookmark";
      }
      function legacyBookmarkToRecord(bookmark, target = "bookmark") {
        const id = extractXStatusIdFromUrl(bookmark.url || "") || bookmark.id || `legacy-${Math.random().toString(16).slice(2)}`;
        return normalizeRecord({
          id: `x:${id}`,
          platform: "x",
          target,
          url: bookmark.url || "",
          capturedAt: bookmark.savedAt || bookmark.dateTime || (/* @__PURE__ */ new Date()).toISOString(),
          postedAt: bookmark.dateTime || null,
          author: {
            username: bookmark.username || "",
            displayName: bookmark.displayName || ""
          },
          text: bookmark.text || "",
          media: Array.isArray(bookmark.media) ? bookmark.media.map((item) => ({
            type: item.type || "photo",
            url: item.url || item.media_url_https || "",
            previewUrl: item.media_url_https || void 0
          })) : [],
          metrics: {
            likes: bookmark.likes,
            replies: bookmark.replies,
            views: bookmark.views,
            platform: {
              retweets: bookmark.retweets
            }
          },
          source: {
            route: target === "bookmark" ? "/i/bookmarks" : "/likes",
            via: bookmark.source === "manual" ? "dom" : "network"
          }
        });
      }
      function migrateStoredV2State(storedState) {
        const state = getDefaultState();
        state.recordsById = {};
        Object.values(storedState.recordsById || {}).forEach((legacyRecord) => {
          const normalized = normalizeRecord({
            ...legacyRecord,
            platform: "x",
            target: legacyRecord.scope === "like" ? "like" : "bookmark",
            postedAt: legacyRecord.tweetPostedAt || legacyRecord.postedAt || null,
            metrics: {
              likes: legacyRecord.metrics?.likes,
              replies: legacyRecord.metrics?.replies,
              views: legacyRecord.metrics?.views,
              platform: {
                retweets: legacyRecord.metrics?.retweets
              }
            }
          });
          state.recordsById[normalized.id] = normalized;
        });
        state.recordOrder = Object.values(state.recordsById).sort((a, b) => new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime()).map((record) => record.id);
        state.settings = normalizeSettings({
          username: storedState.settings?.username || "",
          onboardingSeen: storedState.settings?.onboardingSeen,
          guideVersion: storedState.settings?.guideVersion
        });
        state.runs = Array.isArray(storedState.runs) ? storedState.runs : [];
        return state;
      }
      function migrateLegacyStorage(rawStorage = {}) {
        const state = getDefaultState();
        const storedState = rawStorage[STATE_KEY];
        if (storedState && storedState.storageVersion === STORAGE_VERSION) {
          return {
            ...state,
            ...storedState,
            recordsById: storedState.recordsById && typeof storedState.recordsById === "object" ? storedState.recordsById : {},
            recordOrder: Array.isArray(storedState.recordOrder) ? storedState.recordOrder : [],
            settings: normalizeSettings(storedState.settings || {}),
            runs: Array.isArray(storedState.runs) ? storedState.runs : []
          };
        }
        if (storedState && storedState.storageVersion === 2) {
          return migrateStoredV2State(storedState);
        }
        const legacyBookmarks = [];
        if (rawStorage.lastExtraction && Array.isArray(rawStorage.lastExtraction.bookmarks)) {
          legacyBookmarks.push(...rawStorage.lastExtraction.bookmarks);
        }
        if (Array.isArray(rawStorage.manualBookmarks)) {
          legacyBookmarks.push(...rawStorage.manualBookmarks);
        }
        const mapped = legacyBookmarks.filter((bookmark) => bookmark && bookmark.url).map((bookmark) => legacyBookmarkToRecord(bookmark, inferTargetFromLegacyBookmark(bookmark)));
        for (const record of mapped) {
          state.recordsById[record.id] = record;
        }
        state.recordOrder = Object.values(state.recordsById).sort((a, b) => new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime()).map((record) => record.id);
        state.runs.push({
          runId: `migration-${Date.now()}`,
          platform: "all",
          target: "all",
          totalCount: state.recordOrder.length,
          durationMs: 0,
          createdAt: (/* @__PURE__ */ new Date()).toISOString()
        });
        return state;
      }
      module.exports = {
        migrateLegacyStorage,
        legacyBookmarkToRecord
      };
    }
  });

  // src/storage/repository.js
  var require_repository = __commonJS({
    "src/storage/repository.js"(exports, module) {
      var {
        STATE_KEY,
        STORAGE_VERSION,
        getDefaultState,
        validateStorageState,
        normalizeSettings,
        normalizeRecord,
        validateRecord
      } = require_contracts();
      var { migrateLegacyStorage } = require_migration();
      var StorageRepository = class {
        constructor(storageArea) {
          this.storage = storageArea || chrome.storage.local;
        }
        async ensureInitialized() {
          const result = await this.storage.get([STATE_KEY, "lastExtraction", "manualBookmarks"]);
          const existingState = result[STATE_KEY];
          if (existingState && existingState.storageVersion === STORAGE_VERSION) {
            const validation = validateStorageState(existingState);
            if (validation.valid) {
              return existingState;
            }
          }
          const migrated = migrateLegacyStorage(result);
          await this.storage.set({ [STATE_KEY]: migrated });
          return migrated;
        }
        async loadState() {
          const result = await this.storage.get(STATE_KEY);
          const state = result[STATE_KEY];
          if (!state) {
            return this.ensureInitialized();
          }
          const validation = validateStorageState(state);
          if (!validation.valid) {
            return this.ensureInitialized();
          }
          return state;
        }
        async saveState(state) {
          await this.storage.set({ [STATE_KEY]: state });
          return state;
        }
        async updateSettings(partialSettings = {}) {
          const state = await this.loadState();
          state.settings = normalizeSettings({
            ...state.settings,
            ...partialSettings,
            settingsByPlatform: {
              ...state.settings.settingsByPlatform,
              ...partialSettings.settingsByPlatform || {}
            }
          });
          await this.saveState(state);
          return state.settings;
        }
        async getSettings() {
          const state = await this.loadState();
          return state.settings;
        }
        async upsertRecords(records, runMeta = null) {
          const state = await this.loadState();
          let changed = 0;
          for (const candidate of records || []) {
            const normalized = normalizeRecord(candidate);
            const validation = validateRecord(normalized);
            if (!validation.valid)
              continue;
            const existing = state.recordsById[normalized.id];
            state.recordsById[normalized.id] = existing ? { ...existing, ...normalized } : normalized;
            changed += 1;
          }
          state.recordOrder = Object.values(state.recordsById).sort((a, b) => new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime()).map((record) => record.id);
          if (runMeta) {
            state.runs.unshift({
              runId: runMeta.runId || `run-${Date.now()}`,
              platform: runMeta.platform || "all",
              target: runMeta.target || "all",
              totalCount: typeof runMeta.totalCount === "number" ? runMeta.totalCount : records.length,
              durationMs: typeof runMeta.durationMs === "number" ? runMeta.durationMs : 0,
              createdAt: (/* @__PURE__ */ new Date()).toISOString()
            });
            state.runs = state.runs.slice(0, 100);
          }
          await this.saveState(state);
          return { changed, total: state.recordOrder.length };
        }
        async queryRecords({ platform = "all", target = "all", filter = {}, sort = "capturedAt:desc", page = {} } = {}) {
          const state = await this.loadState();
          let records = state.recordOrder.map((id) => state.recordsById[id]).filter(Boolean);
          if (platform !== "all") {
            records = records.filter((record) => record.platform === platform);
          }
          if (target !== "all") {
            records = records.filter((record) => record.target === target);
          }
          if (filter.search && typeof filter.search === "string") {
            const query = filter.search.trim().toLowerCase();
            if (query) {
              records = records.filter((record) => {
                return record.text.toLowerCase().includes(query) || record.author.username.toLowerCase().includes(query) || record.author.displayName.toLowerCase().includes(query);
              });
            }
          }
          if (sort === "capturedAt:asc") {
            records = records.slice().reverse();
          }
          const offset = Number.isInteger(page.offset) ? page.offset : 0;
          const limit = Number.isInteger(page.limit) ? page.limit : records.length;
          const paged = records.slice(offset, offset + limit);
          return {
            records: paged,
            total: records.length,
            hasMore: offset + limit < records.length
          };
        }
      };
      module.exports = {
        StorageRepository,
        STATE_KEY,
        getDefaultState
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
      function parseXArticle(article, target, route) {
        const link = article.querySelector('a[href*="/status/"]');
        const url = link?.href || "";
        if (!url)
          return null;
        const idMatch = url.match(/\/status\/(\d+)/);
        const id = idMatch ? `x:${idMatch[1]}` : "";
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
          const match = url.match(/(?:x\.com|twitter\.com)\/([^/]+)\/status/);
          username = match ? match[1] : "";
        }
        const text = Array.from(article.querySelectorAll('[data-testid="tweetText"]')).map((node) => node.textContent?.trim() || "").filter(Boolean).join(" ");
        const timeNode = article.querySelector("time");
        const postedAt = timeNode?.getAttribute("datetime") || null;
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
          platform: "x",
          target,
          url,
          capturedAt: (/* @__PURE__ */ new Date()).toISOString(),
          postedAt,
          author: {
            username,
            displayName
          },
          text,
          media: extractDomMedia(article),
          metrics: {
            likes,
            replies,
            views,
            platform: {
              retweets
            }
          },
          source: {
            route,
            via: "dom"
          }
        };
      }
      function parseVisibleArticles(platform, target, route) {
        if (platform !== "x") {
          return {
            scannedCount: 0,
            records: []
          };
        }
        const articles = Array.from(document.querySelectorAll("article"));
        const parsed = [];
        for (const article of articles) {
          const item = parseXArticle(article, target, route);
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
        parseXArticle,
        parseCount,
        extractDomMedia
      };
    }
  });

  // src/extraction/parser-network.js
  var require_parser_network = __commonJS({
    "src/extraction/parser-network.js"(exports, module) {
      var { endpointTargetHint } = require_route_detector();
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
      function parseTweetResult(resultNode, targetHint, route) {
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
          id: id ? `x:${id}` : "",
          platform: "x",
          target: targetHint === "like" ? "like" : "bookmark",
          url: id && username ? `https://x.com/${username}/status/${id}` : "",
          capturedAt: (/* @__PURE__ */ new Date()).toISOString(),
          postedAt: legacy.created_at ? new Date(legacy.created_at).toISOString() : null,
          author: {
            username,
            displayName: core.name || "",
            userId: core.id_str || void 0
          },
          text,
          media: parseNetworkMedia(legacy),
          metrics: {
            likes: legacy.favorite_count,
            replies: legacy.reply_count,
            views: resultNode.views?.count || null,
            platform: {
              retweets: legacy.retweet_count
            }
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
        const targetHint = endpointTargetHint(endpointUrl, "x");
        const route = targetHint === "like" ? "/likes" : "/i/bookmarks";
        return nodes.map((node) => parseTweetResult(node, targetHint, route)).filter((item) => item && item.url);
      }
      module.exports = {
        parseNetworkPayload,
        parseNetworkMedia,
        collectTweetResultNodes
      };
    }
  });

  // src/platforms/x.js
  var require_x = __commonJS({
    "src/platforms/x.js"(exports, module) {
      var { parseVisibleArticles: parseVisibleXArticles } = require_parser_dom();
      var { parseNetworkPayload: parseXNetworkPayload } = require_parser_network();
      function normalizeUsername(value) {
        return String(value || "").trim().replace(/^@+/, "");
      }
      var xAdapter = {
        platform: "x",
        label: "X / Twitter",
        supportedTargets: ["bookmark", "like"],
        getAllTargets() {
          return this.supportedTargets.slice();
        },
        getTargetLabel(target) {
          if (target === "bookmark")
            return "Bookmarks";
          if (target === "like")
            return "Likes";
          return target;
        },
        getInputSchema(target) {
          if (target === "like") {
            return [{ key: "username", label: "Username for likes (@handle)", placeholder: "@username" }];
          }
          return [];
        },
        validateInput(target, input = {}) {
          if (target === "like") {
            const username = normalizeUsername(input.username);
            if (!username) {
              return { valid: false, error: "Enter @username for X likes extraction" };
            }
            return { valid: true, value: { username } };
          }
          return { valid: true, value: {} };
        },
        getRouteUrl(target, input = {}) {
          if (target === "bookmark") {
            return "https://x.com/i/bookmarks";
          }
          const username = normalizeUsername(input.username);
          if (!username) {
            throw new Error("Username is required for X likes extraction");
          }
          return `https://x.com/${username}/likes`;
        },
        detectTargetFromUrl(url = "") {
          const normalized = String(url).toLowerCase();
          if (normalized.includes("/i/bookmarks"))
            return "bookmark";
          if (/\/[^/]+\/likes(?:\?|$|\/)/.test(normalized))
            return "like";
          return "unknown";
        },
        getEndpointHint(url = "") {
          const lower = String(url).toLowerCase();
          if (lower.includes("bookmarks"))
            return "bookmark";
          if (lower.includes("likes"))
            return "like";
          return "unknown";
        },
        shouldCaptureNetwork(url = "") {
          const lower = String(url).toLowerCase();
          return lower.includes("bookmarks") || lower.includes("likes");
        },
        parseDom(target, route) {
          return parseVisibleXArticles("x", target, route);
        },
        parseNetwork(payload, url = "") {
          return parseXNetworkPayload(payload, url);
        },
        getProgressLabel(target) {
          return `Scanning X ${this.getTargetLabel(target).toLowerCase()}...`;
        }
      };
      module.exports = {
        xAdapter,
        normalizeXUsername: normalizeUsername
      };
    }
  });

  // src/platforms/instagram.js
  var require_instagram = __commonJS({
    "src/platforms/instagram.js"(exports, module) {
      function wait(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
      }
      function normalizeUsername(value) {
        return String(value || "").trim().replace(/^@+/, "");
      }
      function normalizeSavedHref(href) {
        if (!href)
          return "";
        const absolute = href.startsWith("http") ? href : `https://www.instagram.com${href.startsWith("/") ? "" : "/"}${href}`;
        return absolute.replace(/\/saved\/(p|reel|tv)\//, "/$1/").replace(/\?.*$/, "");
      }
      function isSavedContentHref(href) {
        return /\/(?:saved\/)?(?:p|reel|tv)\//.test(href || "");
      }
      function isSavedCollectionHref(href) {
        if (!href)
          return false;
        return /\/saved(?:\/|$)/.test(href) && !isSavedContentHref(href);
      }
      function isAllPostsGridPath(pathname = "") {
        return /\/saved\/all-posts\/?$/.test(pathname || "");
      }
      function isCollectionIndexPage(pathname = "", root = document) {
        if (!/\/saved\/?$/.test(pathname || ""))
          return false;
        return getSavedContentAnchors(root).length === 0 && getSavedCollectionAnchors(root).length > 0;
      }
      function hasAllPostsCollectionLink(username, root = document) {
        return Boolean(findAllPostsCollectionLink(username, root));
      }
      function extractInstagramMediaFromNode(node) {
        const media = [];
        const imageNodes = node.querySelectorAll("img");
        imageNodes.forEach((img) => {
          const url = img.currentSrc || img.src;
          if (url) {
            media.push({ type: "photo", url });
          }
        });
        const videoNodes = node.querySelectorAll("video");
        videoNodes.forEach((video) => {
          const url = video.currentSrc || video.src;
          if (url) {
            media.push({ type: "video", url });
          }
        });
        return media;
      }
      function getSavedCollectionAnchors(root = document) {
        return Array.from(root.querySelectorAll("main a[href], a[href]")).filter((anchor) => isSavedCollectionHref(anchor.getAttribute("href") || anchor.href || ""));
      }
      function findAllPostsCollectionLink(username, root = document) {
        const normalizedUsername = normalizeUsername(username);
        const anchors = getSavedCollectionAnchors(root);
        const exactHref = `/${normalizedUsername}/saved/all-posts/`;
        const exact = anchors.find((anchor) => (anchor.getAttribute("href") || "") === exactHref);
        if (exact)
          return exact;
        return anchors.find((anchor) => {
          const href = (anchor.getAttribute("href") || "").toLowerCase();
          const label = `${anchor.textContent || ""} ${anchor.getAttribute("aria-label") || ""}`.toLowerCase();
          return href.includes("/saved/all-posts/") || label.includes("all posts");
        }) || null;
      }
      function getSavedGridArticle(root = document) {
        return root.querySelector("article");
      }
      function getSavedContentAnchors(root = document) {
        const article = getSavedGridArticle(root);
        if (!article)
          return [];
        return Array.from(article.querySelectorAll("a[href]")).filter((anchor) => isSavedContentHref(anchor.getAttribute("href") || anchor.href || ""));
      }
      function parseSavedGrid(route) {
        const article = getSavedGridArticle(document);
        const anchors = article ? Array.from(article.querySelectorAll("a[href]")).filter((anchor) => isSavedContentHref(anchor.getAttribute("href") || anchor.href || "")) : [];
        const unique = /* @__PURE__ */ new Map();
        anchors.forEach((anchor) => {
          const href = normalizeSavedHref(anchor.getAttribute("href") || anchor.href || "");
          if (!href || unique.has(href))
            return;
          const tile = anchor.closest("a[href]") || anchor;
          const wrapper = anchor.closest("div");
          const text = [
            anchor.getAttribute("aria-label") || "",
            anchor.textContent?.trim() || "",
            wrapper?.getAttribute("aria-label") || ""
          ].filter(Boolean).join(" ").trim();
          unique.set(href, {
            platform: "instagram",
            target: "saved",
            url: href,
            capturedAt: (/* @__PURE__ */ new Date()).toISOString(),
            postedAt: null,
            author: {
              username: "",
              displayName: ""
            },
            text,
            media: extractInstagramMediaFromNode(tile),
            metrics: {},
            source: {
              route,
              via: "dom"
            }
          });
        });
        return {
          scannedCount: anchors.length,
          records: Array.from(unique.values())
        };
      }
      var instagramAdapter = {
        platform: "instagram",
        label: "Instagram",
        supportedTargets: ["saved"],
        getAllTargets() {
          return this.supportedTargets.slice();
        },
        getTargetLabel(target) {
          return target === "saved" ? "Saved" : target;
        },
        getInputSchema(target) {
          if (target === "saved") {
            return [{ key: "username", label: "Instagram username for saved posts", placeholder: "@username" }];
          }
          return [];
        },
        validateInput(target, input = {}) {
          if (target === "saved") {
            const username = normalizeUsername(input.username);
            if (!username) {
              return { valid: false, error: "Enter @username for Instagram saved extraction" };
            }
            return { valid: true, value: { username } };
          }
          return { valid: true, value: {} };
        },
        getRouteUrl(target, input = {}) {
          if (target !== "saved") {
            throw new Error("Instagram only supports saved extraction");
          }
          const username = normalizeUsername(input.username);
          if (!username) {
            throw new Error("Username is required for Instagram saved extraction");
          }
          return `https://www.instagram.com/${username}/saved/`;
        },
        detectTargetFromUrl(url = "") {
          const normalized = String(url).toLowerCase();
          if (/\/[^/]+\/saved(?:\/|\?|$)/.test(normalized))
            return "saved";
          return "unknown";
        },
        getEndpointHint() {
          return "unknown";
        },
        shouldCaptureNetwork() {
          return false;
        },
        parseDom(target, route) {
          if (target !== "saved") {
            return { scannedCount: 0, records: [] };
          }
          return parseSavedGrid(route);
        },
        async preparePage(target, context = {}) {
          if (target !== "saved")
            return;
          const pathname = window.location.pathname;
          if (isAllPostsGridPath(pathname)) {
            return;
          }
          if (!isCollectionIndexPage(pathname, document)) {
            return;
          }
          const linkDeadline = Date.now() + 8e3;
          let allPostsLink = null;
          while (Date.now() < linkDeadline) {
            allPostsLink = findAllPostsCollectionLink(context.input?.username, document);
            if (allPostsLink)
              break;
            await wait(250);
          }
          if (!allPostsLink) {
            const error2 = new Error("Instagram saved collections loaded, but the All posts collection link was not found.");
            error2.code = "INSTAGRAM_COLLECTION_INDEX_UNRESOLVED";
            throw error2;
          }
          const href = allPostsLink.getAttribute("href") || "";
          const targetUrl = href.startsWith("http") ? href : `https://www.instagram.com${href}`;
          if (!targetUrl) {
            const error2 = new Error("Instagram All posts collection link is missing a usable href.");
            error2.code = "INSTAGRAM_COLLECTION_INDEX_UNRESOLVED";
            throw error2;
          }
          if (typeof context.onProgress === "function") {
            context.onProgress("Opening All posts...");
          }
          if (typeof context.navigate === "function") {
            context.navigate(targetUrl);
          } else if (typeof window.location.assign === "function") {
            window.location.assign(targetUrl);
          } else {
            window.location.href = targetUrl;
          }
          const deadline = Date.now() + 1e4;
          while (Date.now() < deadline) {
            if (isAllPostsGridPath(window.location.pathname)) {
              return;
            }
            await wait(250);
          }
          const error = new Error("Instagram saved collection navigation did not reach the All posts grid.");
          error.code = "INSTAGRAM_COLLECTION_INDEX_UNRESOLVED";
          throw error;
        },
        async waitForReady(target, context = {}) {
          if (target !== "saved")
            return;
          const timeoutMs = Number.isFinite(context.timeoutMs) ? context.timeoutMs : 1e4;
          const deadline = Date.now() + timeoutMs;
          while (Date.now() < deadline) {
            const pathname2 = window.location.pathname;
            const loginGate = document.querySelector('a[href*="/accounts/login"], form input[name="username"]');
            if (loginGate) {
              const error2 = new Error("Instagram saved page is not accessible because the browser is not on an authenticated saved-page view.");
              error2.code = "AUTH_REQUIRED";
              throw error2;
            }
            if (isAllPostsGridPath(pathname2)) {
              const contentAnchors = getSavedContentAnchors(document);
              if (contentAnchors.length > 0) {
                return;
              }
            } else if (isCollectionIndexPage(pathname2, document)) {
              if (typeof context.onProgress === "function") {
                context.onProgress("Waiting for Instagram saved collections...");
              }
              if (hasAllPostsCollectionLink(context.input?.username, document)) {
                return;
              }
            }
            await wait(250);
          }
          const pathname = window.location.pathname;
          if (isAllPostsGridPath(pathname)) {
            const error2 = new Error("Instagram All posts page loaded, but no extractable saved items were found.");
            error2.code = "INSTAGRAM_GRID_EMPTY";
            throw error2;
          }
          const error = new Error("Instagram saved page loaded, but no saved collections or saved item grid were detected.");
          error.code = "INSTAGRAM_PAGE_UNSUPPORTED";
          throw error;
        },
        parseNetwork() {
          return [];
        },
        getProgressLabel(target) {
          return target === "saved" ? "Scanning Instagram saved items..." : `Scanning Instagram ${this.getTargetLabel(target).toLowerCase()}...`;
        }
      };
      module.exports = {
        instagramAdapter,
        normalizeSavedHref,
        isSavedContentHref,
        isSavedCollectionHref,
        isCollectionIndexPage,
        isAllPostsGridPath,
        getSavedCollectionAnchors,
        findAllPostsCollectionLink,
        hasAllPostsCollectionLink,
        getSavedContentAnchors
      };
    }
  });

  // src/platforms/index.js
  var require_platforms = __commonJS({
    "src/platforms/index.js"(exports, module) {
      var { xAdapter } = require_x();
      var { instagramAdapter } = require_instagram();
      var PLATFORM_ADAPTERS = {
        x: xAdapter,
        instagram: instagramAdapter
      };
      function getPlatformAdapter(platform) {
        return PLATFORM_ADAPTERS[platform] || null;
      }
      function listPlatformAdapters() {
        return Object.values(PLATFORM_ADAPTERS);
      }
      function expandExtractionTargets(platform, target) {
        const adapter = getPlatformAdapter(platform);
        if (!adapter)
          return [];
        if (target === "all") {
          return adapter.getAllTargets();
        }
        return adapter.supportedTargets.includes(target) ? [target] : [];
      }
      function detectContextFromUrl(url = "") {
        if (/instagram\.com/i.test(url)) {
          const adapter = getPlatformAdapter("instagram");
          return {
            platform: "instagram",
            target: adapter.detectTargetFromUrl(url)
          };
        }
        if (/(?:^|\/\/)(?:www\.)?(?:x\.com|twitter\.com)/i.test(url)) {
          const adapter = getPlatformAdapter("x");
          return {
            platform: "x",
            target: adapter.detectTargetFromUrl(url)
          };
        }
        return {
          platform: "unknown",
          target: "unknown"
        };
      }
      module.exports = {
        PLATFORM_ADAPTERS,
        getPlatformAdapter,
        listPlatformAdapters,
        expandExtractionTargets,
        detectContextFromUrl
      };
    }
  });

  // src/extraction/route-detector.js
  var require_route_detector = __commonJS({
    "src/extraction/route-detector.js"(exports, module) {
      var { getPlatformAdapter, detectContextFromUrl } = require_platforms();
      function detectTargetFromUrl(url = "", platform = "x") {
        const adapter = getPlatformAdapter(platform);
        return adapter ? adapter.detectTargetFromUrl(url) : "unknown";
      }
      function getTargetUrl(platform, target, input = {}) {
        const adapter = getPlatformAdapter(platform);
        if (!adapter) {
          throw new Error(`Unsupported platform: ${platform}`);
        }
        return adapter.getRouteUrl(target, input);
      }
      function endpointTargetHint(url = "", platform = "x") {
        const adapter = getPlatformAdapter(platform);
        return adapter ? adapter.getEndpointHint(url) : "unknown";
      }
      module.exports = {
        detectTargetFromUrl,
        getTargetUrl,
        endpointTargetHint,
        detectContextFromUrl
      };
    }
  });

  // src/background/index.js
  var require_background = __commonJS({
    "src/background/index.js"() {
      var {
        MESSAGE_TYPES,
        validateDataQuery,
        validateExtractionStart
      } = require_messages();
      var { StorageRepository } = require_repository();
      var { getTargetUrl } = require_route_detector();
      var { expandExtractionTargets, getPlatformAdapter } = require_platforms();
      var repository = new StorageRepository(chrome.storage.local);
      async function waitForTabLoad(tabId) {
        return new Promise((resolve) => {
          const handler = (updatedTabId, changeInfo, tab) => {
            if (updatedTabId === tabId && changeInfo.status === "complete") {
              chrome.tabs.onUpdated.removeListener(handler);
              resolve(tab);
            }
          };
          chrome.tabs.onUpdated.addListener(handler);
        });
      }
      async function createBackgroundTab(url) {
        const tab = await chrome.tabs.create({ url, active: false });
        await waitForTabLoad(tab.id);
        return tab;
      }
      async function sendToTab(tabId, message, attempts = 3) {
        let lastError;
        for (let attempt = 0; attempt < attempts; attempt += 1) {
          try {
            const response = await chrome.tabs.sendMessage(tabId, message);
            return response;
          } catch (error) {
            lastError = error;
            await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
          }
        }
        throw lastError;
      }
      async function runExtractionTask({ platform, target, mode, input, runId }) {
        const url = getTargetUrl(platform, target, input);
        const tab = await createBackgroundTab(url);
        try {
          const response = await sendToTab(tab.id, {
            type: MESSAGE_TYPES.EXTRACTION_START,
            payload: { platform, target, mode, input, runId }
          });
          if (!response || !response.success) {
            const error = new Error(response?.error || `Extraction failed for ${platform}/${target}`);
            error.code = response?.code || "EXTRACTION_FAILED";
            throw error;
          }
          return response;
        } finally {
          chrome.tabs.remove(tab.id).catch(() => {
          });
        }
      }
      async function handleStartExtraction(payload) {
        const validation = validateExtractionStart(payload || {});
        if (!validation.valid) {
          throw new Error(validation.error);
        }
        const { platform, target, mode, input } = validation.value;
        const runId = `run-${Date.now()}`;
        const targets = expandExtractionTargets(platform, target);
        const records = [];
        const startedAt = Date.now();
        for (const currentTarget of targets) {
          const adapter = getPlatformAdapter(platform);
          const inputValidation = adapter.validateInput(currentTarget, input);
          if (!inputValidation.valid) {
            throw new Error(inputValidation.error);
          }
          const taskResult = await runExtractionTask({
            platform,
            target: currentTarget,
            mode,
            input: inputValidation.value,
            runId: `${runId}-${platform}-${currentTarget}`
          });
          const taskRecords = taskResult.records || [];
          if (taskRecords.length > 0) {
            await repository.upsertRecords(taskRecords, {
              runId: `${runId}-${currentTarget}`,
              platform,
              target: currentTarget,
              totalCount: taskRecords.length,
              durationMs: taskResult.durationMs || 0
            });
          }
          records.push(...taskRecords);
        }
        const durationMs = Date.now() - startedAt;
        const completion = {
          type: MESSAGE_TYPES.EXTRACTION_COMPLETE,
          runId,
          platform,
          target,
          totalCount: records.length,
          durationMs,
          __relay: true
        };
        chrome.runtime.sendMessage(completion).catch(() => {
        });
        return {
          runId,
          totalCount: records.length,
          durationMs
        };
      }
      async function handleDataQuery(payload) {
        const validation = validateDataQuery(payload || {});
        if (!validation.valid) {
          throw new Error(validation.error);
        }
        return repository.queryRecords(validation.value);
      }
      chrome.runtime.onInstalled.addListener(() => {
        repository.ensureInitialized().catch(() => {
        });
      });
      chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (!message || typeof message !== "object")
          return;
        if (message.__relay) {
          return;
        }
        if (message.type === MESSAGE_TYPES.EXTRACTION_PROGRESS || message.type === MESSAGE_TYPES.EXTRACTION_COMPLETE || message.type === MESSAGE_TYPES.EXTRACTION_ERROR) {
          chrome.runtime.sendMessage({ ...message, __relay: true }).catch(() => {
          });
          return;
        }
        if (message.type === MESSAGE_TYPES.XA_START_EXTRACTION) {
          handleStartExtraction(message.payload || {}).then((result) => sendResponse({ success: true, ...result })).catch((error) => sendResponse({ success: false, error: error.message }));
          return true;
        }
        if (message.type === MESSAGE_TYPES.DATA_QUERY) {
          handleDataQuery(message.payload || {}).then((result) => sendResponse({ success: true, ...result })).catch((error) => sendResponse({ success: false, error: error.message }));
          return true;
        }
        if (message.type === MESSAGE_TYPES.XA_GET_SETTINGS) {
          repository.getSettings().then((settings) => sendResponse({ success: true, settings })).catch((error) => sendResponse({ success: false, error: error.message }));
          return true;
        }
        if (message.type === MESSAGE_TYPES.XA_SAVE_SETTINGS) {
          repository.updateSettings(message.payload || {}).then((settings) => sendResponse({ success: true, settings })).catch((error) => sendResponse({ success: false, error: error.message }));
          return true;
        }
      });
    }
  });
  require_background();
})();
//# sourceMappingURL=background.js.map
