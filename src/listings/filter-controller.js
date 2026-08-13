import { CARD_SELECTOR, MIN_FILTER_CARS } from '../config.js';
import { isListingsPath, log } from '../core/utils.js';
import { getCards, getFilterGateState, showAllCards } from './cards.js';
import { matches } from './card-parser.js';
import { setStatus, updatePanelMeta } from '../ui/status.js';

export function createFilterController({ filterStore, cardParser }) {
  let lastCards = [];

  function refreshPanelMeta() {
    updatePanelMeta(getCards().length);
  }

  function applyFilter() {
    const gate = getFilterGateState(filterStore.hasAnyFilter());
    lastCards = gate.cards;
    if (!gate.count && isListingsPath(location.pathname)) {
      log('card selector matched nothing', CARD_SELECTOR);
      setStatus('No listings found — the page markup may have changed', 'warning');
      refreshPanelMeta();
      return;
    }
    if (gate.active && !gate.ready) {
      showAllCards(gate.cards);
      setStatus(`Load ${MIN_FILTER_CARS} listings before filtering — ${gate.count} so far`, 'loading');
      refreshPanelMeta();
      return;
    }
    showAllCards(gate.cards);
    const parsedCards = gate.cards.map((card, index) => cardParser.parseCardCached(card, index));
    let shown = 0;
    for (let index = 0; index < gate.cards.length; index++) {
      const visible = matches(parsedCards[index], filterStore.state);
      gate.cards[index].style.display = visible ? '' : 'none';
      if (visible) shown++;
    }
    setStatus(`${shown} of ${gate.cards.length} shown`, shown === gate.cards.length ? 'neutral' : 'success');
    refreshPanelMeta();
  }

  function applyFilterIfActive() {
    if (filterStore.hasAnyFilter()) applyFilter();
    else refreshPanelMeta();
  }

  function resetVisibleCards() {
    showAllCards(lastCards);
  }

  return {
    applyFilter,
    applyFilterIfActive,
    refreshPanelMeta,
    resetVisibleCards,
  };
}
