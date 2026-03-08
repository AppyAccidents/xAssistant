const { xAdapter } = require('./x.js');
const { instagramAdapter } = require('./instagram.js');

const PLATFORM_ADAPTERS = {
  x: xAdapter,
  instagram: instagramAdapter
};

function getPlatformAdapter(platform) {
  return PLATFORM_ADAPTERS[platform] || null;
}

function listPlatformAdapters() {
  return Object.values(PLATFORM_ADAPTERS);
}

function expandExtractionTargets(platform, target) {
  const adapter = getPlatformAdapter(platform);
  if (!adapter) return [];
  if (target === 'all') {
    return adapter.getAllTargets();
  }
  return adapter.supportedTargets.includes(target) ? [target] : [];
}

function detectContextFromUrl(url = '') {
  if (/instagram\.com/i.test(url)) {
    const adapter = getPlatformAdapter('instagram');
    return {
      platform: 'instagram',
      target: adapter.detectTargetFromUrl(url)
    };
  }

  if (/(?:^|\/\/)(?:www\.)?(?:x\.com|twitter\.com)/i.test(url)) {
    const adapter = getPlatformAdapter('x');
    return {
      platform: 'x',
      target: adapter.detectTargetFromUrl(url)
    };
  }

  return {
    platform: 'unknown',
    target: 'unknown'
  };
}

module.exports = {
  PLATFORM_ADAPTERS,
  getPlatformAdapter,
  listPlatformAdapters,
  expandExtractionTargets,
  detectContextFromUrl
};
