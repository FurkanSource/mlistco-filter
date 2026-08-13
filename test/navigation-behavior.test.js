import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { createLocationInterceptor } from '../src/navigation/location-interceptor.js';
import { createReturnRestorer } from '../src/navigation/return-restorer.js';
import { createTabContinuity } from '../src/navigation/tab-continuity.js';

function createPendingStore(pending) {
  const calls = [];
  let current = pending;

  return {
    calls,
    store: {
      loadPendingNewTab() {
        calls.push('loadPendingNewTab');
        return current;
      },
      clearPendingNewTab() {
        calls.push('clearPendingNewTab');
        current = null;
      },
    },
    get current() {
      return current;
    },
  };
}

test('location interceptor consumes a fresh pending handoff for a classified URL', () => {
  const pending = {
    token: 'mlf-tab-123',
    createdAt: Date.now(),
  };
  const navigation = createPendingStore(pending);
  const opened = [];
  const windowObject = {
    open(url, token) {
      opened.push([url, token]);
    },
  };
  const interceptor = createLocationInterceptor({
    navigationStore: navigation.store,
    windowObject,
  });

  const consumed = interceptor.consumePendingNewTabForUrl(
    'https://mlistco.com/classified/2020-honda-civic',
  );

  assert.equal(consumed, true);
  assert.deepEqual(navigation.calls, ['loadPendingNewTab', 'clearPendingNewTab']);
  assert.equal(navigation.current, null);
  assert.deepEqual(opened, [[
    'https://mlistco.com/classified/2020-honda-civic',
    'mlf-tab-123',
  ]]);
});

test('location interceptor preserves unrelated handoffs and clears expired ones', () => {
  const freshNavigation = createPendingStore({
    token: 'fresh-tab',
    createdAt: Date.now(),
  });
  const opened = [];
  const freshInterceptor = createLocationInterceptor({
    navigationStore: freshNavigation.store,
    windowObject: { open: (...args) => opened.push(args) },
  });

  assert.equal(
    freshInterceptor.consumePendingNewTabForUrl('https://mlistco.com/listings'),
    false,
  );
  assert.equal(freshNavigation.current.token, 'fresh-tab');
  assert.deepEqual(freshNavigation.calls, ['loadPendingNewTab']);
  assert.deepEqual(opened, []);

  const expiredNavigation = createPendingStore({
    token: 'expired-tab',
    createdAt: Date.now() - 10001,
  });
  const expiredInterceptor = createLocationInterceptor({
    navigationStore: expiredNavigation.store,
    windowObject: { open: (...args) => opened.push(args) },
  });

  assert.equal(
    expiredInterceptor.consumePendingNewTabForUrl('https://mlistco.com/classified/expired'),
    false,
  );
  assert.equal(expiredNavigation.current, null);
  assert.deepEqual(expiredNavigation.calls, ['loadPendingNewTab', 'clearPendingNewTab']);
  assert.deepEqual(opened, []);
});

