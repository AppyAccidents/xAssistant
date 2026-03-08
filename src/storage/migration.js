const {
  STATE_KEY,
  STORAGE_VERSION,
  getDefaultState,
  normalizeRecord,
  normalizeSettings,
  extractXStatusIdFromUrl
} = require('../core/contracts/index.js');

function inferTargetFromLegacyBookmark(bookmark) {
  if (bookmark.scope === 'like') return 'like';
  return 'bookmark';
}

function legacyBookmarkToRecord(bookmark, target = 'bookmark') {
  const id = extractXStatusIdFromUrl(bookmark.url || '') || bookmark.id || `legacy-${Math.random().toString(16).slice(2)}`;
  return normalizeRecord({
    id: `x:${id}`,
    platform: 'x',
    target,
    url: bookmark.url || '',
    capturedAt: bookmark.savedAt || bookmark.dateTime || new Date().toISOString(),
    postedAt: bookmark.dateTime || null,
    author: {
      username: bookmark.username || '',
      displayName: bookmark.displayName || ''
    },
    text: bookmark.text || '',
    media: Array.isArray(bookmark.media)
      ? bookmark.media.map((item) => ({
          type: item.type || 'photo',
          url: item.url || item.media_url_https || '',
          previewUrl: item.media_url_https || undefined
        }))
      : [],
    metrics: {
      likes: bookmark.likes,
      replies: bookmark.replies,
      views: bookmark.views,
      platform: {
        retweets: bookmark.retweets
      }
    },
    source: {
      route: target === 'bookmark' ? '/i/bookmarks' : '/likes',
      via: bookmark.source === 'manual' ? 'dom' : 'network'
    }
  });
}

function migrateStoredV2State(storedState) {
  const state = getDefaultState();
  state.recordsById = {};

  Object.values(storedState.recordsById || {}).forEach((legacyRecord) => {
    const normalized = normalizeRecord({
      ...legacyRecord,
      platform: 'x',
      target: legacyRecord.scope === 'like' ? 'like' : 'bookmark',
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

  state.recordOrder = Object.values(state.recordsById)
    .sort((a, b) => new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime())
    .map((record) => record.id);

  state.settings = normalizeSettings({
    username: storedState.settings?.username || '',
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
      recordsById: storedState.recordsById && typeof storedState.recordsById === 'object'
        ? storedState.recordsById
        : {},
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

  const mapped = legacyBookmarks
    .filter((bookmark) => bookmark && bookmark.url)
    .map((bookmark) => legacyBookmarkToRecord(bookmark, inferTargetFromLegacyBookmark(bookmark)));

  for (const record of mapped) {
    state.recordsById[record.id] = record;
  }

  state.recordOrder = Object.values(state.recordsById)
    .sort((a, b) => new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime())
    .map((record) => record.id);

  state.runs.push({
    runId: `migration-${Date.now()}`,
    platform: 'all',
    target: 'all',
    totalCount: state.recordOrder.length,
    durationMs: 0,
    createdAt: new Date().toISOString()
  });

  return state;
}

module.exports = {
  migrateLegacyStorage,
  legacyBookmarkToRecord
};
