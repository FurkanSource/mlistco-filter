import { isListingsPath, log } from '../core/utils.js';

export function createHistoryWatcher({ autoLoadCards, windowObject = window }) {
  let lastPath = windowObject.location.pathname;

  function install() {
    if (windowObject.__mlfHistoryPatched) return;
    windowObject.__mlfHistoryPatched = true;

    const onChange = () => {
      if (windowObject.location.pathname === lastPath) return;
      lastPath = windowObject.location.pathname;
      log('url changed →', lastPath);
      if (isListingsPath(lastPath)) {
        setTimeout(() => { autoLoadCards(); }, 800);
      }
    };

    for (const method of ['pushState', 'replaceState']) {
      const original = windowObject.history[method];
      if (typeof original !== 'function') continue;
      windowObject.history[method] = function patchedHistoryMethod(...args) {
        const result = original.apply(this, args);
        onChange();
        return result;
      };
    }
    windowObject.addEventListener('popstate', onChange);
    windowObject.addEventListener('hashchange', onChange);
  }

  return { install };
}
