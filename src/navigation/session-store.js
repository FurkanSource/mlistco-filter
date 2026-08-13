import { NEW_TAB_KEY, RETURN_KEY } from '../config.js';

export function createNavigationStore({ storage } = {}) {
  const getStorage = () => storage === undefined ? globalThis.sessionStorage : storage;

  function load(key) {
    try {
      const raw = getStorage().getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function save(key, value) {
    try {
      getStorage().setItem(key, JSON.stringify(value));
    } catch (_) {}
  }

  function clear(key) {
    try {
      getStorage().removeItem(key);
    } catch (_) {}
  }

  return {
    clearPendingNewTab: () => clear(NEW_TAB_KEY),
    clearReturnState: () => clear(RETURN_KEY),
    loadPendingNewTab: () => load(NEW_TAB_KEY),
    loadReturnState: () => load(RETURN_KEY),
    savePendingNewTab: (value) => save(NEW_TAB_KEY, value),
    saveReturnState: (value) => save(RETURN_KEY, value),
  };
}
