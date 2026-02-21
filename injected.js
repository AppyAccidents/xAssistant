(() => {
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __commonJS = (cb, mod) => function __require() {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  };

  // src/injected.js
  var require_injected = __commonJS({
    "src/injected.js"() {
      (function() {
        console.log("[X Interceptor] Initializing network interceptor...");
        const dispatchData = (url, responseBody) => {
          try {
            if (!url.includes("Bookmarks"))
              return;
            const data = JSON.parse(responseBody);
            window.dispatchEvent(new CustomEvent("x-bookmarks-response", {
              detail: {
                url,
                data,
                timestamp: Date.now()
              }
            }));
          } catch (e) {
          }
        };
        const XHR = XMLHttpRequest.prototype;
        const open = XHR.open;
        const send = XHR.send;
        XHR.open = function(method, url) {
          this._url = url;
          return open.apply(this, arguments);
        };
        XHR.send = function(postData) {
          this.addEventListener("load", function() {
            if (this._url && (this._url.includes("Bookmarks") || this._url.includes("bookmarks"))) {
              dispatchData(this._url, this.responseText);
            }
          });
          return send.apply(this, arguments);
        };
        const originalFetch = window.fetch;
        window.fetch = async function(...args) {
          const response = await originalFetch.apply(this, args);
          const clone = response.clone();
          const url = clone.url;
          if (url && (url.includes("Bookmarks") || url.includes("bookmarks"))) {
            clone.text().then((body) => {
              dispatchData(url, body);
            }).catch(() => {
            });
          }
          return response;
        };
        console.log("[X Interceptor] Interceptor active.");
      })();
    }
  });
  require_injected();
})();
//# sourceMappingURL=injected.js.map
