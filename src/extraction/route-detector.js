const { getPlatformAdapter, detectContextFromUrl } = require('../platforms/index.js');

function detectTargetFromUrl(url = '', platform = 'x') {
  const adapter = getPlatformAdapter(platform);
  return adapter ? adapter.detectTargetFromUrl(url) : 'unknown';
}

function getTargetUrl(platform, target, input = {}) {
  const adapter = getPlatformAdapter(platform);
  if (!adapter) {
    throw new Error(`Unsupported platform: ${platform}`);
  }
  return adapter.getRouteUrl(target, input);
}

function endpointTargetHint(url = '', platform = 'x') {
  const adapter = getPlatformAdapter(platform);
  return adapter ? adapter.getEndpointHint(url) : 'unknown';
}

module.exports = {
  detectTargetFromUrl,
  getTargetUrl,
  endpointTargetHint,
  detectContextFromUrl
};
