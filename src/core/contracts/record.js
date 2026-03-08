const VALID_PLATFORMS = ['x', 'instagram'];
const VALID_TARGETS = ['bookmark', 'like', 'saved'];
const VALID_MEDIA_TYPES = ['photo', 'video', 'gif'];

function toNullableNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeMediaType(value) {
  if (value === 'animated_gif') return 'gif';
  if (value === 'photo' || value === 'video' || value === 'gif') return value;
  return 'photo';
}

function extractXStatusIdFromUrl(url) {
  if (typeof url !== 'string') return null;
  const match = url.match(/\/status\/(\d+)/);
  return match ? match[1] : null;
}

function extractInstagramMediaIdFromUrl(url) {
  if (typeof url !== 'string') return null;
  const match = url.match(/\/(?:p|reel|tv)\/([^/?#]+)/);
  return match ? match[1] : null;
}

function extractRecordIdFromUrl(url, platform = '') {
  if (platform === 'instagram') {
    return extractInstagramMediaIdFromUrl(url);
  }
  return extractXStatusIdFromUrl(url);
}

function normalizeMetrics(metrics = {}) {
  return {
    likes: toNullableNumber(metrics.likes),
    replies: toNullableNumber(metrics.replies),
    views: toNullableNumber(metrics.views),
    shares: toNullableNumber(metrics.shares),
    saves: toNullableNumber(metrics.saves),
    platform: metrics.platform && typeof metrics.platform === 'object'
      ? Object.fromEntries(
          Object.entries(metrics.platform)
            .map(([key, value]) => [key, toNullableNumber(value)])
            .filter(([, value]) => value !== null)
        )
      : {}
  };
}

function buildRecordId(raw) {
  if (raw.id && typeof raw.id === 'string') return raw.id;

  const platform = typeof raw.platform === 'string' ? raw.platform : 'x';
  const urlId = extractRecordIdFromUrl(raw.url, platform);
  if (urlId) {
    return `${platform}:${urlId}`;
  }

  const text = [
    platform,
    raw.target || '',
    raw.url || '',
    raw.text || '',
    raw.author?.username || ''
  ].join('|');
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }
  return `${platform}:fallback-${Math.abs(hash)}`;
}

function normalizeRecord(raw) {
  const author = raw.author || {};
  const media = Array.isArray(raw.media) ? raw.media : [];
  const platform = VALID_PLATFORMS.includes(raw.platform) ? raw.platform : 'x';
  const target = VALID_TARGETS.includes(raw.target)
    ? raw.target
    : (raw.scope === 'like' || raw.scope === 'likes' ? 'like' : 'bookmark');

  return {
    id: buildRecordId({ ...raw, platform, target }),
    platform,
    target,
    url: typeof raw.url === 'string' ? raw.url : '',
    capturedAt: raw.capturedAt || new Date().toISOString(),
    postedAt: raw.postedAt || raw.tweetPostedAt || null,
    author: {
      username: typeof author.username === 'string' ? author.username : '',
      displayName: typeof author.displayName === 'string' ? author.displayName : '',
      userId: typeof author.userId === 'string' ? author.userId : undefined
    },
    text: typeof raw.text === 'string' ? raw.text : '',
    media: media
      .filter((item) => item && typeof item.url === 'string' && item.url)
      .map((item) => ({
        type: normalizeMediaType(item.type),
        url: item.url,
        previewUrl: typeof item.previewUrl === 'string' ? item.previewUrl : undefined,
        durationMs: toNullableNumber(item.durationMs)
      })),
    metrics: normalizeMetrics(raw.metrics || {}),
    source: {
      route: typeof raw.source?.route === 'string' ? raw.source.route : '',
      via: raw.source?.via === 'network' ? 'network' : 'dom'
    },
    meta: raw.meta && typeof raw.meta === 'object' ? raw.meta : {}
  };
}

function validateRecord(record) {
  if (!record || typeof record !== 'object') {
    return { valid: false, error: 'Record must be an object' };
  }

  if (!record.id || typeof record.id !== 'string') {
    return { valid: false, error: 'Record id is required' };
  }

  if (!VALID_PLATFORMS.includes(record.platform)) {
    return { valid: false, error: 'Record platform is invalid' };
  }

  if (!VALID_TARGETS.includes(record.target)) {
    return { valid: false, error: 'Record target is invalid' };
  }

  if (!record.url || typeof record.url !== 'string') {
    return { valid: false, error: 'Record url is required' };
  }

  if (!record.author || typeof record.author !== 'object') {
    return { valid: false, error: 'Record author is required' };
  }

  if (!Array.isArray(record.media)) {
    return { valid: false, error: 'Record media must be an array' };
  }

  if (record.media.some((item) => !VALID_MEDIA_TYPES.includes(item.type))) {
    return { valid: false, error: 'Record media type is invalid' };
  }

  return { valid: true, value: record };
}

module.exports = {
  VALID_PLATFORMS,
  VALID_TARGETS,
  VALID_MEDIA_TYPES,
  normalizeRecord,
  validateRecord,
  normalizeMediaType,
  toNullableNumber,
  extractXStatusIdFromUrl,
  extractInstagramMediaIdFromUrl,
  extractRecordIdFromUrl,
  normalizeTweetRecord: normalizeRecord,
  validateTweetRecordV2: validateRecord,
  extractTweetIdFromUrl: extractXStatusIdFromUrl
};
