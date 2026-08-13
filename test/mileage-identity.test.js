import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import {
  createMileageRegistry,
  extractBubbleAssetToken,
} from '../src/mileage/registry.js';
import { createMemoryStorage } from './helpers/memory-storage.js';

const MSEARCH_URL = 'https://mlistco.com/elasticsearch/msearch';

function hit({
  id,
  slug,
  title,
  price,
  mileage,
  location,
  image,
}) {
  return {
    _id: id,
    _source: {
      Slug: slug,
      title_status_text: 'Clean (Texas)',
      title_text: title,
      price_text: price,
      mileage_text: mileage,
      seller_location_text: location,
      all_images_list_image: image ? [image] : [],
    },
  };
}

function msearch(...hits) {
  return JSON.stringify({
    responses: [{ hits: { hits } }],
  });
}

function card({ title, price, location, image, href } = {}) {
  const dom = new JSDOM(`
    <article class="bubble-element group-item">
      ${href ? `<a href="${href}">` : ''}
      ${image ? `<img src="${image}" alt="${title || ''}">` : ''}
      <h2>${title || ''}</h2>
      <span>${price || ''}</span>
      <span>${location || ''}</span>
      ${href ? '</a>' : ''}
    </article>
  `);
  const element = dom.window.document.querySelector('article');
  Object.defineProperty(element, 'innerText', {
    configurable: true,
    value: [title, price, location].filter(Boolean).join('\n'),
  });
  return element;
}

function parsed({ title, price, year }) {
  return {
    text: title.toLowerCase(),
    price,
    year,
    miles: null,
    sold: false,
  };
}

test('Bubble asset tokens remain stable across original and transformed CDN URLs', () => {
  const source = '//02934c1813fc15e1a3529137486e7568.cdn.bubble.io/f1786451948072x642876819836404700/1.jpg';
  const rendered = 'https://02934c1813fc15e1a3529137486e7568.cdn.bubble.io/cdn-cgi/image/w=1024,h=683,f=auto,dpr=1,fit=contain/f1786451948072x642876819836404700/1.jpg?version=1';

  assert.equal(extractBubbleAssetToken(source), 'f1786451948072x642876819836404700');
  assert.equal(extractBubbleAssetToken(rendered), 'f1786451948072x642876819836404700');
  assert.equal(extractBubbleAssetToken('https://example.com/generic/image.jpg'), null);
});

test('msearch responses map mileage to cards by their shared Bubble image asset', () => {
  const registry = createMileageRegistry({
    storage: createMemoryStorage(),
    logger: () => {},
  });
  registry.ingestText(msearch(hit({
    id: 'car-civic',
    slug: '2020-honda-civic-sport',
    title: '2020 Honda Civic Sport',
    price: '$20,000',
    mileage: '12,345 miles',
    location: 'Staten Island, NY',
    image: '//02934c1813fc15e1a3529137486e7568.cdn.bubble.io/f1786451948072x642876819836404700/1.jpg',
  })), MSEARCH_URL);

  const listingCard = card({
    title: '2020 Honda Civic Sport',
    price: '$20,000',
    location: 'Staten Island, NY',
    image: 'https://02934c1813fc15e1a3529137486e7568.cdn.bubble.io/cdn-cgi/image/w=1024,h=683,f=auto,dpr=1,fit=contain/f1786451948072x642876819836404700/1.jpg',
  });

  assert.equal(registry.lookupMiles(
    listingCard,
    parsed({ title: '2020 Honda Civic Sport', price: 20000, year: 2020 }),
  ), 12345);
});

test('a unique normalized title, price, and location fingerprint is a safe fallback', () => {
  const registry = createMileageRegistry({ storage: createMemoryStorage(), logger: () => {} });
  registry.ingestText(msearch(hit({
    id: 'car-camry',
    slug: '2021-toyota-camry-le',
    title: '  2021 Toyota   Camry LE ',
    price: '$24,750',
    mileage: '31,200',
    location: 'Brooklyn, NY',
    image: null,
  })), MSEARCH_URL);

  const listingCard = card({
    title: '2021 TOYOTA CAMRY LE',
    price: '$24,750',
    location: 'Brooklyn, NY',
  });

  assert.equal(registry.lookupMiles(
    listingCard,
    parsed({ title: '2021 Toyota Camry LE', price: 24750, year: 2021 }),
  ), 31200);
});

test('ambiguous fingerprints return null instead of assigning another car mileage', () => {
  const registry = createMileageRegistry({ storage: createMemoryStorage(), logger: () => {} });
  registry.ingestText(msearch(
    hit({
      id: 'duplicate-a',
      slug: '2022-tesla-model-3-a',
      title: '2022 Tesla Model 3',
      price: '$32,000',
      mileage: '10,000',
      location: 'Queens, NY',
      image: null,
    }),
    hit({
      id: 'duplicate-b',
      slug: '2022-tesla-model-3-b',
      title: '2022 Tesla Model 3',
      price: '$32,000',
      mileage: '22,000',
      location: 'Queens, NY',
      image: null,
    }),
  ), MSEARCH_URL);

  const listingCard = card({
    title: '2022 Tesla Model 3',
    price: '$32,000',
    location: 'Queens, NY',
  });

  assert.equal(registry.lookupMiles(
    listingCard,
    parsed({ title: '2022 Tesla Model 3', price: 32000, year: 2022 }),
  ), null);
});

