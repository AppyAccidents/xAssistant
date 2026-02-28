const STORAGE_VERSION = 2;
const STATE_KEY = 'xAssistantState';
const ONBOARDING_GUIDE_VERSION = 1;

function normalizeSettings(settings = {}) {
  return {
    username: typeof settings.username === 'string' ? settings.username : '',
    onboardingSeen: settings.onboardingSeen === true,
    guideVersion: Number.isInteger(settings.guideVersion)
      ? settings.guideVersion
      : ONBOARDING_GUIDE_VERSION
  };
}

function getDefaultState() {
  return {
    storageVersion: STORAGE_VERSION,
    recordsById: {},
    recordOrder: [],
    settings: normalizeSettings(),
    runs: []
  };
}

function validateStorageStateV2(state) {
  if (!state || typeof state !== 'object') {
    return { valid: false, error: 'State must be an object' };
  }

  if (state.storageVersion !== STORAGE_VERSION) {
    return { valid: false, error: 'State version is invalid' };
  }

  if (!state.recordsById || typeof state.recordsById !== 'object') {
    return { valid: false, error: 'recordsById must be an object' };
  }

  if (!Array.isArray(state.recordOrder)) {
    return { valid: false, error: 'recordOrder must be an array' };
  }

  if (!state.settings || typeof state.settings !== 'object') {
    return { valid: false, error: 'settings must be an object' };
  }

  if (typeof state.settings.username !== 'string') {
    return { valid: false, error: 'settings.username must be a string' };
  }

  if (typeof state.settings.onboardingSeen !== 'boolean') {
    return { valid: false, error: 'settings.onboardingSeen must be a boolean' };
  }

  if (!Number.isInteger(state.settings.guideVersion)) {
    return { valid: false, error: 'settings.guideVersion must be an integer' };
  }

  if (!Array.isArray(state.runs)) {
    return { valid: false, error: 'runs must be an array' };
  }

  return { valid: true, value: state };
}

module.exports = {
  STORAGE_VERSION,
  STATE_KEY,
  ONBOARDING_GUIDE_VERSION,
  normalizeSettings,
  getDefaultState,
  validateStorageStateV2
};
