import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { createFilterController } from '../src/listings/filter-controller.js';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('active filters are reapplied when Bubble appends a listing card', async () => {
  const dom = new JSDOM(`
    <!doctype html><html><body>
      <div id="mlf-panel"><span id="mlf-status"></span><span id="mlf-odo"></span><span id="mlf-active-count"></span></div>
      <main><article class="bubble-element group-item">2021 Honda Civic $20,000</article></main>
    </body></html>
  `, { url: 'https://mlistco.com/listings' });
  const state = {
    query: 'honda',
    yearMin: null,
    yearMax: null,
    priceMin: null,
    priceMax: null,
    milesMin: null,
    milesMax: null,
    hideSold: false,
  };
  const previousDocument = globalThis.document;
  globalThis.document = dom.window.document;
  const controller = createFilterController({
    filterStore: { state, hasAnyFilter: () => true, getActiveFilterCount: () => 1 },
    cardParser: {
      parseCardCached: (card) => ({
        text: card.textContent.toLowerCase(),
        year: null,
        price: null,
        miles: null,
        sold: false,
      }),
    },
    documentObject: dom.window.document,
    locationObject: dom.window.location,
    MutationObserverClass: dom.window.MutationObserver,
  });

  try {
    controller.installDomWatcher();
    controller.applyFilter();
    const appended = dom.window.document.createElement('article');
    appended.className = 'bubble-element group-item';
    appended.textContent = '2021 Toyota Camry $20,000';
    dom.window.document.querySelector('main').appendChild(appended);
    await delay(150);

    assert.equal(appended.style.display, 'none');
    assert.equal(dom.window.document.getElementById('mlf-status').textContent, '1 of 2 shown');
  } finally {
    controller.disconnectDomWatcher();
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    dom.window.close();
  }
});
