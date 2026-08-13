import { CARD_SELECTOR } from '../config.js';

export function isListingCard(card) {
  if (!card) return false;
  if (String(card.textContent || '').trim()) return true;
  return Boolean(card.querySelector && card.querySelector('img[src], source[srcset], a[href*="/classified/"]'));
}

export function getCards(root = globalThis.document, selector = CARD_SELECTOR) {
  return Array.from(root.querySelectorAll(selector)).filter(isListingCard);
}

export function showAllCards(cards) {
  for (const card of cards) card.style.display = '';
}
