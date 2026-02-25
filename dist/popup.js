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

  // src/export/index.js
  var require_export = __commonJS({
    "src/export/index.js"(exports, module) {
      function filterByScope(records, scope = "all") {
        if (scope === "bookmarks")
          return records.filter((record) => record.scope === "bookmark");
        if (scope === "likes")
          return records.filter((record) => record.scope === "like");
        return records;
      }
      function escapeCSV(value) {
        if (value === null || value === void 0)
          return "";
        const str = String(value).replace(/\n/g, " ");
        if (/[",]/.test(str)) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      }
      function mediaUrls(record) {
        return (record.media || []).map((item) => item.url).filter(Boolean).join("; ");
      }
      function displayName(record) {
        return record.author?.displayName || "";
      }
      function username(record) {
        return record.author?.username || "";
      }
      function generateJSONExport(records, { scope = "all" } = {}) {
        const selected = filterByScope(records, scope);
        return {
          metadata: {
            scope,
            exportedAt: (/* @__PURE__ */ new Date()).toISOString(),
            totalRecords: selected.length,
            schemaVersion: 2
          },
          records: selected
        };
      }
      function generateCSVExport(records, { scope = "all" } = {}) {
        const selected = filterByScope(records, scope);
        const header = [
          "id",
          "scope",
          "tweetPostedAt",
          "capturedAt",
          "authorDisplayName",
          "authorUsername",
          "text",
          "mediaUrls",
          "likes",
          "retweets",
          "replies",
          "views",
          "url"
        ];
        const rows = [header.join(",")];
        selected.forEach((record) => {
          rows.push([
            escapeCSV(record.id),
            escapeCSV(record.scope),
            escapeCSV(record.tweetPostedAt || ""),
            escapeCSV(record.capturedAt || ""),
            escapeCSV(displayName(record)),
            escapeCSV(username(record)),
            escapeCSV(record.text || ""),
            escapeCSV(mediaUrls(record)),
            escapeCSV(record.metrics?.likes ?? ""),
            escapeCSV(record.metrics?.retweets ?? ""),
            escapeCSV(record.metrics?.replies ?? ""),
            escapeCSV(record.metrics?.views ?? ""),
            escapeCSV(record.url || "")
          ].join(","));
        });
        return rows.join("\n");
      }
      function generateMarkdownExport(records, { scope = "all" } = {}) {
        const selected = filterByScope(records, scope);
        const lines = [];
        lines.push("# X-Assistant Report");
        lines.push("");
        lines.push(`- Scope: ${scope}`);
        lines.push(`- Exported: ${(/* @__PURE__ */ new Date()).toISOString()}`);
        lines.push(`- Total: ${selected.length}`);
        lines.push("");
        selected.forEach((record, index) => {
          const name = displayName(record) || "Unknown";
          const user = username(record) || "unknown";
          const postedAt = record.tweetPostedAt || "N/A";
          const capturedAt = record.capturedAt || "N/A";
          const text = record.text || "(No text)";
          const media = mediaUrls(record) || "None";
          lines.push(`## ${index + 1}. ${name} (@${user})`);
          lines.push(`- Scope: ${record.scope || "unknown"}`);
          lines.push(`- Tweet Time: ${postedAt}`);
          lines.push(`- Captured At: ${capturedAt}`);
          lines.push(`- URL: ${record.url || ""}`);
          lines.push(`- Text: ${text}`);
          lines.push(`- Media: ${media}`);
          lines.push("");
        });
        return lines.join("\n");
      }
      function generateTextExport(records, { scope = "all" } = {}) {
        const selected = filterByScope(records, scope);
        const lines = [];
        lines.push("X-Assistant Report");
        lines.push(`Scope: ${scope}`);
        lines.push(`Exported: ${(/* @__PURE__ */ new Date()).toISOString()}`);
        lines.push(`Total: ${selected.length}`);
        lines.push("");
        selected.forEach((record, index) => {
          const name = displayName(record) || "Unknown";
          const user = username(record) || "unknown";
          const postedAt = record.tweetPostedAt || "N/A";
          const capturedAt = record.capturedAt || "N/A";
          const text = record.text || "(No text)";
          const media = mediaUrls(record) || "None";
          lines.push(`[${index + 1}] ${String(record.scope || "unknown").toUpperCase()}`);
          lines.push(`Author: ${name} (@${user})`);
          lines.push(`Tweet Time: ${postedAt}`);
          lines.push(`Captured At: ${capturedAt}`);
          lines.push(`URL: ${record.url || ""}`);
          lines.push(`Text: ${text}`);
          lines.push(`Media: ${media}`);
          lines.push("");
        });
        return lines.join("\n");
      }
      module.exports = {
        filterByScope,
        generateJSONExport,
        generateCSVExport,
        generateMarkdownExport,
        generateTextExport,
        escapeCSV
      };
    }
  });

  // src/ui/dom-safe.js
  var require_dom_safe = __commonJS({
    "src/ui/dom-safe.js"(exports, module) {
      function createTextElement(tag, text, className = "") {
        const node = document.createElement(tag);
        if (className)
          node.className = className;
        node.textContent = text;
        return node;
      }
      function downloadTextFile(content, filename, mimeType) {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = filename;
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        URL.revokeObjectURL(url);
      }
      module.exports = {
        createTextElement,
        downloadTextFile
      };
    }
  });

  // src/popup/index.js
  var require_popup = __commonJS({
    "src/popup/index.js"(exports, module) {
      var { MESSAGE_TYPES } = require_messages();
      var {
        generateJSONExport,
        generateCSVExport,
        generateMarkdownExport,
        generateTextExport
      } = require_export();
      var { downloadTextFile } = require_dom_safe();
      function sendRuntimeMessage(message) {
        return new Promise((resolve, reject) => {
          chrome.runtime.sendMessage(message, (response) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
              return;
            }
            resolve(response || {});
          });
        });
      }
      function normalizeUsername(rawValue) {
        return String(rawValue || "").trim().replace(/^@+/, "");
      }
      var PopupApp = class {
        constructor() {
          this.state = {
            settings: {
              username: ""
            },
            progress: 0,
            running: false,
            recordCount: 0
          };
          this.elements = {
            appRoot: document.getElementById("popupRoot"),
            statusText: document.getElementById("statusText"),
            progressBar: document.getElementById("progressBar"),
            progressLabel: document.getElementById("progressLabel"),
            extractBookmarksBtn: document.getElementById("extractBookmarksBtn"),
            extractLikesBtn: document.getElementById("extractLikesBtn"),
            extractBothBtn: document.getElementById("extractBothBtn"),
            usernameInput: document.getElementById("usernameInput"),
            exportFormat: document.getElementById("exportFormat"),
            exportBtn: document.getElementById("exportBtn")
          };
          this.bindEvents();
          this.initialize();
        }
        async initialize() {
          this.setStatus("Loading...", "idle");
          await this.loadSettings();
          await this.refreshRecordCount();
          this.setProgress(0);
          this.setStatus(`Ready (${this.state.recordCount} records)`, "idle");
        }
        bindEvents() {
          this.elements.extractBookmarksBtn.addEventListener("click", () => this.startExtraction("bookmarks"));
          this.elements.extractLikesBtn.addEventListener("click", () => this.startExtraction("likes"));
          this.elements.extractBothBtn.addEventListener("click", () => this.startExtraction("all"));
          this.elements.exportBtn.addEventListener("click", () => this.exportData());
          this.elements.usernameInput.addEventListener("blur", () => this.saveUsername());
          this.elements.usernameInput.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
              this.saveUsername();
            }
          });
          chrome.runtime.onMessage.addListener((message) => {
            if (!message || !message.__relay)
              return;
            this.handleRuntimeEvent(message);
          });
        }
        setStatus(text, tone = "idle") {
          this.elements.statusText.textContent = text;
          this.setAppState(tone);
        }
        setAppState(tone) {
          if (!this.elements.appRoot)
            return;
          this.elements.appRoot.classList.remove("state-idle", "state-running", "state-success", "state-error");
          switch (tone) {
            case "running":
              this.elements.appRoot.classList.add("state-running");
              break;
            case "success":
              this.elements.appRoot.classList.add("state-success");
              break;
            case "error":
              this.elements.appRoot.classList.add("state-error");
              break;
            default:
              this.elements.appRoot.classList.add("state-idle");
              break;
          }
        }
        setProgress(value) {
          const clamped = Math.max(0, Math.min(100, value));
          this.state.progress = clamped;
          this.elements.progressBar.value = clamped;
          this.elements.progressLabel.textContent = `${clamped}%`;
        }
        setRunning(isRunning) {
          this.state.running = isRunning;
          if (isRunning) {
            this.setAppState("running");
          }
          this.elements.extractBookmarksBtn.disabled = isRunning;
          this.elements.extractLikesBtn.disabled = isRunning;
          this.elements.extractBothBtn.disabled = isRunning;
          this.elements.usernameInput.disabled = isRunning;
          this.elements.exportBtn.disabled = isRunning;
        }
        async loadSettings() {
          const response = await sendRuntimeMessage({ type: MESSAGE_TYPES.XA_GET_SETTINGS }).catch(() => ({ success: false }));
          if (response.success && response.settings) {
            this.state.settings.username = normalizeUsername(response.settings.username || "");
          }
          this.elements.usernameInput.value = this.state.settings.username ? `@${this.state.settings.username}` : "";
        }
        async saveUsername(value = this.elements.usernameInput.value) {
          const username = normalizeUsername(value);
          const response = await sendRuntimeMessage({
            type: MESSAGE_TYPES.XA_SAVE_SETTINGS,
            payload: { username }
          }).catch((error) => ({ success: false, error: error.message }));
          if (!response.success) {
            return false;
          }
          this.state.settings.username = username;
          this.elements.usernameInput.value = username ? `@${username}` : "";
          return true;
        }
        async refreshRecordCount() {
          const response = await sendRuntimeMessage({
            type: MESSAGE_TYPES.DATA_QUERY,
            payload: {
              scope: "all",
              page: { offset: 0, limit: 1 }
            }
          }).catch(() => ({ success: false }));
          if (!response.success) {
            return;
          }
          this.state.recordCount = typeof response.total === "number" ? response.total : (response.records || []).length;
        }
        requiresUsername(scope) {
          return scope === "likes" || scope === "all";
        }
        async startExtraction(scope) {
          if (this.state.running)
            return;
          const username = normalizeUsername(this.elements.usernameInput.value);
          if (this.requiresUsername(scope) && !username) {
            this.setStatus("Enter @username for likes extraction", "error");
            return;
          }
          await this.saveUsername(username);
          this.setRunning(true);
          this.setProgress(2);
          this.setStatus(`Starting ${scope} extraction...`, "running");
          const response = await sendRuntimeMessage({
            type: MESSAGE_TYPES.XA_START_EXTRACTION,
            payload: {
              scope,
              mode: "full",
              username
            }
          }).catch((error) => ({ success: false, error: error.message }));
          if (!response.success) {
            this.setStatus(response.error || "Extraction failed", "error");
            this.setRunning(false);
            this.setProgress(0);
            return;
          }
          this.setProgress(100);
          await this.refreshRecordCount();
          this.setStatus(`Extraction complete (${response.totalCount || 0})`, "success");
          this.setRunning(false);
        }
        exportDataForFormat(records, format) {
          if (format === "json") {
            return {
              content: JSON.stringify(generateJSONExport(records, { scope: "all" }), null, 2),
              extension: "json",
              mime: "application/json"
            };
          }
          if (format === "csv") {
            return {
              content: generateCSVExport(records, { scope: "all" }),
              extension: "csv",
              mime: "text/csv"
            };
          }
          if (format === "md") {
            return {
              content: generateMarkdownExport(records, { scope: "all" }),
              extension: "md",
              mime: "text/markdown"
            };
          }
          if (format === "txt") {
            return {
              content: generateTextExport(records, { scope: "all" }),
              extension: "txt",
              mime: "text/plain"
            };
          }
          throw new Error(`Unsupported export format: ${format}`);
        }
        async exportData() {
          if (this.state.running)
            return;
          const response = await sendRuntimeMessage({
            type: MESSAGE_TYPES.DATA_QUERY,
            payload: {
              scope: "all",
              page: { offset: 0, limit: 5e3 }
            }
          }).catch((error) => ({ success: false, error: error.message }));
          if (!response.success) {
            this.setStatus(response.error || "Failed to load records for export", "error");
            return;
          }
          const records = response.records || [];
          if (records.length === 0) {
            this.setStatus("No records to export", "error");
            return;
          }
          const format = this.elements.exportFormat.value;
          const timestamp = Date.now();
          try {
            const output = this.exportDataForFormat(records, format);
            const filename = `x-assistant-report-${timestamp}.${output.extension}`;
            downloadTextFile(output.content, filename, output.mime);
            this.setStatus(`Exported ${records.length} records as ${format.toUpperCase()}`, "success");
          } catch (error) {
            this.setStatus(error.message || "Export failed", "error");
          }
        }
        handleRuntimeEvent(message) {
          if (message.type === MESSAGE_TYPES.EXTRACTION_PROGRESS) {
            const captured = Number(message.capturedCount || 0);
            const scanned = Number(message.scannedCount || 0);
            const denominator = Math.max(scanned, captured, 1);
            const pct = Math.min(95, Math.round(captured / denominator * 100));
            this.setProgress(pct);
            this.setStatus(message.status || "Extraction in progress...", "running");
            return;
          }
          if (message.type === MESSAGE_TYPES.EXTRACTION_ERROR) {
            this.setStatus(message.message || "Extraction failed", "error");
            this.setProgress(0);
            this.setRunning(false);
            return;
          }
          if (message.type === MESSAGE_TYPES.EXTRACTION_COMPLETE) {
            this.setProgress(100);
            this.setStatus(`Extraction complete (${message.totalCount || 0})`, "success");
            this.refreshRecordCount();
            this.setRunning(false);
          }
        }
      };
      document.addEventListener("DOMContentLoaded", () => {
        new PopupApp();
      });
      if (typeof module !== "undefined" && module.exports) {
        module.exports = {
          PopupApp,
          sendRuntimeMessage,
          normalizeUsername
        };
      }
    }
  });
  require_popup();
})();
//# sourceMappingURL=popup.js.map
