(function () {
  const MATCHERS = ['bookmarks', 'likes'];

  function shouldCapture(url) {
    if (!url) return false;
    const normalized = String(url).toLowerCase();
    return MATCHERS.some((token) => normalized.includes(token));
  }

  function dispatchPayload(url, body) {
    if (!shouldCapture(url)) return;

    try {
      const parsed = JSON.parse(body);
      window.dispatchEvent(new CustomEvent('x-assistant-network', {
        detail: {
          url,
          payload: parsed,
          capturedAt: Date.now()
        }
      }));
    } catch (error) {
      // Ignore non-JSON responses
    }
  }

  const XHR = XMLHttpRequest.prototype;
  const nativeOpen = XHR.open;
  const nativeSend = XHR.send;

  XHR.open = function open(method, url) {
    this._xaUrl = url;
    return nativeOpen.apply(this, arguments);
  };

  XHR.send = function send() {
    this.addEventListener('load', function onLoad() {
      if (this._xaUrl && shouldCapture(this._xaUrl)) {
        dispatchPayload(this._xaUrl, this.responseText);
      }
    });

    return nativeSend.apply(this, arguments);
  };

  const nativeFetch = window.fetch;
  window.fetch = async function patchedFetch(...args) {
    const response = await nativeFetch.apply(this, args);

    try {
      const clone = response.clone();
      const url = clone.url || args[0]?.toString() || '';
      if (shouldCapture(url)) {
        clone.text().then((body) => dispatchPayload(url, body)).catch(() => {});
      }
    } catch (error) {
      // Ignore fetch inspection errors
    }

    return response;
  };
})();
