const EXTRACTION_SCOPES = ['bookmarks', 'likes'];
const QUERY_SCOPES = ['bookmarks', 'likes', 'all'];
const EXTRACTION_MODES = ['full', 'visible'];

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

function validateExtractionStart(payload) {
  if (!isPlainObject(payload)) {
    return { valid: false, error: 'Payload must be an object' };
  }

  if (!EXTRACTION_SCOPES.includes(payload.scope)) {
    return { valid: false, error: 'scope must be bookmarks or likes' };
  }

  const mode = payload.mode || 'full';
  if (!EXTRACTION_MODES.includes(mode)) {
    return { valid: false, error: 'mode must be full or visible' };
  }

  return {
    valid: true,
    value: {
      scope: payload.scope,
      mode,
      runId: typeof payload.runId === 'string' ? payload.runId : `run-${Date.now()}`
    }
  };
}

function validateDataQuery(payload) {
  if (!isPlainObject(payload)) {
    return { valid: false, error: 'Payload must be an object' };
  }

  const scope = payload.scope || 'all';
  if (!QUERY_SCOPES.includes(scope)) {
    return { valid: false, error: 'scope must be bookmarks, likes, or all' };
  }

  const filter = isPlainObject(payload.filter) ? payload.filter : {};
  const sort = typeof payload.sort === 'string' ? payload.sort : 'capturedAt:desc';

  const page = isPlainObject(payload.page) ? payload.page : {};
  const offset = Number.isInteger(page.offset) && page.offset >= 0 ? page.offset : 0;
  const limit = Number.isInteger(page.limit) && page.limit > 0 ? page.limit : 5000;

  return {
    valid: true,
    value: {
      scope,
      filter,
      sort,
      page: { offset, limit }
    }
  };
}

module.exports = {
  MESSAGE_TYPES,
  EXTRACTION_SCOPES,
  QUERY_SCOPES,
  EXTRACTION_MODES,
  validateExtractionStart,
  validateDataQuery,
  isPlainObject
};
