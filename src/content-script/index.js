const {
  MESSAGE_TYPES,
  validateExtractionStart
} = require('../core/contracts/messages.js');
const {
  ExtractionEngine,
  BoundedMap,
  detectContextFromUrl
} = require('../extraction/index.js');
const { getPlatformAdapter } = require('../platforms/index.js');

class XAssistantContentScript {
  constructor() {
    this.engine = new ExtractionEngine();
    this.networkCaches = {
      x: {
        bookmark: new BoundedMap(5000),
        like: new BoundedMap(5000)
      },
      instagram: {
        saved: new BoundedMap(3000)
      }
    };
    this.runTokens = new Map();

    this.installInjectedInterceptor();
    this.setupNetworkListener();
    this.setupRuntimeListener();
  }

  installInjectedInterceptor() {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('dist/injected.js');
    script.onload = function cleanup() {
      this.remove();
    };
    (document.head || document.documentElement).appendChild(script);
  }

  getNetworkRecords(platform, target) {
    const cache = this.networkCaches[platform]?.[target];
    return cache ? cache.values() : [];
  }

  setupNetworkListener() {
    window.addEventListener('x-assistant-network', (event) => {
      const detail = event.detail || {};
      if (!detail.payload) return;

      const context = detectContextFromUrl(window.location.href);
      const adapter = getPlatformAdapter(context.platform);
      if (!adapter || typeof adapter.parseNetwork !== 'function') return;

      const parsed = adapter.parseNetwork(detail.payload, detail.url || '');
      parsed.forEach((record) => {
        const cache = this.networkCaches[record.platform]?.[record.target];
        if (cache) {
          cache.set(record.id, record);
        }
      });

      chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.EXTRACTION_PROGRESS,
        platform: context.platform,
        target: context.target,
        scannedCount: 0,
        capturedCount: parsed.length,
        cursorState: { loop: 0, stableCount: 0 },
        status: parsed.length > 0 ? `Network captured ${parsed.length} items` : 'Listening for network records...',
        __relay: false
      }).catch(() => {});
    });
  }

  setupRuntimeListener() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (!message || typeof message !== 'object') return;

      if (message.type === MESSAGE_TYPES.EXTRACTION_START) {
        this.handleExtractionStart(message.payload)
          .then((result) => sendResponse({ success: true, ...result }))
          .catch((error) => sendResponse({ success: false, error: error.message, code: error.code || 'EXTRACTION_FAILED' }));
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
      error.code = 'INVALID_REQUEST';
      throw error;
    }

      const { platform, target, mode, runId, input } = validation.value;
    const token = { cancelled: false };
    this.runTokens.set(runId, token);

    try {
      const result = await this.engine.extract({
        platform,
        target,
        mode,
        runId,
        input,
        getNetworkRecords: () => this.getNetworkRecords(platform, target),
        isCancelled: () => token.cancelled,
        onProgress: (progress) => {
          chrome.runtime.sendMessage({ ...progress, __relay: false }).catch(() => {});
        }
      });

      const completion = {
        type: MESSAGE_TYPES.EXTRACTION_COMPLETE,
        runId: result.runId,
        platform: result.platform,
        target: result.target,
        totalCount: result.totalCount,
        durationMs: result.durationMs,
        records: result.records,
        __relay: false
      };

      chrome.runtime.sendMessage(completion).catch(() => {});
      return completion;
    } catch (error) {
      const failure = {
        type: MESSAGE_TYPES.EXTRACTION_ERROR,
        runId,
        platform,
        target,
        code: error.code || 'EXTRACTION_FAILED',
        message: error.message,
        recoverable: error.code !== 'ROUTE_MISMATCH',
        __relay: false
      };

      chrome.runtime.sendMessage(failure).catch(() => {});
      throw error;
    } finally {
      this.runTokens.delete(runId);
    }
  }
}

new XAssistantContentScript();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { XAssistantContentScript };
}
