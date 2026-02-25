const { detectScopeFromUrl } = require('./route-detector.js');
const { parseVisibleArticles } = require('./parser-dom.js');
const { normalizeExtractedTweet, dedupeRecords } = require('./normalizer.js');

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class ExtractionEngine {
  constructor(options = {}) {
    this.scrollDelay = options.scrollDelay || 1200;
    this.maxLoops = options.maxLoops || 80;
    this.stableLoops = options.stableLoops || 3;
  }

  collectOnce(scope, route, networkRecords = []) {
    const domSnapshot = parseVisibleArticles(scope, route);
    const all = [
      ...domSnapshot.records.map((record) => normalizeExtractedTweet(record, scope, { route, via: 'dom' })),
      ...networkRecords
        .filter((record) => {
          return scope === 'bookmarks' ? record.scope === 'bookmark' : record.scope === 'like';
        })
        .map((record) => normalizeExtractedTweet(record, scope, { route, via: 'network' }))
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
      error.code = 'ROUTE_MISMATCH';
      throw error;
    }

    let merged = new Map();
    let scannedCount = 0;

    const pushRecords = (records) => {
      for (const record of records) {
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
}

module.exports = {
  ExtractionEngine
};
