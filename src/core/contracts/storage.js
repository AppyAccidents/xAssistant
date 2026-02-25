const STORAGE_VERSION = 2;
const STATE_KEY = 'xAssistantState';

function getDefaultState() {
  return {
    storageVersion: STORAGE_VERSION,
    recordsById: {},
    recordOrder: [],
    settings: {
      username: ''
    },
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

  if (!Array.isArray(state.runs)) {
    return { valid: false, error: 'runs must be an array' };
  }

  return { valid: true, value: state };
}

module.exports = {
  STORAGE_VERSION,
  STATE_KEY,
  getDefaultState,
  validateStorageStateV2
};
