import { CARD_SELECTOR } from '../config.js';
import { isListingsPath, log } from '../core/utils.js';
import { getCards, showAllCards } from './cards.js';
import { matches } from './card-parser.js';
import { setStatus, updatePanelMeta } from '../ui/status.js';

export function createFilterController({
  filterStore,
  cardParser,
  documentObject = globalThis.document,
  locationObject = globalThis.location,
  MutationObserverClass = globalThis.MutationObserver,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
} = {}) {
  let lastCards = [];
  let domObserver = null;
  let applyTimer = null;

  function refreshPanelMeta() {
    updatePanelMeta(getCards(documentObject).length);
  }

  function applyFilter() {
    const cards = getCards(documentObject);
    lastCards = cards;
    if (!cards.length && isListingsPath(locationObject.pathname)) {
      log('card selector matched nothing', CARD_SELECTOR);
      setStatus('No listings found — the page markup may have changed', 'warning');
      refreshPanelMeta();
      return;
    }
    showAllCards(cards);
    const parsedCards = cards.map((card) => cardParser.parseCardCached(card));
    const mileageFilterActive = filterStore.state.milesMin != null || filterStore.state.milesMax != null;
    const unknownMileage = mileageFilterActive
      ? parsedCards.filter((parsed) => parsed.miles == null).length
      : 0;
    let shown = 0;
    for (let index = 0; index < cards.length; index++) {
      const visible = matches(parsedCards[index], filterStore.state);
      cards[index].style.display = visible ? '' : 'none';
      if (visible) shown++;
    }
    const coverage = unknownMileage ? ` | ${unknownMileage} mileage unknown` : '';
    const tone = unknownMileage ? 'warning' : shown === cards.length ? 'neutral' : 'success';
    setStatus(`${shown} of ${cards.length} shown${coverage}`, tone);
    refreshPanelMeta();
  }

  function applyFilterIfActive() {
    if (filterStore.hasAnyFilter()) applyFilter();
    else refreshPanelMeta();
  }

  function scheduleApplyIfActive(delayMs = 100) {
    if (!filterStore.hasAnyFilter() || !isListingsPath(locationObject.pathname)) return;
    clearTimeoutFn(applyTimer);
    applyTimer = setTimeoutFn(() => {
      applyTimer = null;
      applyFilterIfActive();
    }, delayMs);
  }

  function installDomWatcher() {
    if (domObserver || !MutationObserverClass || !documentObject.body) return;
    domObserver = new MutationObserverClass((records) => {
      const relevant = records.some((record) => {
        const target = record.target && record.target.nodeType === 1
          ? record.target
          : record.target && record.target.parentElement;
        if (target && target.closest && target.closest('#mlf-panel')) return false;
        if (record.type === 'attributes') return true;
        return record.addedNodes.length > 0 || record.removedNodes.length > 0;
      });
      if (relevant) scheduleApplyIfActive();
    });
    domObserver.observe(documentObject.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src', 'srcset', 'href', 'data-src', 'data-original'],
    });
  }

  function disconnectDomWatcher() {
    clearTimeoutFn(applyTimer);
    applyTimer = null;
    if (domObserver) domObserver.disconnect();
    domObserver = null;
  }

  function resetVisibleCards() {
    showAllCards(lastCards);
  }

  return {
    applyFilter,
    applyFilterIfActive,
    disconnectDomWatcher,
    installDomWatcher,
    refreshPanelMeta,
    resetVisibleCards,
    scheduleApplyIfActive,
  };
}
