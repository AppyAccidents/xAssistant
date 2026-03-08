const {
  STATE_KEY,
  STORAGE_VERSION,
  getDefaultState,
  validateStorageState,
  normalizeSettings,
  normalizeRecord,
  validateRecord
} = require('../core/contracts/index.js');
const { migrateLegacyStorage } = require('./migration.js');

class StorageRepository {
  constructor(storageArea) {
    this.storage = storageArea || chrome.storage.local;
  }

  async ensureInitialized() {
    const result = await this.storage.get([STATE_KEY, 'lastExtraction', 'manualBookmarks']);
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
        ...(partialSettings.settingsByPlatform || {})
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
      if (!validation.valid) continue;

      const existing = state.recordsById[normalized.id];
      state.recordsById[normalized.id] = existing
        ? { ...existing, ...normalized }
        : normalized;
      changed += 1;
    }

    state.recordOrder = Object.values(state.recordsById)
      .sort((a, b) => new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime())
      .map((record) => record.id);

    if (runMeta) {
      state.runs.unshift({
        runId: runMeta.runId || `run-${Date.now()}`,
        platform: runMeta.platform || 'all',
        target: runMeta.target || 'all',
        totalCount: typeof runMeta.totalCount === 'number' ? runMeta.totalCount : records.length,
        durationMs: typeof runMeta.durationMs === 'number' ? runMeta.durationMs : 0,
        createdAt: new Date().toISOString()
      });
      state.runs = state.runs.slice(0, 100);
    }

    await this.saveState(state);
    return { changed, total: state.recordOrder.length };
  }

  async queryRecords({ platform = 'all', target = 'all', filter = {}, sort = 'capturedAt:desc', page = {} } = {}) {
    const state = await this.loadState();

    let records = state.recordOrder
      .map((id) => state.recordsById[id])
      .filter(Boolean);

    if (platform !== 'all') {
      records = records.filter((record) => record.platform === platform);
    }

    if (target !== 'all') {
      records = records.filter((record) => record.target === target);
    }

    if (filter.search && typeof filter.search === 'string') {
      const query = filter.search.trim().toLowerCase();
      if (query) {
        records = records.filter((record) => {
          return (
            record.text.toLowerCase().includes(query) ||
            record.author.username.toLowerCase().includes(query) ||
            record.author.displayName.toLowerCase().includes(query)
          );
        });
      }
    }

    if (sort === 'capturedAt:asc') {
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
}

module.exports = {
  StorageRepository,
  STATE_KEY,
  getDefaultState
};
