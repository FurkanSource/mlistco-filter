import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { JSDOM, VirtualConsole } from 'jsdom';
import { createFilterStore } from '../src/filters/filter-store.js';
import { createMileageRegistry } from '../src/mileage/registry.js';
import { createNavigationStore } from '../src/navigation/session-store.js';

function denyGlobalStorage(name) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, {
    configurable: true,
    get() {
      throw new Error(`${name} denied`);
    },
  });
  return () => {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  };
}

test('blocked Web Storage falls back without preventing startup', () => {
  const restoreLocalStorage = denyGlobalStorage('localStorage');
  const restoreSessionStorage = denyGlobalStorage('sessionStorage');

  try {
    let filterStore;
    assert.doesNotThrow(() => { filterStore = createFilterStore(); });
    assert.equal(filterStore.state.query, '');
    assert.doesNotThrow(() => filterStore.save());
    assert.doesNotThrow(() => filterStore.reset());

    let mileageRegistry;
    assert.doesNotThrow(() => { mileageRegistry = createMileageRegistry({ logger: () => {} }); });
    assert.doesNotThrow(() => mileageRegistry.loadCache());
    assert.doesNotThrow(() => mileageRegistry.ingestValue({ year: 2024, price: 20000, mileage: 5000 }));

    let navigationStore;
    assert.doesNotThrow(() => { navigationStore = createNavigationStore(); });
    assert.equal(navigationStore.loadPendingNewTab(), null);
    assert.doesNotThrow(() => navigationStore.savePendingNewTab({ token: 'blocked' }));
    assert.doesNotThrow(() => navigationStore.clearPendingNewTab());
  } finally {
    restoreSessionStorage();
    restoreLocalStorage();
  }
});

test('generated userscript still mounts when the page denies Web Storage', async () => {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
    url: 'https://mlistco.com/about',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole: new VirtualConsole(),
  });

  try {
    for (const name of ['localStorage', 'sessionStorage']) {
      Object.defineProperty(dom.window, name, {
        configurable: true,
        get() {
          throw new dom.window.DOMException(`${name} denied`, 'SecurityError');
        },
      });
    }

    const userscript = await readFile(new URL('../mlistco-filter.user.js', import.meta.url), 'utf8');
    assert.doesNotThrow(() => dom.window.eval(userscript));
    dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
    await new Promise((resolve) => dom.window.setTimeout(resolve, 650));
    assert.ok(dom.window.document.getElementById('mlf-panel'));
  } finally {
    dom.window.close();
  }
});
