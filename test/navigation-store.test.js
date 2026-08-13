import assert from 'node:assert/strict';
import test from 'node:test';
import { createNavigationStore } from '../src/navigation/session-store.js';
import { isMeaningfulNativeValue } from '../src/filters/native-filters.js';
import { createMemoryStorage } from './helpers/memory-storage.js';

test('navigation storage round-trips and clears both handoff records', () => {
  const storage = createMemoryStorage();
  const store = createNavigationStore({ storage });
  const pending = { token: 'tab-1', scrollY: 250, createdAt: 1 };
  const returning = { cardCount: 200, createdAt: 2 };

  store.savePendingNewTab(pending);
  store.saveReturnState(returning);
  assert.deepEqual(store.loadPendingNewTab(), pending);
  assert.deepEqual(store.loadReturnState(), returning);

  store.clearPendingNewTab();
  store.clearReturnState();
  assert.equal(store.loadPendingNewTab(), null);
  assert.equal(store.loadReturnState(), null);
});

test('native filter placeholders remain excluded', () => {
  assert.equal(isMeaningfulNativeValue('Select model'), false);
  assert.equal(isMeaningfulNativeValue('All generations'), false);
  assert.equal(isMeaningfulNativeValue('BMW'), true);
});

