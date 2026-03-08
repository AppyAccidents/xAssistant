const { normalizeRecord } = require('../core/contracts/record.js');

function normalizeExtractedRecord(rawRecord, sourceMeta = {}) {
  return normalizeRecord({
    ...rawRecord,
    source: {
      route: sourceMeta.route || rawRecord.source?.route || '',
      via: sourceMeta.via || rawRecord.source?.via || 'dom'
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
  normalizeExtractedRecord,
  dedupeRecords,
  normalizeExtractedTweet: normalizeExtractedRecord
};
