function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeUsername(value) {
  return String(value || '').trim().replace(/^@+/, '');
}

function normalizeSavedHref(href) {
  if (!href) return '';
  const absolute = href.startsWith('http') ? href : `https://www.instagram.com${href.startsWith('/') ? '' : '/'}${href}`;
  return absolute
    .replace(/\/saved\/(p|reel|tv)\//, '/$1/')
    .replace(/\?.*$/, '');
}

function isSavedContentHref(href) {
  return /\/(?:saved\/)?(?:p|reel|tv)\//.test(href || '');
}

function isSavedCollectionHref(href) {
  if (!href) return false;
  return /\/saved(?:\/|$)/.test(href) && !isSavedContentHref(href);
}

function isAllPostsGridPath(pathname = '') {
  return /\/saved\/all-posts\/?$/.test(pathname || '');
}

function isCollectionIndexPage(pathname = '', root = document) {
  if (!/\/saved\/?$/.test(pathname || '')) return false;
  return getSavedContentAnchors(root).length === 0 && getSavedCollectionAnchors(root).length > 0;
}

function hasAllPostsCollectionLink(username, root = document) {
  return Boolean(findAllPostsCollectionLink(username, root));
}

function extractInstagramMediaFromNode(node) {
  const media = [];
  const imageNodes = node.querySelectorAll('img');
  imageNodes.forEach((img) => {
    const url = img.currentSrc || img.src;
    if (url) {
      media.push({ type: 'photo', url });
    }
  });

  const videoNodes = node.querySelectorAll('video');
  videoNodes.forEach((video) => {
    const url = video.currentSrc || video.src;
    if (url) {
      media.push({ type: 'video', url });
    }
  });

  return media;
}

function getSavedCollectionAnchors(root = document) {
  return Array.from(root.querySelectorAll('main a[href], a[href]'))
    .filter((anchor) => isSavedCollectionHref(anchor.getAttribute('href') || anchor.href || ''));
}

function findAllPostsCollectionLink(username, root = document) {
  const normalizedUsername = normalizeUsername(username);
  const anchors = getSavedCollectionAnchors(root);
  const exactHref = `/${normalizedUsername}/saved/all-posts/`;

  const exact = anchors.find((anchor) => (anchor.getAttribute('href') || '') === exactHref);
  if (exact) return exact;

  return anchors.find((anchor) => {
    const href = (anchor.getAttribute('href') || '').toLowerCase();
    const label = `${anchor.textContent || ''} ${anchor.getAttribute('aria-label') || ''}`.toLowerCase();
    return href.includes('/saved/all-posts/') || label.includes('all posts');
  }) || null;
}

function getSavedGridArticle(root = document) {
  return root.querySelector('article');
}

function getSavedContentAnchors(root = document) {
  const article = getSavedGridArticle(root);
  if (!article) return [];
  return Array.from(article.querySelectorAll('a[href]'))
    .filter((anchor) => isSavedContentHref(anchor.getAttribute('href') || anchor.href || ''));
}

function parseSavedGrid(route) {
  const article = getSavedGridArticle(document);
  const anchors = article
    ? Array.from(article.querySelectorAll('a[href]')).filter((anchor) => isSavedContentHref(anchor.getAttribute('href') || anchor.href || ''))
    : [];
  const unique = new Map();

  anchors.forEach((anchor) => {
    const href = normalizeSavedHref(anchor.getAttribute('href') || anchor.href || '');
    if (!href || unique.has(href)) return;

    const tile = anchor.closest('a[href]') || anchor;
    const wrapper = anchor.closest('div');
    const text = [
      anchor.getAttribute('aria-label') || '',
      anchor.textContent?.trim() || '',
      wrapper?.getAttribute('aria-label') || ''
    ].filter(Boolean).join(' ').trim();

    unique.set(href, {
      platform: 'instagram',
      target: 'saved',
      url: href,
      capturedAt: new Date().toISOString(),
      postedAt: null,
      author: {
        username: '',
        displayName: ''
      },
      text,
      media: extractInstagramMediaFromNode(tile),
      metrics: {},
      source: {
        route,
        via: 'dom'
      }
    });
  });

  return {
    scannedCount: anchors.length,
    records: Array.from(unique.values())
  };
}

const instagramAdapter = {
  platform: 'instagram',
  label: 'Instagram',
  supportedTargets: ['saved'],
  getAllTargets() {
    return this.supportedTargets.slice();
  },
  getTargetLabel(target) {
    return target === 'saved' ? 'Saved' : target;
  },
  getInputSchema(target) {
    if (target === 'saved') {
      return [{ key: 'username', label: 'Instagram username for saved posts', placeholder: '@username' }];
    }
    return [];
  },
  validateInput(target, input = {}) {
    if (target === 'saved') {
      const username = normalizeUsername(input.username);
      if (!username) {
        return { valid: false, error: 'Enter @username for Instagram saved extraction' };
      }
      return { valid: true, value: { username } };
    }
    return { valid: true, value: {} };
  },
  getRouteUrl(target, input = {}) {
    if (target !== 'saved') {
      throw new Error('Instagram only supports saved extraction');
    }
    const username = normalizeUsername(input.username);
    if (!username) {
      throw new Error('Username is required for Instagram saved extraction');
    }
    return `https://www.instagram.com/${username}/saved/`;
  },
  detectTargetFromUrl(url = '') {
    const normalized = String(url).toLowerCase();
    if (/\/[^/]+\/saved(?:\/|\?|$)/.test(normalized)) return 'saved';
    return 'unknown';
  },
  getEndpointHint() {
    return 'unknown';
  },
  shouldCaptureNetwork() {
    return false;
  },
  parseDom(target, route) {
    if (target !== 'saved') {
      return { scannedCount: 0, records: [] };
    }
    return parseSavedGrid(route);
  },
  async preparePage(target, context = {}) {
    if (target !== 'saved') return;
    const pathname = window.location.pathname;

    if (isAllPostsGridPath(pathname)) {
      return;
    }

    if (!isCollectionIndexPage(pathname, document)) {
      return;
    }

    const linkDeadline = Date.now() + 8000;
    let allPostsLink = null;
    while (Date.now() < linkDeadline) {
      allPostsLink = findAllPostsCollectionLink(context.input?.username, document);
      if (allPostsLink) break;
      await wait(250);
    }

    if (!allPostsLink) {
      const error = new Error('Instagram saved collections loaded, but the All posts collection link was not found.');
      error.code = 'INSTAGRAM_COLLECTION_INDEX_UNRESOLVED';
      throw error;
    }

    const href = allPostsLink.getAttribute('href') || '';
    const targetUrl = href.startsWith('http') ? href : `https://www.instagram.com${href}`;
    if (!targetUrl) {
      const error = new Error('Instagram All posts collection link is missing a usable href.');
      error.code = 'INSTAGRAM_COLLECTION_INDEX_UNRESOLVED';
      throw error;
    }

    if (typeof context.onProgress === 'function') {
      context.onProgress('Opening All posts...');
    }

    if (typeof context.navigate === 'function') {
      context.navigate(targetUrl);
    } else if (typeof window.location.assign === 'function') {
      window.location.assign(targetUrl);
    } else {
      window.location.href = targetUrl;
    }
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      if (isAllPostsGridPath(window.location.pathname)) {
        return;
      }
      await wait(250);
    }

    const error = new Error('Instagram saved collection navigation did not reach the All posts grid.');
    error.code = 'INSTAGRAM_COLLECTION_INDEX_UNRESOLVED';
    throw error;
  },
  async waitForReady(target, context = {}) {
    if (target !== 'saved') return;

    const timeoutMs = Number.isFinite(context.timeoutMs) ? context.timeoutMs : 10000;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const pathname = window.location.pathname;

      const loginGate = document.querySelector('a[href*="/accounts/login"], form input[name="username"]');
      if (loginGate) {
        const error = new Error('Instagram saved page is not accessible because the browser is not on an authenticated saved-page view.');
        error.code = 'AUTH_REQUIRED';
        throw error;
      }

      if (isAllPostsGridPath(pathname)) {
        const contentAnchors = getSavedContentAnchors(document);
        if (contentAnchors.length > 0) {
          return;
        }
      } else if (isCollectionIndexPage(pathname, document)) {
        if (typeof context.onProgress === 'function') {
          context.onProgress('Waiting for Instagram saved collections...');
        }
        if (hasAllPostsCollectionLink(context.input?.username, document)) {
          return;
        }
      }

      await wait(250);
    }

    const pathname = window.location.pathname;
    if (isAllPostsGridPath(pathname)) {
      const error = new Error('Instagram All posts page loaded, but no extractable saved items were found.');
      error.code = 'INSTAGRAM_GRID_EMPTY';
      throw error;
    }

    const error = new Error('Instagram saved page loaded, but no saved collections or saved item grid were detected.');
    error.code = 'INSTAGRAM_PAGE_UNSUPPORTED';
    throw error;
  },
  parseNetwork() {
    return [];
  },
  getProgressLabel(target) {
    return target === 'saved'
      ? 'Scanning Instagram saved items...'
      : `Scanning Instagram ${this.getTargetLabel(target).toLowerCase()}...`;
  }
};

module.exports = {
  instagramAdapter,
  normalizeSavedHref,
  isSavedContentHref,
  isSavedCollectionHref,
  isCollectionIndexPage,
  isAllPostsGridPath,
  getSavedCollectionAnchors,
  findAllPostsCollectionLink,
  hasAllPostsCollectionLink,
  getSavedContentAnchors
};