test('listing-card click opens a named blank tab and saves the return handoff', () => {
  const dom = new JSDOM('<!doctype html><article class="bubble-element group-item"><span>Car</span></article>', {
    url: 'https://mlistco.com/listings',
  });
  const previousDocument = globalThis.document;
  const previousLocation = globalThis.location;
  const previousSetTimeout = globalThis.setTimeout;
  const opened = [];
  const timers = [];
  let pending = null;
  let cleared = false;

  globalThis.document = dom.window.document;
  globalThis.location = dom.window.location;
  globalThis.setTimeout = (callback, milliseconds) => {
    timers.push({ callback, milliseconds });
    return timers.length;
  };
  Object.defineProperty(dom.window, 'scrollY', { configurable: true, value: 480 });
  dom.window.open = (...args) => {
    opened.push(args);
    return {};
  };

  try {
    const continuity = createTabContinuity({
      navigationStore: {
        savePendingNewTab(value) { pending = value; },
        loadPendingNewTab() { return pending; },
        clearPendingNewTab() { cleared = true; pending = null; },
      },
      getCards: () => Array(108),
      getNativeFilterState: () => [{ kind: 'native-select', value: 'Honda' }],
      windowObject: dom.window,
    });
    continuity.installNewTabHook();
    dom.window.document.querySelector('span').dispatchEvent(new dom.window.MouseEvent('click', {
      bubbles: true,
      button: 0,
    }));

    assert.equal(opened.length, 1);
    assert.equal(opened[0][0], 'about:blank');
    assert.match(opened[0][1], /^mlf-tab-\d+-[a-z0-9]{6}$/);
    assert.equal(pending.token, opened[0][1]);
    assert.equal(pending.sourceUrl, 'https://mlistco.com/listings');
    assert.equal(pending.scrollY, 480);
    assert.equal(pending.cardCount, 108);
    assert.deepEqual(pending.nativeFilters, [{ kind: 'native-select', value: 'Honda' }]);
    assert.equal(timers[0].milliseconds, 4000);

    timers[0].callback();
    assert.equal(cleared, true);
    assert.equal(pending, null);
  } finally {
    globalThis.setTimeout = previousSetTimeout;
    if (previousLocation === undefined) delete globalThis.location;
    else globalThis.location = previousLocation;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    dom.window.close();
  }
});

test('return restorer replays state in order and reapplies active custom filters', async () => {
  const calls = [];
  const saved = {
    nativeFilters: [{ id: 'make', value: 'Honda' }],
    cardCount: 87,
    scrollY: 640,
    createdAt: Date.now(),
  };
  let returnState = saved;
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;

  globalThis.document = {
    documentElement: { scrollHeight: 2000 },
  };
  globalThis.window = {
    innerHeight: 800,
    scrollY: 0,
    scrollTo(x, y) {
      calls.push(['scrollTo', x, y]);
      this.scrollY = y;
    },
  };

  try {
    const restorer = createReturnRestorer({
      navigationStore: {
        loadReturnState() {
          calls.push('loadReturnState');
          return returnState;
        },
        clearReturnState() {
          calls.push('clearReturnState');
          returnState = null;
        },
      },
      async restoreNativeFilterState(filters) {
        calls.push(['restoreNativeFilterState', filters]);
      },
      async waitForRestoredNativeFilters(filters) {
        calls.push(['waitForRestoredNativeFilters', filters]);
      },
      async autoLoadCards(...args) {
        calls.push(['autoLoadCards', ...args]);
      },
      filterStore: {
        hasAnyFilter() {
          calls.push('hasAnyFilter');
          return true;
        },
      },
      filterController: {
        applyFilter() {
          calls.push('applyFilter');
        },
      },
    });

    assert.equal(await restorer.restoreListingsPosition(), true);
    assert.equal(returnState, null);
    assert.deepEqual(calls, [
      'loadReturnState',
      'clearReturnState',
      ['restoreNativeFilterState', saved.nativeFilters],
      ['waitForRestoredNativeFilters', saved.nativeFilters],
      ['autoLoadCards', 87, false, true],
      'hasAnyFilter',
      'applyFilter',
      ['scrollTo', 0, 640],
    ]);
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
  }
});

test('return restorer rejects expired state before invoking restoration steps', async () => {
  const calls = [];
  let returnState = {
    nativeFilters: [{ id: 'make', value: 'Honda' }],
    cardCount: 200,
    scrollY: 900,
    createdAt: Date.now() - 30001,
  };
  const unexpected = () => {
    throw new Error('expired state must not be restored');
  };
  const restorer = createReturnRestorer({
    navigationStore: {
      loadReturnState() {
        calls.push('loadReturnState');
        return returnState;
      },
      clearReturnState() {
        calls.push('clearReturnState');
        returnState = null;
      },
    },
    restoreNativeFilterState: unexpected,
    waitForRestoredNativeFilters: unexpected,
    autoLoadCards: unexpected,
    filterStore: { hasAnyFilter: unexpected },
    filterController: { applyFilter: unexpected },
  });

  assert.equal(await restorer.restoreListingsPosition(), false);
  assert.equal(returnState, null);
  assert.deepEqual(calls, ['loadReturnState', 'clearReturnState']);
});
