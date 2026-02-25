const { endpointScopeHint } = require('./route-detector.js');

function collectTweetResultNodes(node, output, visited = new WeakSet()) {
  if (!node || typeof node !== 'object') return;
  if (visited.has(node)) return;
  visited.add(node);

  if (node.legacy && node.core && node.core.user_results) {
    output.push(node);
  }

  if (node.tweet_results && node.tweet_results.result) {
    collectTweetResultNodes(node.tweet_results.result, output, visited);
  }

  for (const value of Object.values(node)) {
    if (value && typeof value === 'object') {
      collectTweetResultNodes(value, output, visited);
    }
  }
}

function selectBestVideoVariant(variants) {
  if (!Array.isArray(variants)) return null;
  const mp4s = variants
    .filter((item) => item && item.content_type === 'video/mp4' && item.url)
    .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
  return mp4s.length > 0 ? mp4s[0] : null;
}

function parseNetworkMedia(legacy = {}) {
  const mediaEntities = legacy.extended_entities?.media || legacy.entities?.media || [];
  return mediaEntities
    .map((item) => {
      const type = item.type === 'animated_gif' ? 'gif' : (item.type || 'photo');
      if (type === 'video' || type === 'gif') {
        const bestVariant = selectBestVideoVariant(item.video_info?.variants || []);
        return {
          type,
          url: bestVariant?.url || item.media_url_https || '',
          previewUrl: item.media_url_https || undefined,
          durationMs: item.video_info?.duration_millis || null
        };
      }

      return {
        type: 'photo',
        url: item.media_url_https || item.media_url || ''
      };
    })
    .filter((item) => item.url);
}

function parseTweetResult(resultNode, scopeHint, route) {
  const legacy = resultNode.legacy;
  const core = resultNode.core?.user_results?.result?.legacy;
  if (!legacy || !core) {
    return null;
  }

  const id = legacy.id_str || resultNode.rest_id;
  const username = core.screen_name || '';
  const noteText = resultNode.note_tweet?.note_tweet_results?.result?.text;
  const text = noteText || legacy.full_text || '';

  return {
    id,
    url: id && username ? `https://x.com/${username}/status/${id}` : '',
    scope: scopeHint === 'likes' ? 'like' : 'bookmark',
    capturedAt: new Date().toISOString(),
    tweetPostedAt: legacy.created_at ? new Date(legacy.created_at).toISOString() : null,
    author: {
      username,
      displayName: core.name || '',
      userId: core.id_str || undefined
    },
    text,
    media: parseNetworkMedia(legacy),
    metrics: {
      likes: legacy.favorite_count,
      retweets: legacy.retweet_count,
      replies: legacy.reply_count,
      views: resultNode.views?.count || null
    },
    source: {
      route,
      via: 'network'
    }
  };
}

function parseNetworkPayload(payload, endpointUrl = '') {
  const nodes = [];
  collectTweetResultNodes(payload, nodes);

  const scopeHint = endpointScopeHint(endpointUrl);
  const route = scopeHint === 'likes' ? '/likes' : '/i/bookmarks';

  return nodes
    .map((node) => parseTweetResult(node, scopeHint, route))
    .filter((item) => item && item.url);
}

module.exports = {
  parseNetworkPayload,
  parseNetworkMedia,
  collectTweetResultNodes
};
