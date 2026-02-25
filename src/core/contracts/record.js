const VALID_SCOPE_VALUES = ['bookmark', 'like'];
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

function extractTweetIdFromUrl(url) {
  if (typeof url !== 'string') return null;
  const match = url.match(/\/status\/(\d+)/);
  return match ? match[1] : null;
}

function buildRecordId(raw) {
  if (raw.id && typeof raw.id === 'string') return raw.id;
  const idFromUrl = extractTweetIdFromUrl(raw.url);
  if (idFromUrl) return idFromUrl;

  const text = `${raw.url || ''}|${raw.text || ''}|${raw.author?.username || ''}`;
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }
  return `fallback-${Math.abs(hash)}`;
}

function normalizeTweetRecord(raw) {
  const scope = raw.scope === 'likes' || raw.scope === 'like' ? 'like' : 'bookmark';
  const author = raw.author || {};
  const media = Array.isArray(raw.media) ? raw.media : [];
  const metrics = raw.metrics || {};

  return {
    id: buildRecordId(raw),
    url: typeof raw.url === 'string' ? raw.url : '',
    scope,
    capturedAt: raw.capturedAt || new Date().toISOString(),
    tweetPostedAt: raw.tweetPostedAt || null,
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
    metrics: {
      likes: toNullableNumber(metrics.likes),
      retweets: toNullableNumber(metrics.retweets),
      replies: toNullableNumber(metrics.replies),
      views: toNullableNumber(metrics.views)
    },
    source: {
      route: typeof raw.source?.route === 'string' ? raw.source.route : '',
      via: raw.source?.via === 'network' ? 'network' : 'dom'
    },
    ai: raw.ai && typeof raw.ai === 'object'
      ? {
          categories: Array.isArray(raw.ai.categories) ? raw.ai.categories.filter(Boolean) : [],
          tags: Array.isArray(raw.ai.tags) ? raw.ai.tags.filter(Boolean) : [],
          confidence: typeof raw.ai.confidence === 'number' ? raw.ai.confidence : 0,
          rationale: typeof raw.ai.rationale === 'string' ? raw.ai.rationale : ''
        }
      : undefined
  };
}

function validateTweetRecordV2(record) {
  if (!record || typeof record !== 'object') {
    return { valid: false, error: 'Record must be an object' };
  }

  if (!record.id || typeof record.id !== 'string') {
    return { valid: false, error: 'Record id is required' };
  }

  if (!record.url || typeof record.url !== 'string') {
    return { valid: false, error: 'Record url is required' };
  }

  if (!VALID_SCOPE_VALUES.includes(record.scope)) {
    return { valid: false, error: 'Record scope must be bookmark or like' };
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
  VALID_SCOPE_VALUES,
  VALID_MEDIA_TYPES,
  extractTweetIdFromUrl,
  normalizeTweetRecord,
  validateTweetRecordV2,
  normalizeMediaType,
  toNullableNumber
};
