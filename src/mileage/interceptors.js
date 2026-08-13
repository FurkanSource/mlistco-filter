import { log } from '../core/utils.js';
import { MAX_BODY_BYTES, MAX_INFLIGHT_READS } from '../config.js';

export function isJsonContentType(value) {
  return typeof value === 'string' && /\bjson\b/i.test(value);
}

export function createDataInterceptors({
  ingestText,
  ingestValue,
  logger = log,
  windowObject = window,
} = {}) {
  let inflightReads = 0;

  function maybeIngestResponse(response) {
    if (!response || !response.headers || typeof response.clone !== 'function') return;
    if (!isJsonContentType(response.headers.get('content-type'))) return;
    const length = Number(response.headers.get('content-length'));
    if (Number.isFinite(length) && length > MAX_BODY_BYTES) return;
    if (inflightReads >= MAX_INFLIGHT_READS) return;
    inflightReads++;
    response.clone().text()
      .then((text) => {
        inflightReads--;
        ingestText(text);
      })
      .catch(() => {
        inflightReads--;
      });
  }

  function install() {
    if (windowObject.__mlfDataPatched) return;
    windowObject.__mlfDataPatched = true;

    const originalFetch = windowObject.fetch;
    if (typeof originalFetch === 'function') {
      windowObject.fetch = function patchedFetch() {
        const result = originalFetch.apply(this, arguments);
        if (!result || typeof result.then !== 'function') return result;
        return result.then((response) => {
          try {
            maybeIngestResponse(response);
          } catch (_) {}
          return response;
        });
      };
    }

    const XHR = windowObject.XMLHttpRequest;
    if (XHR && XHR.prototype) {
      const open = XHR.prototype.open;
      const send = XHR.prototype.send;
      XHR.prototype.open = function patchedOpen(method, url) {
        this.__mlfUrl = String(url || '');
        return open.apply(this, arguments);
      };
      XHR.prototype.send = function patchedSend() {
        try {
          this.addEventListener('load', () => {
            try {
              const type = this.getResponseHeader && this.getResponseHeader('content-type');
              if (!isJsonContentType(type)) return;
              const responseType = this.responseType;
              if (responseType === '' || responseType === 'text') ingestText(this.responseText);
              else if (responseType === 'json') ingestValue(this.response);
            } catch (_) {}
          });
        } catch (_) {}
        return send.apply(this, arguments);
      };
    }

    logger('data interceptors installed');
  }

  return { install, maybeIngestResponse };
}
