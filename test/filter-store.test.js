import assert from 'node:assert/strict';
import test from 'node:test';
import { STORAGE_KEY } from '../src/config.js';
import { createFilterStore, sanitizeState } from '../src/filters/filter-store.js';
import { createMemoryStorage } from './helpers/memory-storage.js';

test('filter store loads, mutates, saves, and resets one shared state object', () => {
  const storage = createMemoryStorage({
    [STORAGE_KEY]: JSON.stringify({ query: 'civic', yearMin: 2020, hideSold: true }),
  });
  const store = createFilterStore({ storage });
  const stateReference = store.state;

  assert.equal(store.state.query, 'civic');
  assert.equal(store.hasAnyFilter(), true);
  assert.equal(store.getActiveFilterCount(), 3);

  store.state.priceMax = 25000;
  store.save();
  assert.equal(JSON.parse(storage.getItem(STORAGE_KEY)).priceMax, 25000);

  store.reset();
  assert.equal(store.state, stateReference);
  assert.equal(store.hasAnyFilter(), false);
});

test('state sanitization preserves the existing null-to-zero numeric behavior', () => {
  const sanitized = sanitizeState({
    query: 'test',
    yearMin: null,
    yearMax: '2024.4',
    hideSold: 1,
  });
  assert.equal(sanitized.yearMin, 0);
  assert.equal(sanitized.yearMax, 2024);
  assert.equal(sanitized.hideSold, true);
});

test('malformed stored JSON falls back to defaults', () => {
  const storage = createMemoryStorage({ [STORAGE_KEY]: '{bad json' });
  const store = createFilterStore({ storage });
  assert.equal(store.state.query, '');
  assert.equal(store.state.yearMin, null);
  assert.equal(store.hasAnyFilter(), false);
});

