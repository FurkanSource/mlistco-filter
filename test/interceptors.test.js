import assert from 'node:assert/strict';
import test from 'node:test';
import { createDataInterceptors, isJsonContentType } from '../src/mileage/interceptors.js';

test('JSON content type recognition is case-insensitive and bounded to JSON', () => {
  assert.equal(isJsonContentType('application/json; charset=utf-8'), true);
  assert.equal(isJsonContentType('Application/Problem+JSON'), true);
  assert.equal(isJsonContentType('text/html'), false);
});

test('fetch interception preserves the original response and ingests a clone', async () => {
  const ingested = [];
  const response = {
    headers: {
      get(name) {
        if (name === 'content-type') return 'application/json';
        if (name === 'content-length') return '20';
        return null;
      },
    },
    clone() {
      return { text: async () => '{"mileage":123}' };
    },
  };
  const windowObject = {
    fetch: async () => response,
    XMLHttpRequest: null,
  };
  const interceptors = createDataInterceptors({
    ingestText: (value) => ingested.push(value),
    ingestValue: () => {},
    logger: () => {},
    windowObject,
  });

  interceptors.install();
  const returned = await windowObject.fetch('/api');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(returned, response);
  assert.deepEqual(ingested, ['{"mileage":123}']);

  const installedFetch = windowObject.fetch;
  interceptors.install();
  assert.equal(windowObject.fetch, installedFetch);
});

