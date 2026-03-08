const EXTRACTION_MODES = ['full', 'visible'];
const EXTRACTION_TARGETS = {
  x: ['bookmark', 'like', 'all'],
  instagram: ['saved', 'all']
};
const QUERY_PLATFORMS = ['x', 'instagram', 'all'];
const QUERY_TARGETS = ['bookmark', 'like', 'saved', 'all'];

const MESSAGE_TYPES = {
  EXTRACTION_START: 'EXTRACTION_START',
  EXTRACTION_PROGRESS: 'EXTRACTION_PROGRESS',
  EXTRACTION_COMPLETE: 'EXTRACTION_COMPLETE',
  EXTRACTION_ERROR: 'EXTRACTION_ERROR',
  EXTRACTION_CANCEL: 'EXTRACTION_CANCEL',
  DATA_QUERY: 'DATA_QUERY',
  XA_START_EXTRACTION: 'XA_START_EXTRACTION',
  XA_GET_SETTINGS: 'XA_GET_SETTINGS',
  XA_SAVE_SETTINGS: 'XA_SAVE_SETTINGS'
};

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function getSupportedTargets(platform) {
  return EXTRACTION_TARGETS[platform] || [];
}

function validateExtractionStart(payload) {
  if (!isPlainObject(payload)) {
    return { valid: false, error: 'Payload must be an object' };
  }

  const platform = payload.platform === 'instagram' ? 'instagram' : payload.platform === 'x' ? 'x' : '';
  if (!platform) {
    return { valid: false, error: 'platform must be x or instagram' };
  }

  const supportedTargets = getSupportedTargets(platform);
  const target = typeof payload.target === 'string' ? payload.target : '';
  if (!supportedTargets.includes(target)) {
    return { valid: false, error: `target must be one of: ${supportedTargets.join(', ')}` };
  }

  const mode = payload.mode || 'full';
  if (!EXTRACTION_MODES.includes(mode)) {
    return { valid: false, error: 'mode must be full or visible' };
  }

  const input = isPlainObject(payload.input) ? payload.input : {};

  return {
    valid: true,
    value: {
      platform,
      target,
      mode,
      input,
      runId: typeof payload.runId === 'string' ? payload.runId : `run-${Date.now()}`
    }
  };
}

function validateDataQuery(payload) {
  if (!isPlainObject(payload)) {
    return { valid: false, error: 'Payload must be an object' };
  }

  const platform = payload.platform || 'all';
  if (!QUERY_PLATFORMS.includes(platform)) {
    return { valid: false, error: 'platform must be x, instagram, or all' };
  }

  const target = payload.target || 'all';
  if (!QUERY_TARGETS.includes(target)) {
    return { valid: false, error: 'target must be bookmark, like, saved, or all' };
  }

  const filter = isPlainObject(payload.filter) ? payload.filter : {};
  const sort = typeof payload.sort === 'string' ? payload.sort : 'capturedAt:desc';
  const page = isPlainObject(payload.page) ? payload.page : {};
  const offset = Number.isInteger(page.offset) && page.offset >= 0 ? page.offset : 0;
  const limit = Number.isInteger(page.limit) && page.limit > 0 ? page.limit : 5000;

  return {
    valid: true,
    value: {
      platform,
      target,
      filter,
      sort,
      page: { offset, limit }
    }
  };
}

module.exports = {
  MESSAGE_TYPES,
  EXTRACTION_MODES,
  EXTRACTION_TARGETS,
  QUERY_PLATFORMS,
  QUERY_TARGETS,
  validateExtractionStart,
  validateDataQuery,
  getSupportedTargets,
  isPlainObject
};
