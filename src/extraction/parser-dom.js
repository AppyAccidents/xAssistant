function parseCount(text) {
  if (!text) return null;
  const match = String(text).trim().match(/([\d,.]+)\s*([KMBkmb])?/);
  if (!match) return null;

  const value = Number(match[1].replace(/,/g, ''));
  if (!Number.isFinite(value)) return null;

  const suffix = match[2] ? match[2].toUpperCase() : null;
  const multiplier = suffix === 'K' ? 1000 : suffix === 'M' ? 1000000 : suffix === 'B' ? 1000000000 : 1;
  return Math.round(value * multiplier);
}

function extractDomMedia(article) {
  const media = [];

  const images = article.querySelectorAll('img[src*="twimg.com/media"]');
  images.forEach((img) => {
    if (img.src) {
      media.push({ type: 'photo', url: img.src });
    }
  });

  const videos = article.querySelectorAll('video');
  videos.forEach((video) => {
    const source = video.querySelector('source');
    const url = source?.src || video.src;
    if (url) {
      media.push({ type: 'video', url });
    }
  });

  return media;
}

function parseXArticle(article, target, route) {
  const link = article.querySelector('a[href*="/status/"]');
  const url = link?.href || '';
  if (!url) return null;

  const idMatch = url.match(/\/status\/(\d+)/);
  const id = idMatch ? `x:${idMatch[1]}` : '';

  let username = '';
  let displayName = '';
  const spans = article.querySelectorAll('span');
  for (const span of spans) {
    const content = span.textContent?.trim() || '';
    if (!username && content.startsWith('@')) {
      username = content.slice(1);
    } else if (!displayName && content && !content.startsWith('@')) {
      displayName = content;
    }
  }

  if (!username) {
    const match = url.match(/(?:x\.com|twitter\.com)\/([^/]+)\/status/);
    username = match ? match[1] : '';
  }

  const text = Array.from(article.querySelectorAll('[data-testid="tweetText"]'))
    .map((node) => node.textContent?.trim() || '')
    .filter(Boolean)
    .join(' ');

  const timeNode = article.querySelector('time');
  const postedAt = timeNode?.getAttribute('datetime') || null;

  const likes = parseCount(article.querySelector('[data-testid="like"]')?.textContent || '');
  const retweets = parseCount(article.querySelector('[data-testid="retweet"]')?.textContent || '');
  const replies = parseCount(article.querySelector('[data-testid="reply"]')?.textContent || '');

  let views = null;
  const viewNode = Array.from(article.querySelectorAll('a[aria-label*="View"], span[aria-label*="View"]')).find((node) => {
    return /view/i.test(node.getAttribute('aria-label') || '');
  });

  if (viewNode) {
    views = parseCount(viewNode.getAttribute('aria-label') || '');
  }

  return {
    id,
    platform: 'x',
    target,
    url,
    capturedAt: new Date().toISOString(),
    postedAt,
    author: {
      username,
      displayName
    },
    text,
    media: extractDomMedia(article),
    metrics: {
      likes,
      replies,
      views,
      platform: {
        retweets
      }
    },
    source: {
      route,
      via: 'dom'
    }
  };
}

function parseVisibleArticles(platform, target, route) {
  if (platform !== 'x') {
    return {
      scannedCount: 0,
      records: []
    };
  }

  const articles = Array.from(document.querySelectorAll('article'));
  const parsed = [];

  for (const article of articles) {
    const item = parseXArticle(article, target, route);
    if (item) parsed.push(item);
  }

  return {
    scannedCount: articles.length,
    records: parsed
  };
}

module.exports = {
  parseVisibleArticles,
  parseXArticle,
  parseCount,
  extractDomMedia
};
