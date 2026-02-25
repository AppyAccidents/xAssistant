const { ExtractionEngine } = require('./engine.js');
const { parseNetworkPayload } = require('./parser-network.js');
const { parseVisibleArticles } = require('./parser-dom.js');
const { detectScopeFromUrl, getScopeUrl, endpointScopeHint } = require('./route-detector.js');
const { BoundedMap } = require('./bounded-cache.js');

module.exports = {
  ExtractionEngine,
  parseNetworkPayload,
  parseVisibleArticles,
  detectScopeFromUrl,
  getScopeUrl,
  endpointScopeHint,
  BoundedMap
};
