import assert from 'node:assert/strict';
import test from 'node:test';
import { createMileageRegistry, numericValue, signatureOf } from '../src/mileage/registry.js';
import { createMemoryStorage } from './helpers/memory-storage.js';

test('mileage registry harvests nested records and resolves price/year signatures', () => {
  const storage = createMemoryStorage();
  let changes = 0;
  const registry = createMileageRegistry({ storage, logger: () => {}, onRegistryChanged: () => changes++ });

  registry.ingestValue({ payload: { cars: [{ id: 'a', price: 20000, year: 2020, mileage: 12345 }] } });
  assert.equal(registry.lookupMiles({ price: 20000, year: 2020 }), 12345);
  assert.equal(registry.getVersion(), 1);
  assert.equal(changes, 1);

  registry.ingestValue({ id: 'a', price: 20000, year: 2020, mileage: 12345 });
  assert.equal(changes, 1);
});

test('conflicting signature mileage becomes ambiguous while order fallback remains', () => {
  const storage = createMemoryStorage();
  const registry = createMileageRegistry({ storage, logger: () => {} });
  registry.ingestValue([
    { id: 'a', price: 20000, year: 2020, mileage: 10000 },
    { id: 'b', price: 20000, year: 2020, mileage: 20000 },
  ]);

  assert.equal(registry.lookupMiles({ price: 20000, year: 2020 }), null);
  assert.ok([10000, 20000].includes(registry.lookupMiles({ price: null, year: null }, 0)));
  assert.deepEqual(JSON.parse(storage.getItem('mlf_mileage_v1')), []);
});

test('mileage registry loads cached signatures and accepts JSON text', () => {
  const storage = createMemoryStorage({
    mlf_mileage_v1: JSON.stringify([{ p: 30000, y: 2022, m: 7654 }]),
  });
  const registry = createMileageRegistry({ storage, logger: () => {} });
  registry.loadCache();
  assert.equal(registry.lookupMiles({ price: 30000, year: 2022 }), 7654);

  registry.ingestText(JSON.stringify({ price: 40000, year: 2023, odometer: 9000 }));
  assert.equal(registry.lookupMiles({ price: 40000, year: 2023 }), 9000);
});

test('mileage helpers preserve numeric and signature behavior', () => {
  assert.equal(signatureOf(100, 2020), '100|2020');
  assert.equal(signatureOf(null, 2020), null);
  assert.equal(numericValue('$12,345'), 12345);
  assert.equal(numericValue('unknown'), null);
});

