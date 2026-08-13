import { CARD_SELECTOR } from '../config.js';

export function getCards(root = globalThis.document, selector = CARD_SELECTOR) {
  return Array.from(root.querySelectorAll(selector));
}

export function showAllCards(cards) {
  for (const card of cards) card.style.display = '';
}