test('unrelated cards do not inherit mileage from response position', () => {
  const registry = createMileageRegistry({ storage: createMemoryStorage(), logger: () => {} });
  registry.ingestText(msearch(
    hit({
      id: 'first',
      slug: '2020-honda-civic',
      title: '2020 Honda Civic',
      price: '$20,000',
      mileage: '10,000',
      location: 'Bronx, NY',
      image: '//assets.cdn.bubble.io/f1786411111111x111111111111111111/civic.jpg',
    }),
    hit({
      id: 'second',
      slug: '2021-toyota-camry',
      title: '2021 Toyota Camry',
      price: '$25,000',
      mileage: '20,000',
      location: 'Brooklyn, NY',
      image: '//assets.cdn.bubble.io/f1786422222222x222222222222222222/camry.jpg',
    }),
  ), MSEARCH_URL);

  const unrelatedCard = card({
    title: '2019 Subaru Outback',
    price: '$21,500',
    location: 'Manhattan, NY',
    image: 'https://assets.cdn.bubble.io/cdn-cgi/image/w=700/f1786499999999x999999999999999999/outback.jpg',
  });

  assert.equal(registry.lookupMiles(
    unrelatedCard,
    parsed({ title: '2019 Subaru Outback', price: 21500, year: 2019 }),
    0,
  ), null);
});

test('identity records survive a cache roundtrip', () => {
  const storage = createMemoryStorage();
  const first = createMileageRegistry({ storage, logger: () => {} });
  first.ingestText(msearch(hit({
    id: 'cache-car',
    slug: '2023-mazda-cx-5',
    title: '2023 Mazda CX-5',
    price: '$29,900',
    mileage: '8,750',
    location: 'Staten Island, NY',
    image: '//assets.cdn.bubble.io/f1786433333333x333333333333333333/mazda.jpg',
  })), MSEARCH_URL);

  const restored = createMileageRegistry({ storage, logger: () => {} });
  restored.loadCache();
  const listingCard = card({
    title: '2023 Mazda CX-5',
    price: '$29,900',
    location: 'Staten Island, NY',
    image: 'https://assets.cdn.bubble.io/cdn-cgi/image/w=1024/f1786433333333x333333333333333333/mazda.jpg',
  });

  assert.equal(restored.lookupMiles(
    listingCard,
    parsed({ title: '2023 Mazda CX-5', price: 29900, year: 2023 }),
  ), 8750);
  assert.match(storage.getItem('mlf_mileage_v2'), /f1786433333333x333333333333333333/);
});

test('load-more responses merge with prior records without losing either mapping', () => {
  const storage = createMemoryStorage();
  let changes = 0;
  const registry = createMileageRegistry({
    storage,
    logger: () => {},
    onRegistryChanged: () => changes++,
  });
  registry.ingestText(msearch(hit({
    id: 'page-one',
    slug: '2020-volvo-xc60',
    title: '2020 Volvo XC60',
    price: '$28,000',
    mileage: '40,100',
    location: 'New York, NY',
    image: '//assets.cdn.bubble.io/f1786444444444x444444444444444444/volvo.jpg',
  })), `${MSEARCH_URL}?page=1`);
  registry.ingestText(msearch(hit({
    id: 'page-two',
    slug: '2021-audi-q5',
    title: '2021 Audi Q5',
    price: '$31,500',
    mileage: '26,800',
    location: 'New York, NY',
    image: '//assets.cdn.bubble.io/f1786455555555x555555555555555555/audi.jpg',
  })), `${MSEARCH_URL}?page=2`);

  const volvo = card({
    title: '2020 Volvo XC60',
    price: '$28,000',
    location: 'New York, NY',
    image: 'https://assets.cdn.bubble.io/cdn-cgi/image/w=1024/f1786444444444x444444444444444444/volvo.jpg',
  });
  const audi = card({
    title: '2021 Audi Q5',
    price: '$31,500',
    location: 'New York, NY',
    image: 'https://assets.cdn.bubble.io/cdn-cgi/image/w=1024/f1786455555555x555555555555555555/audi.jpg',
  });

  assert.equal(registry.lookupMiles(volvo, parsed({ title: '2020 Volvo XC60', price: 28000, year: 2020 })), 40100);
  assert.equal(registry.lookupMiles(audi, parsed({ title: '2021 Audi Q5', price: 31500, year: 2021 })), 26800);
  assert.equal(registry.getStats().records, 2);
  assert.equal(changes, 2);
});
