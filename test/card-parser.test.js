import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createCardParser,
  matches,
  parseCard,
  parseMiles,
  parsePrice,
} from '../src/listings/card-parser.js';

test('price parser supports plain, thousand, and million values', () => {
  assert.equal(parsePrice('Asking $12,500'), 12500);
  assert.equal(parsePrice('Asking $12.5k'), 12500);
  assert.equal(parsePrice('Asking $1.2m'), 1200000);
  assert.equal(parsePrice('Call for price'), null);
});

test('mileage parser handles miles, labels, kilometers, and dollar values', () => {
  assert.equal(parseMiles('Odometer: 12,345'), 12345);
  assert.equal(parseMiles('12.5k miles'), 12500);
  assert.equal(parseMiles('100 km'), 62);
  assert.equal(parseMiles('$20k asking, 8k mi'), 8000);
  assert.equal(parseMiles('$12 miles'), null);
});

test('card parser extracts searchable text, year, price, mileage, and sold status', () => {
  const card = {
    innerText: 'Sold 2021 Honda Civic $21,500 18k miles',
    textContent: 'Sold 2021 Honda Civic $21,500 18k miles',
  };
  assert.deepEqual(parseCard(card), {
    text: 'sold 2021 honda civic $21,500 18k miles',
    price: 21500,
    year: 2021,
    miles: 18000,
    sold: true,
  });
});

test('matching preserves AND queries, numeric ranges, and unknown-value behavior', () => {
  const state = {
    query: 'honda civic',
    yearMin: 2020,
    yearMax: 2022,
    priceMin: 15000,
    priceMax: 25000,
    milesMin: null,
    milesMax: 30000,
    hideSold: true,
  };
  assert.equal(matches({ text: '2021 honda civic', year: 2021, price: 20000, miles: 10000, sold: false }, state), true);
  assert.equal(matches({ text: '2021 honda accord', year: 2021, price: 20000, miles: 10000, sold: false }, state), false);
  assert.equal(matches({ text: '2021 honda civic', year: null, price: null, miles: null, sold: false }, state), true);
  assert.equal(matches({ text: '2021 honda civic', year: 2021, price: 20000, miles: 10000, sold: true }, state), false);
});

test('card cache invalidates when the mileage registry version changes', () => {
  let version = 0;
  let fallbackMiles = 1000;
  const parser = createCardParser({
    mileageRegistry: {
      getVersion: () => version,
      lookupMiles: () => fallbackMiles,
    },
  });
  const card = { innerText: '2020 Honda Civic $20,000', textContent: '2020 Honda Civic $20,000' };

  assert.equal(parser.parseCardCached(card, 0).miles, 1000);
  fallbackMiles = 2000;
  assert.equal(parser.parseCardCached(card, 0).miles, 1000);
  version++;
  assert.equal(parser.parseCardCached(card, 0).miles, 2000);
});

