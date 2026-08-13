import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { getCards, isListingCard } from '../src/listings/cards.js';

test('empty Bubble template groups are not counted as listing cards', () => {
  const dom = new JSDOM(`
    <main>
      <article class="bubble-element group-item"></article>
      <article class="bubble-element group-item">2022 BMW M3 $65,000</article>
      <article class="bubble-element group-item"><img src="vehicle.jpg"></article>
    </main>
  `);
  const candidates = dom.window.document.querySelectorAll('.group-item');

  assert.equal(isListingCard(candidates[0]), false);
  assert.equal(isListingCard(candidates[1]), true);
  assert.equal(isListingCard(candidates[2]), true);
  assert.equal(getCards(dom.window.document).length, 2);
});
