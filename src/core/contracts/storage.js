const STORAGE_VERSION = 3;
const STATE_KEY = 'xAssistantState';
const ONBOARDING_GUIDE_VERSION = 2;

function normalizePlatformSettings(platform, settings = {}) {
  if (platform === 'x') {
    return {
      username: typeof settings.username === 'string' ? settings.username : ''
    };
  }

  if (platform === 'instagram') {
    return {
      username: typeof settings.username === 'string' ? settings.username : ''
    };
  }

  return {};
}

function normalizeSettings(settings = {}) {
  const settingsByPlatform = settings.settingsByPlatform && typeof settings.settingsByPlatform === 'object'
    ? settings.settingsByPlatform
    : {};

  return {
    onboardingSeen: settings.onboardingSeen === true,
    guideVersion: Number.isInteger(settings.guideVersion)
      ? settings.guideVersion
      : ONBOARDING_GUIDE_VERSION,
    selectedPlatform: settings.selectedPlatform === 'instagram' ? 'instagram' : 'x',
    selectedTarget: typeof settings.selectedTarget === 'string' ? settings.selectedTarget : 'all',
    settingsByPlatform: {
      x: normalizePlatformSettings('x', settingsByPlatform.x || settings),
      instagram: normalizePlatformSettings('instagram', settingsByPlatform.instagram || {})
    }
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

function validateStorageState(state) {
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

  if (!state.settings.settingsByPlatform || typeof state.settings.settingsByPlatform !== 'object') {
    return { valid: false, error: 'settingsByPlatform must be an object' };
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
  normalizePlatformSettings,
  getDefaultState,
  validateStorageState,
  validateStorageStateV2: validateStorageState
};
