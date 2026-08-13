import assert from 'node:assert/strict';
import test from 'node:test';
import { MILEAGE_CACHE_KEY } from '../src/config.js';
import { createMileageRegistry, numericValue, signatureOf } from '../src/mileage/registry.js';
import { createMemoryStorage } from './helpers/memory-storage.js';

function record(overrides = {}) {
  return {
    _id: 'car-a',
    Slug: '2022-bmw-m3',
    title_text: '2022 BMW M3',
    price_text: '65000',
    mileage_text: '12,345',
    seller_location_text: 'New York, NY',
    all_images_list_image: ['//assets.cdn.bubble.io/f1786411111111x111111111111111111/car.jpg'],
    ...overrides,
  };
}

test('duplicate records do not bump the registry version or callback twice', () => {
  const storage = createMemoryStorage();
  let changes = 0;
  const registry = createMileageRegistry({
    storage,
    logger: () => {},
    onRegistryChanged: () => changes++,
  });

  assert.equal(registry.ingestValue(record()), 1);
  assert.equal(registry.getVersion(), 1);
  assert.equal(changes, 1);
  assert.equal(registry.ingestValue(record()), 0);
  assert.equal(registry.getVersion(), 1);
  assert.equal(changes, 1);
});

test('a live record replaces stale mileage for the same stable ID', () => {
  const registry = createMileageRegistry({ storage: createMemoryStorage(), logger: () => {} });
  registry.ingestValue(record({ mileage_text: '12,345' }));
  registry.ingestValue(record({ mileage_text: '13,500' }));

  const card = {
    outerHTML: '<img src="https://assets.cdn.bubble.io/f1786411111111x111111111111111111/car.jpg">',
    innerText: '2022 BMW M3 $65,000 New York, NY',
    querySelectorAll: () => [],
  };
  assert.equal(registry.lookupMiles(card, { price: 65000 }), 13500);
  assert.equal(registry.getStats().records, 1);
  assert.equal(registry.getVersion(), 2);
});

test('a richer bulk record upgrades a partial record without becoming ambiguous', () => {
  const registry = createMileageRegistry({ storage: createMemoryStorage(), logger: () => {} });
  registry.ingestValue({
    Slug: '2022-bmw-m3',
    mileage_text: '12,345',
  });
  registry.ingestValue(record());

  const card = {
    outerHTML: '<img src="https://assets.cdn.bubble.io/f1786411111111x111111111111111111/car.jpg">',
    innerText: '2022 BMW M3 $65,000 New York, NY',
    querySelectorAll: () => [],
  };
  assert.equal(registry.lookupMiles(card, { price: 65000 }), 12345);
  assert.deepEqual(registry.getStats(), { records: 1, assets: 1, ambiguousAssets: 0 });
});

test('legacy records never fall back to response position or price and year alone', () => {
  const storage = createMemoryStorage();
  const registry = createMileageRegistry({ storage, logger: () => {} });
  registry.ingestValue([
    { id: 'a', price: 20000, year: 2020, mileage: 10000 },
    { id: 'b', price: 20000, year: 2020, mileage: 20000 },
  ]);

  assert.equal(registry.lookupMiles({ price: 20000, year: 2020 }), null);
  assert.equal(registry.lookupMiles({ price: null, year: null }, 0), null);
});

test('v1 and malformed caches are ignored while valid v2 records load', () => {
  const now = 1_800_000_000_000;
  const storage = createMemoryStorage({
    mlf_mileage_v1: JSON.stringify([{ p: 30000, y: 2022, m: 7654 }]),
    [MILEAGE_CACHE_KEY]: '{bad json',
  });
  const registry = createMileageRegistry({ storage, logger: () => {}, now: () => now });
  assert.doesNotThrow(() => registry.loadCache());
  assert.equal(registry.getStats().records, 0);

  storage.setItem(MILEAGE_CACHE_KEY, JSON.stringify({
    version: 2,
    savedAt: now,
    records: [{
      i: 'cached-car',
      s: '2024-bmw-m4',
      m: 7654,
      t: '2024 BMW M4',
      p: 70000,
      y: 2024,
      l: 'Brooklyn, NY',
      a: 'f1786422222222x222222222222222222',
    }],
  }));
  registry.loadCache();
  assert.equal(registry.getStats().records, 1);
});

test('detail initialization JSON records remain ingestible as a fallback', () => {
  const registry = createMileageRegistry({ storage: createMemoryStorage(), logger: () => {} });
  const changed = registry.ingestText(JSON.stringify([{
    id: 'classified-record',
    data: record({ _id: 'detail-car', mileage_text: '9,000' }),
    type: 'custom.classifieds',
  }]), 'https://mlistco.com/api/1.1/init/data?location=detail');

  assert.equal(changed, 1);
  assert.equal(registry.getStats().records, 1);
});

test('storage events merge cross-tab records without writing them back', () => {
  const sourceStorage = createMemoryStorage();
  const source = createMileageRegistry({ storage: sourceStorage, logger: () => {} });
  source.ingestValue(record());

  let writes = 0;
  const destinationStorage = {
    getItem: () => null,
    setItem: () => { writes++; },
  };
  let storageHandler;
  let changes = 0;
  const destination = createMileageRegistry({
    storage: destinationStorage,
    logger: () => {},
    onRegistryChanged: () => changes++,
  });
  destination.installStorageSync({
    addEventListener(type, handler) {
      if (type === 'storage') storageHandler = handler;
    },
  });

  storageHandler({
    key: MILEAGE_CACHE_KEY,
    newValue: sourceStorage.getItem(MILEAGE_CACHE_KEY),
  });
  assert.equal(destination.getStats().records, 1);
  assert.equal(destination.getVersion(), 1);
  assert.equal(changes, 1);
  assert.equal(writes, 0);
});

test('an older cross-tab cache cannot overwrite newer mileage', () => {
  const newerStorage = createMemoryStorage();
  const newer = createMileageRegistry({ storage: newerStorage, logger: () => {}, now: () => 2000 });
  newer.ingestValue(record({ mileage_text: '13,500' }));

  const olderStorage = createMemoryStorage();
  const older = createMileageRegistry({ storage: olderStorage, logger: () => {}, now: () => 1000 });
  older.ingestValue(record({ mileage_text: '12,345' }));

  let storageHandler;
  newer.installStorageSync({
    addEventListener(type, handler) {
      if (type === 'storage') storageHandler = handler;
    },
  });
  storageHandler({ key: MILEAGE_CACHE_KEY, newValue: olderStorage.getItem(MILEAGE_CACHE_KEY) });

  const card = {
    outerHTML: '<img src="https://assets.cdn.bubble.io/f1786411111111x111111111111111111/car.jpg">',
    innerText: '2022 BMW M3 $65,000 New York, NY',
    querySelectorAll: () => [],
  };
  assert.equal(newer.lookupMiles(card, { price: 65000 }), 13500);
});

test('mileage helpers preserve numeric and signature behavior', () => {
  assert.equal(signatureOf(100, 2020), '100|2020');
  assert.equal(signatureOf(null, 2020), null);
  assert.equal(numericValue('$12,345'), 12345);
  assert.equal(numericValue('unknown'), null);
});
