const { normalizeTweetRecord } = require('../core/contracts/record.js');
const { scopeToRecordScope } = require('./route-detector.js');

function normalizeExtractedTweet(rawTweet, scope, sourceMeta = {}) {
  return normalizeTweetRecord({
    ...rawTweet,
    scope: scopeToRecordScope(scope),
    source: {
      route: sourceMeta.route || '',
      via: sourceMeta.via || 'dom'
    }
  });
}

function dedupeRecords(records) {
  const byId = new Map();
  for (const record of records) {
    byId.set(record.id, record);
  }
  return Array.from(byId.values());
}

module.exports = {
  normalizeExtractedTweet,
  dedupeRecords
};
