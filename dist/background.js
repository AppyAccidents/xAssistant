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

  // src/core/contracts/storage.js
  var require_storage = __commonJS({
    "src/core/contracts/storage.js"(exports, module) {
      var STORAGE_VERSION = 2;
      var STATE_KEY = "xAssistantState";
      function getDefaultState() {
        return {
          storageVersion: STORAGE_VERSION,
          recordsById: {},
          recordOrder: [],
          settings: {
            username: ""
          },
          runs: []
        };
      }
      function validateStorageStateV2(state) {
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
        if (typeof state.settings.username !== "string") {
          return { valid: false, error: "settings.username must be a string" };
        }
        if (!Array.isArray(state.runs)) {
          return { valid: false, error: "runs must be an array" };
        }
        return { valid: true, value: state };
      }
      module.exports = {
        STORAGE_VERSION,
        STATE_KEY,
        getDefaultState,
        validateStorageStateV2
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
        STORAGE_VERSION,
        getDefaultState,
        normalizeTweetRecord,
        extractTweetIdFromUrl
      } = require_contracts();
      function inferScopeFromLegacyBookmark(bookmark) {
        if (bookmark.source === "manual" || bookmark.scope === "bookmark") {
          return "bookmark";
        }
        return "bookmark";
      }
      function legacyBookmarkToRecord(bookmark, scope = "bookmark") {
        const id = extractTweetIdFromUrl(bookmark.url || "") || bookmark.id || `legacy-${Math.random().toString(16).slice(2)}`;
        return normalizeTweetRecord({
          id,
          url: bookmark.url || "",
          scope,
          capturedAt: bookmark.savedAt || bookmark.dateTime || (/* @__PURE__ */ new Date()).toISOString(),
          tweetPostedAt: bookmark.dateTime || null,
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
            retweets: bookmark.retweets,
            replies: bookmark.replies,
            views: bookmark.views
          },
          source: {
            route: "/i/bookmarks",
            via: bookmark.source === "manual" ? "dom" : "network"
          }
        });
      }
      function migrateLegacyStorage(rawStorage = {}) {
        const state = getDefaultState();
        if (rawStorage[STATE_KEY] && rawStorage[STATE_KEY].storageVersion === STORAGE_VERSION) {
          return rawStorage[STATE_KEY];
        }
        const legacyBookmarks = [];
        if (rawStorage.lastExtraction && Array.isArray(rawStorage.lastExtraction.bookmarks)) {
          legacyBookmarks.push(...rawStorage.lastExtraction.bookmarks);
        }
        if (Array.isArray(rawStorage.manualBookmarks)) {
          legacyBookmarks.push(...rawStorage.manualBookmarks);
        }
        const mapped = legacyBookmarks.filter((bookmark) => bookmark && bookmark.url).map((bookmark) => legacyBookmarkToRecord(bookmark, inferScopeFromLegacyBookmark(bookmark)));
        for (const record of mapped) {
          state.recordsById[record.id] = record;
        }
        state.recordOrder = Object.values(state.recordsById).sort((a, b) => new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime()).map((record) => record.id);
        state.runs.push({
          runId: `migration-${Date.now()}`,
          scope: "all",
          totalCount: state.recordOrder.length,
          durationMs: 0,
          createdAt: (/* @__PURE__ */ new Date()).toISOString()
        });
        return state;
      }
      var { STATE_KEY } = require_storage();
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
        validateStorageStateV2,
        normalizeTweetRecord,
        validateTweetRecordV2
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
            return existingState;
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
          const validation = validateStorageStateV2(state);
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
          const username = typeof partialSettings.username === "string" ? partialSettings.username : state.settings.username;
          state.settings = {
            ...state.settings,
            username
          };
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
            const normalized = normalizeTweetRecord(candidate);
            const validation = validateTweetRecordV2(normalized);
            if (!validation.valid)
              continue;
            const existing = state.recordsById[normalized.id];
            if (!existing) {
              state.recordsById[normalized.id] = normalized;
              changed += 1;
              continue;
            }
            const merged = {
              ...existing,
              ...normalized
            };
            state.recordsById[normalized.id] = merged;
            changed += 1;
          }
          state.recordOrder = Object.values(state.recordsById).sort((a, b) => new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime()).map((record) => record.id);
          if (runMeta) {
            state.runs.unshift({
              runId: runMeta.runId || `run-${Date.now()}`,
              scope: runMeta.scope || "all",
              totalCount: typeof runMeta.totalCount === "number" ? runMeta.totalCount : records.length,
              durationMs: typeof runMeta.durationMs === "number" ? runMeta.durationMs : 0,
              createdAt: (/* @__PURE__ */ new Date()).toISOString()
            });
            state.runs = state.runs.slice(0, 100);
          }
          await this.saveState(state);
          return { changed, total: state.recordOrder.length };
        }
        async queryRecords({ scope = "all", filter = {}, sort = "capturedAt:desc", page = {} } = {}) {
          const state = await this.loadState();
          let records = state.recordOrder.map((id) => state.recordsById[id]).filter(Boolean);
          if (scope === "bookmarks") {
            records = records.filter((record) => record.scope === "bookmark");
          } else if (scope === "likes") {
            records = records.filter((record) => record.scope === "like");
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

  // src/background/index.js
  var require_background = __commonJS({
    "src/background/index.js"() {
      var {
        MESSAGE_TYPES,
        validateDataQuery
      } = require_messages();
      var { StorageRepository } = require_repository();
      var { getScopeUrl } = require_route_detector();
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
      async function runScopeExtraction({ scope, username, mode, runId }) {
        const url = getScopeUrl(scope, username);
        const tab = await createBackgroundTab(url);
        try {
          const response = await sendToTab(tab.id, {
            type: MESSAGE_TYPES.EXTRACTION_START,
            payload: { scope, mode, runId }
          });
          if (!response || !response.success) {
            const error = new Error(response?.error || `Extraction failed for ${scope}`);
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
        const runId = `run-${Date.now()}`;
        const scopeRequest = payload.scope || "all";
        const mode = payload.mode || "full";
        const username = payload.username || "";
        const scopes = scopeRequest === "all" ? ["bookmarks", "likes"] : [scopeRequest];
        const records = [];
        const startedAt = Date.now();
        for (const scope of scopes) {
          const scopeResult = await runScopeExtraction({
            scope,
            username,
            mode,
            runId: `${runId}-${scope}`
          });
          records.push(...scopeResult.records || []);
        }
        const durationMs = Date.now() - startedAt;
        await repository.upsertRecords(records, {
          runId,
          scope: scopeRequest,
          totalCount: records.length,
          durationMs
        });
        const completion = {
          type: MESSAGE_TYPES.EXTRACTION_COMPLETE,
          runId,
          scope: scopeRequest,
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
