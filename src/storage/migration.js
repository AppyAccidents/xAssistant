const {
  STORAGE_VERSION,
  getDefaultState,
  normalizeTweetRecord,
  normalizeSettings,
  extractTweetIdFromUrl
} = require('../core/contracts/index.js');

function inferScopeFromLegacyBookmark(bookmark) {
  if (bookmark.source === 'manual' || bookmark.scope === 'bookmark') {
    return 'bookmark';
  }
  return 'bookmark';
}

function legacyBookmarkToRecord(bookmark, scope = 'bookmark') {
  const id = extractTweetIdFromUrl(bookmark.url || '') || bookmark.id || `legacy-${Math.random().toString(16).slice(2)}`;
  return normalizeTweetRecord({
    id,
    url: bookmark.url || '',
    scope,
    capturedAt: bookmark.savedAt || bookmark.dateTime || new Date().toISOString(),
    tweetPostedAt: bookmark.dateTime || null,
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
      retweets: bookmark.retweets,
      replies: bookmark.replies,
      views: bookmark.views
    },
    source: {
      route: '/i/bookmarks',
      via: bookmark.source === 'manual' ? 'dom' : 'network'
    }
  });
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

  const legacyBookmarks = [];
  if (rawStorage.lastExtraction && Array.isArray(rawStorage.lastExtraction.bookmarks)) {
    legacyBookmarks.push(...rawStorage.lastExtraction.bookmarks);
  }

  if (Array.isArray(rawStorage.manualBookmarks)) {
    legacyBookmarks.push(...rawStorage.manualBookmarks);
  }

  const mapped = legacyBookmarks
    .filter((bookmark) => bookmark && bookmark.url)
    .map((bookmark) => legacyBookmarkToRecord(bookmark, inferScopeFromLegacyBookmark(bookmark)));

  for (const record of mapped) {
    state.recordsById[record.id] = record;
  }

  state.recordOrder = Object.values(state.recordsById)
    .sort((a, b) => new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime())
    .map((record) => record.id);

  state.runs.push({
    runId: `migration-${Date.now()}`,
    scope: 'all',
    totalCount: state.recordOrder.length,
    durationMs: 0,
    createdAt: new Date().toISOString()
  });

  return state;
}

const { STATE_KEY } = require('../core/contracts/storage.js');

module.exports = {
  migrateLegacyStorage,
  legacyBookmarkToRecord
};
