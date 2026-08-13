import { CARD_SELECTOR, MIN_FILTER_CARS } from '../config.js';

export function getCards(root = globalThis.document, selector = CARD_SELECTOR) {
  return Array.from(root.querySelectorAll(selector));
}

export function showAllCards(cards) {
  for (const card of cards) card.style.display = '';
}

export function getFilterGateState(
  active,
  {
    cards = null,
    root = globalThis.document,
    selector = CARD_SELECTOR,
    minFilterCars = MIN_FILTER_CARS,
  } = {},
) {
  const resolvedCards = cards || getCards(root, selector);
  return {
    cards: resolvedCards,
    count: resolvedCards.length,
    active,
    ready: resolvedCards.length >= minFilterCars,
  };
}
