import { isClassifiedPath, resolveUrl } from '../core/utils.js';

export function createLocationInterceptor({ navigationStore, windowObject = window }) {
  function consumePendingNewTabForUrl(rawUrl) {
    const pending = navigationStore.loadPendingNewTab();
    if (!pending) return false;
    if (!pending.createdAt || Date.now() - pending.createdAt > 10000) {
      navigationStore.clearPendingNewTab();
      return false;
    }

    const target = resolveUrl(rawUrl);
    if (!target || !isClassifiedPath(target.pathname)) return false;

    navigationStore.clearPendingNewTab();
    try {
      windowObject.open(target.href, pending.token);
      return true;
    } catch (_) {
      return false;
    }
  }

  function install() {
    if (windowObject.__mlfNavPatched) return;
    windowObject.__mlfNavPatched = true;

    const locationProto = Object.getPrototypeOf(windowObject.location);

    try {
      const assign = locationProto.assign;
      if (typeof assign === 'function') {
        locationProto.assign = function patchedAssign(url) {
          if (this === windowObject.location && consumePendingNewTabForUrl(url)) return;
          return assign.call(this, url);
        };
      }
    } catch (_) {}

    try {
      const replace = locationProto.replace;
      if (typeof replace === 'function') {
        locationProto.replace = function patchedReplace(url) {
          if (this === windowObject.location && consumePendingNewTabForUrl(url)) return;
          return replace.call(this, url);
        };
      }
    } catch (_) {}

    try {
      const hrefDescriptor = Object.getOwnPropertyDescriptor(locationProto, 'href');
      if (hrefDescriptor && typeof hrefDescriptor.get === 'function' &&
          typeof hrefDescriptor.set === 'function' && hrefDescriptor.configurable) {
        Object.defineProperty(locationProto, 'href', {
          configurable: true,
          enumerable: hrefDescriptor.enumerable,
          get() {
            return hrefDescriptor.get.call(this);
          },
          set(url) {
            if (this === windowObject.location && consumePendingNewTabForUrl(url)) return;
            return hrefDescriptor.set.call(this, url);
          },
        });
      }
    } catch (_) {}
  }

  return { consumePendingNewTabForUrl, install };
}

