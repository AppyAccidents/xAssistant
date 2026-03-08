const { ExtractionEngine } = require('./engine.js');
const { parseNetworkPayload } = require('./parser-network.js');
const { parseVisibleArticles } = require('./parser-dom.js');
const { detectTargetFromUrl, getTargetUrl, endpointTargetHint, detectContextFromUrl } = require('./route-detector.js');
const { BoundedMap } = require('./bounded-cache.js');

module.exports = {
  ExtractionEngine,
  parseNetworkPayload,
  parseVisibleArticles,
  detectTargetFromUrl,
  getTargetUrl,
  endpointTargetHint,
  detectContextFromUrl,
  BoundedMap
};
