const { parseVisibleArticles: parseVisibleXArticles } = require('../extraction/parser-dom.js');
const { parseNetworkPayload: parseXNetworkPayload } = require('../extraction/parser-network.js');

function normalizeUsername(value) {
  return String(value || '').trim().replace(/^@+/, '');
}

const xAdapter = {
  platform: 'x',
  label: 'X / Twitter',
  supportedTargets: ['bookmark', 'like'],
  getAllTargets() {
    return this.supportedTargets.slice();
  },
  getTargetLabel(target) {
    if (target === 'bookmark') return 'Bookmarks';
    if (target === 'like') return 'Likes';
    return target;
  },
  getInputSchema(target) {
    if (target === 'like') {
      return [{ key: 'username', label: 'Username for likes (@handle)', placeholder: '@username' }];
    }
    return [];
  },
  validateInput(target, input = {}) {
    if (target === 'like') {
      const username = normalizeUsername(input.username);
      if (!username) {
        return { valid: false, error: 'Enter @username for X likes extraction' };
      }
      return { valid: true, value: { username } };
    }
    return { valid: true, value: {} };
  },
  getRouteUrl(target, input = {}) {
    if (target === 'bookmark') {
      return 'https://x.com/i/bookmarks';
    }

    const username = normalizeUsername(input.username);
    if (!username) {
      throw new Error('Username is required for X likes extraction');
    }
    return `https://x.com/${username}/likes`;
  },
  detectTargetFromUrl(url = '') {
    const normalized = String(url).toLowerCase();
    if (normalized.includes('/i/bookmarks')) return 'bookmark';
    if (/\/[^/]+\/likes(?:\?|$|\/)/.test(normalized)) return 'like';
    return 'unknown';
  },
  getEndpointHint(url = '') {
    const lower = String(url).toLowerCase();
    if (lower.includes('bookmarks')) return 'bookmark';
    if (lower.includes('likes')) return 'like';
    return 'unknown';
  },
  shouldCaptureNetwork(url = '') {
    const lower = String(url).toLowerCase();
    return lower.includes('bookmarks') || lower.includes('likes');
  },
  parseDom(target, route) {
    return parseVisibleXArticles('x', target, route);
  },
  parseNetwork(payload, url = '') {
    return parseXNetworkPayload(payload, url);
  },
  getProgressLabel(target) {
    return `Scanning X ${this.getTargetLabel(target).toLowerCase()}...`;
  }
};

module.exports = {
  xAdapter,
  normalizeXUsername: normalizeUsername
};
