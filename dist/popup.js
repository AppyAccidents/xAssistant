(() => {
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __commonJS = (cb, mod) => function __require() {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  };

  // src/core/contracts/messages.js
  var require_messages = __commonJS({
    "src/core/contracts/messages.js"(exports, module) {
      var EXTRACTION_MODES = ["full", "visible"];
      var EXTRACTION_TARGETS = {
        x: ["bookmark", "like", "all"],
        instagram: ["saved", "all"]
      };
      var QUERY_PLATFORMS = ["x", "instagram", "all"];
      var QUERY_TARGETS = ["bookmark", "like", "saved", "all"];
      var MESSAGE_TYPES = {
        EXTRACTION_START: "EXTRACTION_START",
        EXTRACTION_PROGRESS: "EXTRACTION_PROGRESS",
        EXTRACTION_COMPLETE: "EXTRACTION_COMPLETE",
        EXTRACTION_ERROR: "EXTRACTION_ERROR",
        EXTRACTION_CANCEL: "EXTRACTION_CANCEL",
        DATA_QUERY: "DATA_QUERY",
        XA_START_EXTRACTION: "XA_START_EXTRACTION",
        XA_GET_SETTINGS: "XA_GET_SETTINGS",
        XA_SAVE_SETTINGS: "XA_SAVE_SETTINGS"
      };
      function isPlainObject(value) {
        return !!value && typeof value === "object" && !Array.isArray(value);
      }
      function getSupportedTargets(platform) {
        return EXTRACTION_TARGETS[platform] || [];
      }
      function validateExtractionStart(payload) {
        if (!isPlainObject(payload)) {
          return { valid: false, error: "Payload must be an object" };
        }
        const platform = payload.platform === "instagram" ? "instagram" : payload.platform === "x" ? "x" : "";
        if (!platform) {
          return { valid: false, error: "platform must be x or instagram" };
        }
        const supportedTargets = getSupportedTargets(platform);
        const target = typeof payload.target === "string" ? payload.target : "";
        if (!supportedTargets.includes(target)) {
          return { valid: false, error: `target must be one of: ${supportedTargets.join(", ")}` };
        }
        const mode = payload.mode || "full";
        if (!EXTRACTION_MODES.includes(mode)) {
          return { valid: false, error: "mode must be full or visible" };
        }
        const input = isPlainObject(payload.input) ? payload.input : {};
        return {
          valid: true,
          value: {
            platform,
            target,
            mode,
            input,
            runId: typeof payload.runId === "string" ? payload.runId : `run-${Date.now()}`
          }
        };
      }
      function validateDataQuery(payload) {
        if (!isPlainObject(payload)) {
          return { valid: false, error: "Payload must be an object" };
        }
        const platform = payload.platform || "all";
        if (!QUERY_PLATFORMS.includes(platform)) {
          return { valid: false, error: "platform must be x, instagram, or all" };
        }
        const target = payload.target || "all";
        if (!QUERY_TARGETS.includes(target)) {
          return { valid: false, error: "target must be bookmark, like, saved, or all" };
        }
        const filter = isPlainObject(payload.filter) ? payload.filter : {};
        const sort = typeof payload.sort === "string" ? payload.sort : "capturedAt:desc";
        const page = isPlainObject(payload.page) ? payload.page : {};
        const offset = Number.isInteger(page.offset) && page.offset >= 0 ? page.offset : 0;
        const limit = Number.isInteger(page.limit) && page.limit > 0 ? page.limit : 5e3;
        return {
          valid: true,
          value: {
            platform,
            target,
            filter,
            sort,
            page: { offset, limit }
          }
        };
      }
      module.exports = {
        MESSAGE_TYPES,
        EXTRACTION_MODES,
        EXTRACTION_TARGETS,
        QUERY_PLATFORMS,
        QUERY_TARGETS,
        validateExtractionStart,
        validateDataQuery,
        getSupportedTargets,
        isPlainObject
      };
    }
  });

  // src/export/index.js
  var require_export = __commonJS({
    "src/export/index.js"(exports, module) {
      function filterRecords(records, { platform = "all", target = "all" } = {}) {
        return (records || []).filter((record) => {
          if (platform !== "all" && record.platform !== platform)
            return false;
          if (target !== "all" && record.target !== target)
            return false;
          return true;
        });
      }
      function escapeCSV(value) {
        if (value === null || value === void 0)
          return "";
        const str = String(value).replace(/\n/g, " ");
        if (/[",]/.test(str)) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      }
      function mediaUrls(record) {
        return (record.media || []).map((item) => item.url).filter(Boolean).join("; ");
      }
      function displayName(record) {
        return record.author?.displayName || "";
      }
      function username(record) {
        return record.author?.username || "";
      }
      function projectRecord(record) {
        return {
          id: record.id,
          platform: record.platform,
          target: record.target,
          postedAt: record.postedAt || "",
          capturedAt: record.capturedAt || "",
          authorDisplayName: displayName(record),
          authorUsername: username(record),
          text: record.text || "",
          mediaUrls: mediaUrls(record),
          likes: record.metrics?.likes ?? "",
          replies: record.metrics?.replies ?? "",
          views: record.metrics?.views ?? "",
          shares: record.metrics?.shares ?? "",
          saves: record.metrics?.saves ?? "",
          platformMetrics: record.metrics?.platform || {},
          url: record.url || ""
        };
      }
      function buildMetadata(selected, options) {
        return {
          platform: options.platform || "all",
          target: options.target || "all",
          exportedAt: (/* @__PURE__ */ new Date()).toISOString(),
          totalRecords: selected.length,
          schemaVersion: 3
        };
      }
      function generateJSONExport(records, options = {}) {
        const selected = filterRecords(records, options);
        return {
          metadata: buildMetadata(selected, options),
          records: selected
        };
      }
      function generateCSVExport(records, options = {}) {
        const selected = filterRecords(records, options).map(projectRecord);
        const header = [
          "id",
          "platform",
          "target",
          "postedAt",
          "capturedAt",
          "authorDisplayName",
          "authorUsername",
          "text",
          "mediaUrls",
          "likes",
          "replies",
          "views",
          "shares",
          "saves",
          "platformMetrics",
          "url"
        ];
        const rows = [header.join(",")];
        selected.forEach((record) => {
          rows.push([
            escapeCSV(record.id),
            escapeCSV(record.platform),
            escapeCSV(record.target),
            escapeCSV(record.postedAt),
            escapeCSV(record.capturedAt),
            escapeCSV(record.authorDisplayName),
            escapeCSV(record.authorUsername),
            escapeCSV(record.text),
            escapeCSV(record.mediaUrls),
            escapeCSV(record.likes),
            escapeCSV(record.replies),
            escapeCSV(record.views),
            escapeCSV(record.shares),
            escapeCSV(record.saves),
            escapeCSV(JSON.stringify(record.platformMetrics)),
            escapeCSV(record.url)
          ].join(","));
        });
        return rows.join("\n");
      }
      function generateMarkdownExport(records, options = {}) {
        const selected = filterRecords(records, options).map(projectRecord);
        const lines = [];
        lines.push("# Social Export Report");
        lines.push("");
        lines.push(`- Platform: ${options.platform || "all"}`);
        lines.push(`- Target: ${options.target || "all"}`);
        lines.push(`- Exported: ${(/* @__PURE__ */ new Date()).toISOString()}`);
        lines.push(`- Total: ${selected.length}`);
        lines.push("");
        selected.forEach((record, index) => {
          const authorName = record.authorDisplayName || "Unknown";
          const authorUser = record.authorUsername ? ` (@${record.authorUsername})` : "";
          const postedAt = record.postedAt || "N/A";
          const media = record.mediaUrls || "None";
          lines.push(`## ${index + 1}. ${authorName}${authorUser}`);
          lines.push(`- Platform: ${record.platform}`);
          lines.push(`- Target: ${record.target}`);
          lines.push(`- Posted At: ${postedAt}`);
          lines.push(`- Captured At: ${record.capturedAt || "N/A"}`);
          lines.push(`- URL: ${record.url}`);
          lines.push(`- Text: ${record.text || "(No text)"}`);
          lines.push(`- Media: ${media}`);
          lines.push("");
        });
        return lines.join("\n");
      }
      function generateTextExport(records, options = {}) {
        const selected = filterRecords(records, options).map(projectRecord);
        const lines = [];
        lines.push("Social Export Report");
        lines.push(`Platform: ${options.platform || "all"}`);
        lines.push(`Target: ${options.target || "all"}`);
        lines.push(`Exported: ${(/* @__PURE__ */ new Date()).toISOString()}`);
        lines.push(`Total: ${selected.length}`);
        lines.push("");
        selected.forEach((record, index) => {
          const authorName = record.authorDisplayName || "Unknown";
          const authorUser = record.authorUsername ? ` (@${record.authorUsername})` : "";
          lines.push(`[${index + 1}] ${String(record.platform).toUpperCase()} ${String(record.target).toUpperCase()}`);
          lines.push(`Author: ${authorName}${authorUser}`);
          lines.push(`Posted At: ${record.postedAt || "N/A"}`);
          lines.push(`Captured At: ${record.capturedAt || "N/A"}`);
          lines.push(`URL: ${record.url}`);
          lines.push(`Text: ${record.text || "(No text)"}`);
          lines.push(`Media: ${record.mediaUrls || "None"}`);
          lines.push("");
        });
        return lines.join("\n");
      }
      module.exports = {
        filterRecords,
        projectRecord,
        generateJSONExport,
        generateCSVExport,
        generateMarkdownExport,
        generateTextExport,
        escapeCSV
      };
    }
  });

  // src/ui/dom-safe.js
  var require_dom_safe = __commonJS({
    "src/ui/dom-safe.js"(exports, module) {
      function createTextElement(tag, text, className = "") {
        const node = document.createElement(tag);
        if (className)
          node.className = className;
        node.textContent = text;
        return node;
      }
      function downloadTextFile(content, filename, mimeType) {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = filename;
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        URL.revokeObjectURL(url);
      }
      module.exports = {
        createTextElement,
        downloadTextFile
      };
    }
  });

  // src/extraction/parser-dom.js
  var require_parser_dom = __commonJS({
    "src/extraction/parser-dom.js"(exports, module) {
      function parseCount(text) {
        if (!text)
          return null;
        const match = String(text).trim().match(/([\d,.]+)\s*([KMBkmb])?/);
        if (!match)
          return null;
        const value = Number(match[1].replace(/,/g, ""));
        if (!Number.isFinite(value))
          return null;
        const suffix = match[2] ? match[2].toUpperCase() : null;
        const multiplier = suffix === "K" ? 1e3 : suffix === "M" ? 1e6 : suffix === "B" ? 1e9 : 1;
        return Math.round(value * multiplier);
      }
      function extractDomMedia(article) {
        const media = [];
        const images = article.querySelectorAll('img[src*="twimg.com/media"]');
        images.forEach((img) => {
          if (img.src) {
            media.push({ type: "photo", url: img.src });
          }
        });
        const videos = article.querySelectorAll("video");
        videos.forEach((video) => {
          const source = video.querySelector("source");
          const url = source?.src || video.src;
          if (url) {
            media.push({ type: "video", url });
          }
        });
        return media;
      }
      function parseXArticle(article, target, route) {
        const link = article.querySelector('a[href*="/status/"]');
        const url = link?.href || "";
        if (!url)
          return null;
        const idMatch = url.match(/\/status\/(\d+)/);
        const id = idMatch ? `x:${idMatch[1]}` : "";
        let username = "";
        let displayName = "";
        const spans = article.querySelectorAll("span");
        for (const span of spans) {
          const content = span.textContent?.trim() || "";
          if (!username && content.startsWith("@")) {
            username = content.slice(1);
          } else if (!displayName && content && !content.startsWith("@")) {
            displayName = content;
          }
        }
        if (!username) {
          const match = url.match(/(?:x\.com|twitter\.com)\/([^/]+)\/status/);
          username = match ? match[1] : "";
        }
        const text = Array.from(article.querySelectorAll('[data-testid="tweetText"]')).map((node) => node.textContent?.trim() || "").filter(Boolean).join(" ");
        const timeNode = article.querySelector("time");
        const postedAt = timeNode?.getAttribute("datetime") || null;
        const likes = parseCount(article.querySelector('[data-testid="like"]')?.textContent || "");
        const retweets = parseCount(article.querySelector('[data-testid="retweet"]')?.textContent || "");
        const replies = parseCount(article.querySelector('[data-testid="reply"]')?.textContent || "");
        let views = null;
        const viewNode = Array.from(article.querySelectorAll('a[aria-label*="View"], span[aria-label*="View"]')).find((node) => {
          return /view/i.test(node.getAttribute("aria-label") || "");
        });
        if (viewNode) {
          views = parseCount(viewNode.getAttribute("aria-label") || "");
        }
        return {
          id,
          platform: "x",
          target,
          url,
          capturedAt: (/* @__PURE__ */ new Date()).toISOString(),
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
            via: "dom"
          }
        };
      }
      function parseVisibleArticles(platform, target, route) {
        if (platform !== "x") {
          return {
            scannedCount: 0,
            records: []
          };
        }
        const articles = Array.from(document.querySelectorAll("article"));
        const parsed = [];
        for (const article of articles) {
          const item = parseXArticle(article, target, route);
          if (item)
            parsed.push(item);
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
    }
  });

  // src/extraction/route-detector.js
  var require_route_detector = __commonJS({
    "src/extraction/route-detector.js"(exports, module) {
      var { getPlatformAdapter, detectContextFromUrl } = require_platforms();
      function detectTargetFromUrl(url = "", platform = "x") {
        const adapter = getPlatformAdapter(platform);
        return adapter ? adapter.detectTargetFromUrl(url) : "unknown";
      }
      function getTargetUrl(platform, target, input = {}) {
        const adapter = getPlatformAdapter(platform);
        if (!adapter) {
          throw new Error(`Unsupported platform: ${platform}`);
        }
        return adapter.getRouteUrl(target, input);
      }
      function endpointTargetHint(url = "", platform = "x") {
        const adapter = getPlatformAdapter(platform);
        return adapter ? adapter.getEndpointHint(url) : "unknown";
      }
      module.exports = {
        detectTargetFromUrl,
        getTargetUrl,
        endpointTargetHint,
        detectContextFromUrl
      };
    }
  });

  // src/extraction/parser-network.js
  var require_parser_network = __commonJS({
    "src/extraction/parser-network.js"(exports, module) {
      var { endpointTargetHint } = require_route_detector();
      function collectTweetResultNodes(node, output, visited = /* @__PURE__ */ new WeakSet()) {
        if (!node || typeof node !== "object")
          return;
        if (visited.has(node))
          return;
        visited.add(node);
        if (node.legacy && node.core && node.core.user_results) {
          output.push(node);
        }
        if (node.tweet_results && node.tweet_results.result) {
          collectTweetResultNodes(node.tweet_results.result, output, visited);
        }
        for (const value of Object.values(node)) {
          if (value && typeof value === "object") {
            collectTweetResultNodes(value, output, visited);
          }
        }
      }
      function selectBestVideoVariant(variants) {
        if (!Array.isArray(variants))
          return null;
        const mp4s = variants.filter((item) => item && item.content_type === "video/mp4" && item.url).sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
        return mp4s.length > 0 ? mp4s[0] : null;
      }
      function parseNetworkMedia(legacy = {}) {
        const mediaEntities = legacy.extended_entities?.media || legacy.entities?.media || [];
        return mediaEntities.map((item) => {
          const type = item.type === "animated_gif" ? "gif" : item.type || "photo";
          if (type === "video" || type === "gif") {
            const bestVariant = selectBestVideoVariant(item.video_info?.variants || []);
            return {
              type,
              url: bestVariant?.url || item.media_url_https || "",
              previewUrl: item.media_url_https || void 0,
              durationMs: item.video_info?.duration_millis || null
            };
          }
          return {
            type: "photo",
            url: item.media_url_https || item.media_url || ""
          };
        }).filter((item) => item.url);
      }
      function parseTweetResult(resultNode, targetHint, route) {
        const legacy = resultNode.legacy;
        const core = resultNode.core?.user_results?.result?.legacy;
        if (!legacy || !core) {
          return null;
        }
        const id = legacy.id_str || resultNode.rest_id;
        const username = core.screen_name || "";
        const noteText = resultNode.note_tweet?.note_tweet_results?.result?.text;
        const text = noteText || legacy.full_text || "";
        return {
          id: id ? `x:${id}` : "",
          platform: "x",
          target: targetHint === "like" ? "like" : "bookmark",
          url: id && username ? `https://x.com/${username}/status/${id}` : "",
          capturedAt: (/* @__PURE__ */ new Date()).toISOString(),
          postedAt: legacy.created_at ? new Date(legacy.created_at).toISOString() : null,
          author: {
            username,
            displayName: core.name || "",
            userId: core.id_str || void 0
          },
          text,
          media: parseNetworkMedia(legacy),
          metrics: {
            likes: legacy.favorite_count,
            replies: legacy.reply_count,
            views: resultNode.views?.count || null,
            platform: {
              retweets: legacy.retweet_count
            }
          },
          source: {
            route,
            via: "network"
          }
        };
      }
      function parseNetworkPayload(payload, endpointUrl = "") {
        const nodes = [];
        collectTweetResultNodes(payload, nodes);
        const targetHint = endpointTargetHint(endpointUrl, "x");
        const route = targetHint === "like" ? "/likes" : "/i/bookmarks";
        return nodes.map((node) => parseTweetResult(node, targetHint, route)).filter((item) => item && item.url);
      }
      module.exports = {
        parseNetworkPayload,
        parseNetworkMedia,
        collectTweetResultNodes
      };
    }
  });

  // src/platforms/x.js
  var require_x = __commonJS({
    "src/platforms/x.js"(exports, module) {
      var { parseVisibleArticles: parseVisibleXArticles } = require_parser_dom();
      var { parseNetworkPayload: parseXNetworkPayload } = require_parser_network();
      function normalizeUsername(value) {
        return String(value || "").trim().replace(/^@+/, "");
      }
      var xAdapter = {
        platform: "x",
        label: "X / Twitter",
        supportedTargets: ["bookmark", "like"],
        getAllTargets() {
          return this.supportedTargets.slice();
        },
        getTargetLabel(target) {
          if (target === "bookmark")
            return "Bookmarks";
          if (target === "like")
            return "Likes";
          return target;
        },
        getInputSchema(target) {
          if (target === "like") {
            return [{ key: "username", label: "Username for likes (@handle)", placeholder: "@username" }];
          }
          return [];
        },
        validateInput(target, input = {}) {
          if (target === "like") {
            const username = normalizeUsername(input.username);
            if (!username) {
              return { valid: false, error: "Enter @username for X likes extraction" };
            }
            return { valid: true, value: { username } };
          }
          return { valid: true, value: {} };
        },
        getRouteUrl(target, input = {}) {
          if (target === "bookmark") {
            return "https://x.com/i/bookmarks";
          }
          const username = normalizeUsername(input.username);
          if (!username) {
            throw new Error("Username is required for X likes extraction");
          }
          return `https://x.com/${username}/likes`;
        },
        detectTargetFromUrl(url = "") {
          const normalized = String(url).toLowerCase();
          if (normalized.includes("/i/bookmarks"))
            return "bookmark";
          if (/\/[^/]+\/likes(?:\?|$|\/)/.test(normalized))
            return "like";
          return "unknown";
        },
        getEndpointHint(url = "") {
          const lower = String(url).toLowerCase();
          if (lower.includes("bookmarks"))
            return "bookmark";
          if (lower.includes("likes"))
            return "like";
          return "unknown";
        },
        shouldCaptureNetwork(url = "") {
          const lower = String(url).toLowerCase();
          return lower.includes("bookmarks") || lower.includes("likes");
        },
        parseDom(target, route) {
          return parseVisibleXArticles("x", target, route);
        },
        parseNetwork(payload, url = "") {
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
    }
  });

  // src/platforms/instagram.js
  var require_instagram = __commonJS({
    "src/platforms/instagram.js"(exports, module) {
      function wait(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
      }
      function normalizeUsername(value) {
        return String(value || "").trim().replace(/^@+/, "");
      }
      function normalizeSavedHref(href) {
        if (!href)
          return "";
        const absolute = href.startsWith("http") ? href : `https://www.instagram.com${href.startsWith("/") ? "" : "/"}${href}`;
        return absolute.replace(/\/saved\/(p|reel|tv)\//, "/$1/").replace(/\?.*$/, "");
      }
      function isSavedContentHref(href) {
        return /\/(?:saved\/)?(?:p|reel|tv)\//.test(href || "");
      }
      function isSavedCollectionHref(href) {
        if (!href)
          return false;
        return /\/saved(?:\/|$)/.test(href) && !isSavedContentHref(href);
      }
      function isAllPostsGridPath(pathname = "") {
        return /\/saved\/all-posts\/?$/.test(pathname || "");
      }
      function isCollectionIndexPage(pathname = "", root = document) {
        if (!/\/saved\/?$/.test(pathname || ""))
          return false;
        return getSavedContentAnchors(root).length === 0 && getSavedCollectionAnchors(root).length > 0;
      }
      function hasAllPostsCollectionLink(username, root = document) {
        return Boolean(findAllPostsCollectionLink(username, root));
      }
      function extractInstagramMediaFromNode(node) {
        const media = [];
        const imageNodes = node.querySelectorAll("img");
        imageNodes.forEach((img) => {
          const url = img.currentSrc || img.src;
          if (url) {
            media.push({ type: "photo", url });
          }
        });
        const videoNodes = node.querySelectorAll("video");
        videoNodes.forEach((video) => {
          const url = video.currentSrc || video.src;
          if (url) {
            media.push({ type: "video", url });
          }
        });
        return media;
      }
      function getSavedCollectionAnchors(root = document) {
        return Array.from(root.querySelectorAll("main a[href], a[href]")).filter((anchor) => isSavedCollectionHref(anchor.getAttribute("href") || anchor.href || ""));
      }
      function findAllPostsCollectionLink(username, root = document) {
        const normalizedUsername = normalizeUsername(username);
        const anchors = getSavedCollectionAnchors(root);
        const exactHref = `/${normalizedUsername}/saved/all-posts/`;
        const exact = anchors.find((anchor) => (anchor.getAttribute("href") || "") === exactHref);
        if (exact)
          return exact;
        return anchors.find((anchor) => {
          const href = (anchor.getAttribute("href") || "").toLowerCase();
          const label = `${anchor.textContent || ""} ${anchor.getAttribute("aria-label") || ""}`.toLowerCase();
          return href.includes("/saved/all-posts/") || label.includes("all posts");
        }) || null;
      }
      function getSavedGridArticle(root = document) {
        return root.querySelector("article");
      }
      function getSavedContentAnchors(root = document) {
        const article = getSavedGridArticle(root);
        if (!article)
          return [];
        return Array.from(article.querySelectorAll("a[href]")).filter((anchor) => isSavedContentHref(anchor.getAttribute("href") || anchor.href || ""));
      }
      function parseSavedGrid(route) {
        const article = getSavedGridArticle(document);
        const anchors = article ? Array.from(article.querySelectorAll("a[href]")).filter((anchor) => isSavedContentHref(anchor.getAttribute("href") || anchor.href || "")) : [];
        const unique = /* @__PURE__ */ new Map();
        anchors.forEach((anchor) => {
          const href = normalizeSavedHref(anchor.getAttribute("href") || anchor.href || "");
          if (!href || unique.has(href))
            return;
          const tile = anchor.closest("a[href]") || anchor;
          const wrapper = anchor.closest("div");
          const text = [
            anchor.getAttribute("aria-label") || "",
            anchor.textContent?.trim() || "",
            wrapper?.getAttribute("aria-label") || ""
          ].filter(Boolean).join(" ").trim();
          unique.set(href, {
            platform: "instagram",
            target: "saved",
            url: href,
            capturedAt: (/* @__PURE__ */ new Date()).toISOString(),
            postedAt: null,
            author: {
              username: "",
              displayName: ""
            },
            text,
            media: extractInstagramMediaFromNode(tile),
            metrics: {},
            source: {
              route,
              via: "dom"
            }
          });
        });
        return {
          scannedCount: anchors.length,
          records: Array.from(unique.values())
        };
      }
      var instagramAdapter = {
        platform: "instagram",
        label: "Instagram",
        supportedTargets: ["saved"],
        getAllTargets() {
          return this.supportedTargets.slice();
        },
        getTargetLabel(target) {
          return target === "saved" ? "Saved" : target;
        },
        getInputSchema(target) {
          if (target === "saved") {
            return [{ key: "username", label: "Instagram username for saved posts", placeholder: "@username" }];
          }
          return [];
        },
        validateInput(target, input = {}) {
          if (target === "saved") {
            const username = normalizeUsername(input.username);
            if (!username) {
              return { valid: false, error: "Enter @username for Instagram saved extraction" };
            }
            return { valid: true, value: { username } };
          }
          return { valid: true, value: {} };
        },
        getRouteUrl(target, input = {}) {
          if (target !== "saved") {
            throw new Error("Instagram only supports saved extraction");
          }
          const username = normalizeUsername(input.username);
          if (!username) {
            throw new Error("Username is required for Instagram saved extraction");
          }
          return `https://www.instagram.com/${username}/saved/`;
        },
        detectTargetFromUrl(url = "") {
          const normalized = String(url).toLowerCase();
          if (/\/[^/]+\/saved(?:\/|\?|$)/.test(normalized))
            return "saved";
          return "unknown";
        },
        getEndpointHint() {
          return "unknown";
        },
        shouldCaptureNetwork() {
          return false;
        },
        parseDom(target, route) {
          if (target !== "saved") {
            return { scannedCount: 0, records: [] };
          }
          return parseSavedGrid(route);
        },
        async preparePage(target, context = {}) {
          if (target !== "saved")
            return;
          const pathname = window.location.pathname;
          if (isAllPostsGridPath(pathname)) {
            return;
          }
          if (!isCollectionIndexPage(pathname, document)) {
            return;
          }
          const linkDeadline = Date.now() + 8e3;
          let allPostsLink = null;
          while (Date.now() < linkDeadline) {
            allPostsLink = findAllPostsCollectionLink(context.input?.username, document);
            if (allPostsLink)
              break;
            await wait(250);
          }
          if (!allPostsLink) {
            const error2 = new Error("Instagram saved collections loaded, but the All posts collection link was not found.");
            error2.code = "INSTAGRAM_COLLECTION_INDEX_UNRESOLVED";
            throw error2;
          }
          const href = allPostsLink.getAttribute("href") || "";
          const targetUrl = href.startsWith("http") ? href : `https://www.instagram.com${href}`;
          if (!targetUrl) {
            const error2 = new Error("Instagram All posts collection link is missing a usable href.");
            error2.code = "INSTAGRAM_COLLECTION_INDEX_UNRESOLVED";
            throw error2;
          }
          if (typeof context.onProgress === "function") {
            context.onProgress("Opening All posts...");
          }
          if (typeof context.navigate === "function") {
            context.navigate(targetUrl);
          } else if (typeof window.location.assign === "function") {
            window.location.assign(targetUrl);
          } else {
            window.location.href = targetUrl;
          }
          const deadline = Date.now() + 1e4;
          while (Date.now() < deadline) {
            if (isAllPostsGridPath(window.location.pathname)) {
              return;
            }
            await wait(250);
          }
          const error = new Error("Instagram saved collection navigation did not reach the All posts grid.");
          error.code = "INSTAGRAM_COLLECTION_INDEX_UNRESOLVED";
          throw error;
        },
        async waitForReady(target, context = {}) {
          if (target !== "saved")
            return;
          const timeoutMs = Number.isFinite(context.timeoutMs) ? context.timeoutMs : 1e4;
          const deadline = Date.now() + timeoutMs;
          while (Date.now() < deadline) {
            const pathname2 = window.location.pathname;
            const loginGate = document.querySelector('a[href*="/accounts/login"], form input[name="username"]');
            if (loginGate) {
              const error2 = new Error("Instagram saved page is not accessible because the browser is not on an authenticated saved-page view.");
              error2.code = "AUTH_REQUIRED";
              throw error2;
            }
            if (isAllPostsGridPath(pathname2)) {
              const contentAnchors = getSavedContentAnchors(document);
              if (contentAnchors.length > 0) {
                return;
              }
            } else if (isCollectionIndexPage(pathname2, document)) {
              if (typeof context.onProgress === "function") {
                context.onProgress("Waiting for Instagram saved collections...");
              }
              if (hasAllPostsCollectionLink(context.input?.username, document)) {
                return;
              }
            }
            await wait(250);
          }
          const pathname = window.location.pathname;
          if (isAllPostsGridPath(pathname)) {
            const error2 = new Error("Instagram All posts page loaded, but no extractable saved items were found.");
            error2.code = "INSTAGRAM_GRID_EMPTY";
            throw error2;
          }
          const error = new Error("Instagram saved page loaded, but no saved collections or saved item grid were detected.");
          error.code = "INSTAGRAM_PAGE_UNSUPPORTED";
          throw error;
        },
        parseNetwork() {
          return [];
        },
        getProgressLabel(target) {
          return target === "saved" ? "Scanning Instagram saved items..." : `Scanning Instagram ${this.getTargetLabel(target).toLowerCase()}...`;
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
    }
  });

  // src/platforms/index.js
  var require_platforms = __commonJS({
    "src/platforms/index.js"(exports, module) {
      var { xAdapter } = require_x();
      var { instagramAdapter } = require_instagram();
      var PLATFORM_ADAPTERS = {
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
        if (!adapter)
          return [];
        if (target === "all") {
          return adapter.getAllTargets();
        }
        return adapter.supportedTargets.includes(target) ? [target] : [];
      }
      function detectContextFromUrl(url = "") {
        if (/instagram\.com/i.test(url)) {
          const adapter = getPlatformAdapter("instagram");
          return {
            platform: "instagram",
            target: adapter.detectTargetFromUrl(url)
          };
        }
        if (/(?:^|\/\/)(?:www\.)?(?:x\.com|twitter\.com)/i.test(url)) {
          const adapter = getPlatformAdapter("x");
          return {
            platform: "x",
            target: adapter.detectTargetFromUrl(url)
          };
        }
        return {
          platform: "unknown",
          target: "unknown"
        };
      }
      module.exports = {
        PLATFORM_ADAPTERS,
        getPlatformAdapter,
        listPlatformAdapters,
        expandExtractionTargets,
        detectContextFromUrl
      };
    }
  });

  // src/popup/index.js
  var require_popup = __commonJS({
    "src/popup/index.js"(exports, module) {
      var { MESSAGE_TYPES } = require_messages();
      var {
        generateJSONExport,
        generateCSVExport,
        generateMarkdownExport,
        generateTextExport
      } = require_export();
      var { downloadTextFile } = require_dom_safe();
      var { getPlatformAdapter } = require_platforms();
      function sendRuntimeMessage(message) {
        return new Promise((resolve, reject) => {
          chrome.runtime.sendMessage(message, (response) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
              return;
            }
            resolve(response || {});
          });
        });
      }
      function normalizeUsername(rawValue) {
        return String(rawValue || "").trim().replace(/^@+/, "");
      }
      var GUIDE_VERSION = 2;
      var GUIDE_STEPS = [
        {
          title: "Choose a platform",
          body: "Pick X or Instagram before starting extraction."
        },
        {
          title: "Choose a target",
          body: "Select a specific target or run all supported targets for that platform."
        },
        {
          title: "Extract, then export",
          body: "Run extraction first, then export the combined report in the format you need."
        }
      ];
      var PopupApp = class {
        constructor() {
          this.state = {
            settings: {
              onboardingSeen: false,
              guideVersion: GUIDE_VERSION,
              selectedPlatform: "x",
              selectedTarget: "all",
              settingsByPlatform: {
                x: { username: "" },
                instagram: { username: "" }
              }
            },
            progress: 0,
            running: false,
            recordCount: 0,
            guideStep: 0
          };
          this.exportCtaTimer = null;
          this.elements = {
            appRoot: document.getElementById("popupRoot"),
            statusText: document.getElementById("statusText"),
            progressBar: document.getElementById("progressBar"),
            progressLabel: document.getElementById("progressLabel"),
            platformSelect: document.getElementById("platformSelect"),
            targetSelect: document.getElementById("targetSelect"),
            usernameField: document.getElementById("usernameField"),
            usernameLabel: document.getElementById("usernameLabel"),
            usernameInput: document.getElementById("usernameInput"),
            extractSelectedBtn: document.getElementById("extractSelectedBtn"),
            extractAllBtn: document.getElementById("extractAllBtn"),
            exportFormat: document.getElementById("exportFormat"),
            exportBtn: document.getElementById("exportBtn"),
            guideOverlay: document.getElementById("guideOverlay"),
            guideTitle: document.getElementById("guideTitle"),
            guideBody: document.getElementById("guideBody"),
            guideStepLabel: document.getElementById("guideStepLabel"),
            guideBackBtn: document.getElementById("guideBackBtn"),
            guideSkipBtn: document.getElementById("guideSkipBtn"),
            guideNextBtn: document.getElementById("guideNextBtn"),
            guideDoneBtn: document.getElementById("guideDoneBtn")
          };
          this.bindEvents();
          this.initialize();
        }
        async initialize() {
          this.setStatus("Loading...", "idle");
          await this.loadSettings();
          this.renderPlatformControls();
          await this.refreshRecordCount();
          this.setProgress(0);
          this.setStatus(`Ready (${this.state.recordCount} records)`, "idle");
          if (this.shouldShowOnboardingGuide()) {
            this.openGuide();
          }
        }
        bindEvents() {
          this.elements.platformSelect.addEventListener("change", () => this.handlePlatformChange());
          this.elements.targetSelect.addEventListener("change", () => this.handleTargetChange());
          this.elements.extractSelectedBtn.addEventListener("click", () => this.startExtraction(this.elements.targetSelect.value));
          this.elements.extractAllBtn.addEventListener("click", () => this.startExtraction("all"));
          this.elements.exportBtn.addEventListener("click", () => this.exportData());
          this.elements.usernameInput.addEventListener("blur", () => this.savePlatformSettings());
          this.elements.usernameInput.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
              this.savePlatformSettings();
            }
          });
          chrome.runtime.onMessage.addListener((message) => {
            if (!message || !message.__relay)
              return;
            this.handleRuntimeEvent(message);
          });
          this.elements.guideNextBtn?.addEventListener("click", () => this.nextGuideStep());
          this.elements.guideBackBtn?.addEventListener("click", () => this.previousGuideStep());
          this.elements.guideSkipBtn?.addEventListener("click", () => this.dismissGuide());
          this.elements.guideDoneBtn?.addEventListener("click", () => this.dismissGuide());
        }
        getSelectedPlatform() {
          return this.elements.platformSelect.value === "instagram" ? "instagram" : "x";
        }
        getSelectedTarget() {
          return this.elements.targetSelect.value || "all";
        }
        getSelectedAdapter() {
          return getPlatformAdapter(this.getSelectedPlatform());
        }
        renderPlatformControls() {
          const platform = this.state.settings.selectedPlatform;
          const target = this.state.settings.selectedTarget;
          const adapter = getPlatformAdapter(platform);
          const targets = adapter.getAllTargets();
          this.elements.platformSelect.value = platform;
          this.elements.targetSelect.innerHTML = "";
          const allOption = document.createElement("option");
          allOption.value = "all";
          allOption.textContent = "All Supported Targets";
          this.elements.targetSelect.appendChild(allOption);
          targets.forEach((item) => {
            const option = document.createElement("option");
            option.value = item;
            option.textContent = adapter.getTargetLabel(item);
            this.elements.targetSelect.appendChild(option);
          });
          this.elements.targetSelect.value = targets.includes(target) ? target : "all";
          this.elements.extractAllBtn.textContent = `Extract All For ${adapter.label}`;
          const username = this.state.settings.settingsByPlatform[platform]?.username || "";
          this.elements.usernameInput.value = username ? `@${username}` : "";
          this.updateConditionalFields();
        }
        updateConditionalFields() {
          const adapter = this.getSelectedAdapter();
          const target = this.getSelectedTarget();
          const schemaTarget = target === "all" ? adapter.getAllTargets()[0] : target;
          const schema = adapter.getInputSchema(schemaTarget);
          const usernameField = schema.find((item) => item.key === "username");
          const requiresUsername = Boolean(usernameField);
          this.elements.usernameField.hidden = !requiresUsername;
          if (usernameField) {
            this.elements.usernameLabel.textContent = usernameField.label;
          }
          this.elements.usernameInput.disabled = !requiresUsername || this.state.running;
        }
        setStatus(text, tone = "idle") {
          this.elements.statusText.textContent = text;
          this.setAppState(tone);
        }
        setAppState(tone) {
          if (!this.elements.appRoot)
            return;
          this.elements.appRoot.classList.remove("state-idle", "state-running", "state-success", "state-error");
          this.elements.appRoot.classList.add(`state-${tone === "running" || tone === "success" || tone === "error" ? tone : "idle"}`);
        }
        setProgress(value) {
          const clamped = Math.max(0, Math.min(100, value));
          this.state.progress = clamped;
          this.elements.progressBar.value = clamped;
          this.elements.progressLabel.textContent = `${clamped}%`;
        }
        setRunning(isRunning) {
          this.state.running = isRunning;
          if (isRunning) {
            this.setAppState("running");
            this.clearExportCta();
          }
          this.elements.platformSelect.disabled = isRunning;
          this.elements.targetSelect.disabled = isRunning;
          this.elements.extractSelectedBtn.disabled = isRunning;
          this.elements.extractAllBtn.disabled = isRunning;
          this.elements.exportBtn.disabled = isRunning;
          this.updateConditionalFields();
        }
        async loadSettings() {
          const response = await sendRuntimeMessage({ type: MESSAGE_TYPES.XA_GET_SETTINGS }).catch(() => ({ success: false }));
          if (response.success && response.settings) {
            const settings = response.settings;
            this.state.settings = {
              ...this.state.settings,
              ...settings,
              settingsByPlatform: {
                x: {
                  username: normalizeUsername(settings.settingsByPlatform?.x?.username || settings.username || "")
                },
                instagram: {
                  username: normalizeUsername(settings.settingsByPlatform?.instagram?.username || "")
                }
              }
            };
          }
        }
        async savePlatformSettings() {
          const platform = this.getSelectedPlatform();
          const payload = {
            selectedPlatform: platform,
            selectedTarget: this.getSelectedTarget(),
            settingsByPlatform: {
              ...this.state.settings.settingsByPlatform,
              x: {
                username: platform === "x" ? normalizeUsername(this.elements.usernameInput.value) : normalizeUsername(this.state.settings.settingsByPlatform.x.username || "")
              },
              instagram: {
                username: platform === "instagram" ? normalizeUsername(this.elements.usernameInput.value) : normalizeUsername(this.state.settings.settingsByPlatform.instagram.username || "")
              }
            }
          };
          const response = await sendRuntimeMessage({
            type: MESSAGE_TYPES.XA_SAVE_SETTINGS,
            payload
          }).catch((error) => ({ success: false, error: error.message }));
          if (!response.success) {
            return false;
          }
          this.state.settings = {
            ...this.state.settings,
            ...response.settings
          };
          this.renderPlatformControls();
          return true;
        }
        handlePlatformChange() {
          this.state.settings.selectedPlatform = this.getSelectedPlatform();
          this.state.settings.selectedTarget = "all";
          this.renderPlatformControls();
          this.savePlatformSettings();
        }
        handleTargetChange() {
          this.state.settings.selectedTarget = this.getSelectedTarget();
          this.updateConditionalFields();
          this.savePlatformSettings();
        }
        shouldShowOnboardingGuide() {
          return !this.state.settings.onboardingSeen || this.state.settings.guideVersion !== GUIDE_VERSION;
        }
        openGuide() {
          if (!this.elements.guideOverlay)
            return;
          this.state.guideStep = 0;
          this.elements.guideOverlay.hidden = false;
          this.renderGuideStep();
        }
        renderGuideStep() {
          const step = GUIDE_STEPS[this.state.guideStep];
          if (!step)
            return;
          this.elements.guideTitle.textContent = step.title;
          this.elements.guideBody.textContent = step.body;
          this.elements.guideStepLabel.textContent = `Step ${this.state.guideStep + 1} of ${GUIDE_STEPS.length}`;
          this.elements.guideBackBtn.hidden = this.state.guideStep === 0;
          this.elements.guideNextBtn.hidden = this.state.guideStep >= GUIDE_STEPS.length - 1;
          this.elements.guideDoneBtn.hidden = this.state.guideStep < GUIDE_STEPS.length - 1;
        }
        nextGuideStep() {
          if (this.state.guideStep >= GUIDE_STEPS.length - 1)
            return;
          this.state.guideStep += 1;
          this.renderGuideStep();
        }
        previousGuideStep() {
          if (this.state.guideStep <= 0)
            return;
          this.state.guideStep -= 1;
          this.renderGuideStep();
        }
        async dismissGuide() {
          this.elements.guideOverlay.hidden = true;
          const response = await sendRuntimeMessage({
            type: MESSAGE_TYPES.XA_SAVE_SETTINGS,
            payload: {
              onboardingSeen: true,
              guideVersion: GUIDE_VERSION,
              selectedPlatform: this.getSelectedPlatform(),
              selectedTarget: this.getSelectedTarget(),
              settingsByPlatform: this.state.settings.settingsByPlatform
            }
          }).catch((error) => ({ success: false, error: error.message }));
          if (!response.success) {
            this.setStatus("Guide state was not saved", "error");
            return;
          }
          this.state.settings = {
            ...this.state.settings,
            ...response.settings
          };
        }
        async refreshRecordCount() {
          const response = await sendRuntimeMessage({
            type: MESSAGE_TYPES.DATA_QUERY,
            payload: {
              platform: "all",
              target: "all",
              page: { offset: 0, limit: 1 }
            }
          }).catch(() => ({ success: false }));
          if (!response.success)
            return;
          this.state.recordCount = typeof response.total === "number" ? response.total : (response.records || []).length;
        }
        clearExportCta() {
          if (this.exportCtaTimer) {
            clearTimeout(this.exportCtaTimer);
            this.exportCtaTimer = null;
          }
          this.elements.exportBtn.classList.remove("action-attention");
        }
        pulseExportCta() {
          this.clearExportCta();
          this.elements.exportBtn.classList.add("action-attention");
          this.exportCtaTimer = setTimeout(() => this.clearExportCta(), 3e3);
        }
        handleExtractionCompletion(totalCount) {
          this.setProgress(100);
          this.refreshRecordCount().catch(() => {
          });
          this.setRunning(false);
          if (totalCount > 0) {
            this.setStatus(`Extraction complete (${totalCount} records). Ready to export.`, "success");
            this.pulseExportCta();
            return;
          }
          this.setStatus("No records found. Try scrolling and extract again.", "error");
        }
        handleExtractionFailure(message, code = "") {
          if (code === "INSTAGRAM_COLLECTION_INDEX_UNRESOLVED") {
            this.setStatus("Instagram saved collections loaded, but All posts could not be opened automatically.", "error");
            return;
          }
          if (code === "INSTAGRAM_GRID_EMPTY") {
            this.setStatus("Instagram All posts loaded, but no extractable saved items were found.", "error");
            return;
          }
          if (code === "INSTAGRAM_PAGE_UNSUPPORTED") {
            this.setStatus("Instagram saved page structure is not supported by the current extractor.", "error");
            return;
          }
          this.setStatus(message || "Extraction failed", "error");
        }
        async startExtraction(targetOverride) {
          if (this.state.running)
            return;
          await this.savePlatformSettings();
          const platform = this.getSelectedPlatform();
          const target = targetOverride || this.getSelectedTarget();
          const rawInput = {
            username: normalizeUsername(this.elements.usernameInput.value)
          };
          const adapter = getPlatformAdapter(platform);
          const validationTarget = target === "all" ? adapter.getAllTargets()[0] : target;
          const inputValidation = adapter.validateInput(validationTarget, rawInput);
          if (!inputValidation.valid) {
            this.setStatus(inputValidation.error, "error");
            this.setProgress(0);
            return;
          }
          const input = rawInput;
          this.setRunning(true);
          this.setProgress(2);
          this.setStatus(`Starting ${platform}/${target} extraction...`, "running");
          const response = await sendRuntimeMessage({
            type: MESSAGE_TYPES.XA_START_EXTRACTION,
            payload: {
              platform,
              target,
              mode: "full",
              input
            }
          }).catch((error) => ({ success: false, error: error.message }));
          if (!response.success) {
            this.handleExtractionFailure(response.error, response.code);
            this.setRunning(false);
            this.setProgress(0);
            return;
          }
          this.handleExtractionCompletion(Number(response.totalCount || 0));
        }
        exportDataForFormat(records, format) {
          if (format === "json") {
            return {
              content: JSON.stringify(generateJSONExport(records, { platform: "all", target: "all" }), null, 2),
              extension: "json",
              mime: "application/json"
            };
          }
          if (format === "csv") {
            return {
              content: generateCSVExport(records, { platform: "all", target: "all" }),
              extension: "csv",
              mime: "text/csv"
            };
          }
          if (format === "md") {
            return {
              content: generateMarkdownExport(records, { platform: "all", target: "all" }),
              extension: "md",
              mime: "text/markdown"
            };
          }
          if (format === "txt") {
            return {
              content: generateTextExport(records, { platform: "all", target: "all" }),
              extension: "txt",
              mime: "text/plain"
            };
          }
          throw new Error(`Unsupported export format: ${format}`);
        }
        async exportData() {
          if (this.state.running)
            return;
          const response = await sendRuntimeMessage({
            type: MESSAGE_TYPES.DATA_QUERY,
            payload: {
              platform: "all",
              target: "all",
              page: { offset: 0, limit: 5e3 }
            }
          }).catch((error) => ({ success: false, error: error.message }));
          if (!response.success) {
            this.setStatus(response.error || "Failed to load records for export", "error");
            return;
          }
          const records = response.records || [];
          if (records.length === 0) {
            this.setStatus("No records to export", "error");
            return;
          }
          const format = this.elements.exportFormat.value;
          const timestamp = Date.now();
          try {
            const output = this.exportDataForFormat(records, format);
            const filename = `social-assistant-report-${timestamp}.${output.extension}`;
            downloadTextFile(output.content, filename, output.mime);
            this.setStatus(`Exported ${records.length} records as ${format.toUpperCase()}`, "success");
          } catch (error) {
            this.setStatus(error.message || "Export failed", "error");
          }
        }
        handleRuntimeEvent(message) {
          if (message.type === MESSAGE_TYPES.EXTRACTION_PROGRESS) {
            const captured = Number(message.capturedCount || 0);
            const scanned = Number(message.scannedCount || 0);
            const denominator = Math.max(scanned, captured, 1);
            const pct = Math.min(95, Math.round(captured / denominator * 100));
            this.setProgress(pct);
            this.setStatus(message.status || "Extraction in progress...", "running");
            return;
          }
          if (message.type === MESSAGE_TYPES.EXTRACTION_ERROR) {
            this.handleExtractionFailure(message.message, message.code);
            this.setProgress(0);
            this.setRunning(false);
            return;
          }
          if (message.type === MESSAGE_TYPES.EXTRACTION_COMPLETE) {
            this.handleExtractionCompletion(Number(message.totalCount || 0));
          }
        }
      };
      document.addEventListener("DOMContentLoaded", () => {
        new PopupApp();
      });
      if (typeof module !== "undefined" && module.exports) {
        module.exports = {
          PopupApp,
          sendRuntimeMessage,
          normalizeUsername
        };
      }
    }
  });
  require_popup();
})();
//# sourceMappingURL=popup.js.map
