import { CARD_SELECTOR } from '../config.js';
import { isListingsPath, log } from '../core/utils.js';
import { setStatus } from '../ui/status.js';

export function createTabContinuity({
  navigationStore,
  getCards,
  getNativeFilterState,
  windowObject = window,
}) {
  function installNewTabHook() {
    if (windowObject.__mlfClickHookInstalled) return;
    windowObject.__mlfClickHookInstalled = true;

    document.addEventListener('click', (event) => {
      if (!isListingsPath(location.pathname)) return;
      const card = event.target.closest(CARD_SELECTOR);
      if (!card) return;
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.button !== 0) return;
      const token = `mlf-tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const popup = windowObject.open('about:blank', token);
      if (!popup) {
        console.warn('[MListFilter] popup blocked; cannot open listing in new tab');
        setStatus('Allow popups to keep your place', 'warning');
        return;
      }

      navigationStore.savePendingNewTab({
        token,
        sourceUrl: location.href,
        scrollY: windowObject.scrollY,
        cardCount: getCards().length,
        nativeFilters: getNativeFilterState(),
        createdAt: Date.now(),
      });
      log('saved pending new-tab state', navigationStore.loadPendingNewTab());

      setTimeout(() => {
        const latest = navigationStore.loadPendingNewTab();
        if (latest && latest.token === token) navigationStore.clearPendingNewTab();
      }, 4000);
    }, true);
  }

  function finalizePendingNewTab() {
    const pending = navigationStore.loadPendingNewTab();
    if (!pending) return;

    if (!pending.createdAt || Date.now() - pending.createdAt > 15000) {
      navigationStore.clearPendingNewTab();
      return;
    }

    if (isListingsPath(location.pathname)) return;

    navigationStore.clearPendingNewTab();

    try {
      windowObject.open(location.href, pending.token);
    } catch (_) {}

    navigationStore.saveReturnState({
      sourceUrl: pending.sourceUrl,
      scrollY: pending.scrollY || 0,
      cardCount: pending.cardCount || getCards().length,
      nativeFilters: pending.nativeFilters || [],
      createdAt: Date.now(),
    });
    log('saved return state', navigationStore.loadReturnState());

    setTimeout(() => {
      if (history.length > 1) {
        history.back();
      } else if (pending.sourceUrl) {
        location.replace(pending.sourceUrl);
      }
    }, 50);
  }

  return { finalizePendingNewTab, installNewTabHook };
}

