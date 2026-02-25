function detectScopeFromUrl(url = '') {
  const normalized = String(url).toLowerCase();
  if (normalized.includes('/i/bookmarks')) {
    return 'bookmarks';
  }

  if (/\/[^/]+\/likes(?:\?|$|\/)/.test(normalized)) {
    return 'likes';
  }

  return 'unknown';
}

function scopeToRecordScope(scope) {
  return scope === 'likes' ? 'like' : 'bookmark';
}

function getScopeUrl(scope, username = '') {
  if (scope === 'bookmarks') {
    return 'https://x.com/i/bookmarks';
  }

  if (!username) {
    throw new Error('Username is required for likes extraction');
  }

  return `https://x.com/${username}/likes`;
}

function endpointScopeHint(url = '') {
  const lower = String(url).toLowerCase();
  if (lower.includes('bookmarks')) return 'bookmarks';
  if (lower.includes('likes')) return 'likes';
  return 'unknown';
}

module.exports = {
  detectScopeFromUrl,
  scopeToRecordScope,
  getScopeUrl,
  endpointScopeHint
};
