import { CARD_SELECTOR } from '../config.js';
import { isListingsPath, log } from '../core/utils.js';
import { getCards, showAllCards } from './cards.js';
import { matches } from './card-parser.js';
import { setStatus, updatePanelMeta } from '../ui/status.js';

export function createFilterController({ filterStore, cardParser }) {
  let lastCards = [];

  function refreshPanelMeta() {
    updatePanelMeta(getCards().length);
  }

  function applyFilter() {
    const cards = getCards();
    lastCards = cards;
    if (!cards.length && isListingsPath(location.pathname)) {
      log('card selector matched nothing', CARD_SELECTOR);
      setStatus('No listings found — the page markup may have changed', 'warning');
      refreshPanelMeta();
      return;
    }
    showAllCards(cards);
    const parsedCards = cards.map((card, index) => cardParser.parseCardCached(card, index));
    let shown = 0;
    for (let index = 0; index < cards.length; index++) {
      const visible = matches(parsedCards[index], filterStore.state);
      cards[index].style.display = visible ? '' : 'none';
      if (visible) shown++;
    }
    setStatus(`${shown} of ${cards.length} shown`, shown === cards.length ? 'neutral' : 'success');
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
