const { detectContextFromUrl } = require('./route-detector.js');
const { getPlatformAdapter } = require('../platforms/index.js');
const { normalizeExtractedRecord, dedupeRecords } = require('./normalizer.js');

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class ExtractionEngine {
  constructor(options = {}) {
    this.scrollDelay = options.scrollDelay || 1200;
    this.maxLoops = options.maxLoops || 80;
    this.stableLoops = options.stableLoops || 3;
  }

  collectOnce(platform, target, route, networkRecords = []) {
    const adapter = getPlatformAdapter(platform);
    const domSnapshot = adapter ? adapter.parseDom(target, route) : { scannedCount: 0, records: [] };
    const all = [
      ...domSnapshot.records.map((record) => normalizeExtractedRecord(record, { route, via: 'dom' })),
      ...networkRecords.map((record) => normalizeExtractedRecord(record, { route, via: record.source?.via || 'network' }))
    ];

    return {
      scannedCount: domSnapshot.scannedCount,
      records: dedupeRecords(all)
    };
  }

  async extract({ platform, target, mode, runId, input = {}, getNetworkRecords, onProgress, isCancelled }) {
    const startedAt = Date.now();
    const route = window.location.pathname;
    const detected = detectContextFromUrl(window.location.href);
    const adapter = getPlatformAdapter(platform);

    if (!adapter) {
      const error = new Error(`Unsupported platform: ${platform}`);
      error.code = 'UNSUPPORTED_PLATFORM';
      throw error;
    }

    if (detected.platform !== platform || detected.target !== target) {
      const error = new Error(`Route mismatch: expected ${platform}/${target}, got ${detected.platform}/${detected.target}`);
      error.code = 'ROUTE_MISMATCH';
      throw error;
    }

    const networkSeen = new Set();
    const merged = new Map();
    let scannedCount = 0;

    const pushRecords = (records) => {
      for (const record of records) {
        merged.set(record.id, record);
      }
    };

    const getFreshNetworkRecords = () => {
      const incoming = Array.isArray(getNetworkRecords?.()) ? getNetworkRecords() : [];
      const fresh = incoming.filter((record) => {
        const key = record.id || record.url;
        if (!key || networkSeen.has(key)) return false;
        networkSeen.add(key);
        return true;
      });
      return fresh.filter((record) => record.platform === platform && record.target === target);
    };

    const runCollect = () => {
      const snapshot = this.collectOnce(platform, target, route, getFreshNetworkRecords());
      scannedCount += snapshot.scannedCount;
      pushRecords(snapshot.records);
      return snapshot;
    };

    const emitStatus = (status) => {
      if (typeof onProgress === 'function' && status) {
        onProgress({
          type: 'EXTRACTION_PROGRESS',
          runId,
          platform,
          target,
          scannedCount,
          capturedCount: merged.size,
          cursorState: { loop: 0, stableCount: 0 },
          status
        });
      }
    };

    if (typeof adapter.waitForReady === 'function') {
      await adapter.waitForReady(target, { input, onProgress: emitStatus });
    }

    if (typeof adapter.preparePage === 'function') {
      await adapter.preparePage(target, { input, onProgress: emitStatus });
    }

    if (typeof adapter.waitForReady === 'function') {
      await adapter.waitForReady(target, { input, onProgress: emitStatus });
    }

    runCollect();

    if (mode === 'full') {
      let lastHeight = 0;
      let stableCount = 0;
      let loop = 0;

      while (loop < this.maxLoops && stableCount < this.stableLoops) {
        if (isCancelled()) {
          const error = new Error('Extraction cancelled');
          error.code = 'CANCELLED';
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
        if (typeof onProgress === 'function') {
          onProgress({
            type: 'EXTRACTION_PROGRESS',
            runId,
            platform,
            target,
            scannedCount,
            capturedCount: merged.size,
            cursorState: { loop, stableCount },
            status: adapter.getProgressLabel(target)
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
      platform,
      target,
      route,
      scannedCount,
      records,
      totalCount: records.length,
      durationMs: Date.now() - startedAt
    };
  }
}

module.exports = {
  ExtractionEngine
};
