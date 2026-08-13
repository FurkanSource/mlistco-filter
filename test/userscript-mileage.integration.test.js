import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { JSDOM, VirtualConsole } from 'jsdom';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('generated userscript maps reversed Bubble mileage records to the correct cards', async () => {
  const firstAsset = 'f1786411111111x111111111111111111';
  const secondAsset = 'f1786422222222x222222222222222222';
  const cards = `
    <article class="bubble-element group-item">
      <img src="https://assets.cdn.bubble.io/cdn-cgi/image/w=700/${firstAsset}/one.jpg">
      2022 BMW M3 $65,000 New York, NY
    </article>
    <article class="bubble-element group-item">
      <img src="https://assets.cdn.bubble.io/cdn-cgi/image/w=700/${secondAsset}/two.jpg">
      2022 BMW M4 $65,000 New York, NY
    </article>`;
  const dom = new JSDOM(`<!doctype html><html><head></head><body>${cards}</body></html>`, {
    url: 'https://mlistco.com/listings',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole: new VirtualConsole(),
  });

  class FakeXhr extends dom.window.EventTarget {
    open(method, url) {
      this.method = method;
      this.url = url;
    }

    send() {}

    getResponseHeader(name) {
      return name.toLowerCase() === 'content-type' ? 'application/json' : null;
    }
  }

  try {
    dom.window.XMLHttpRequest = FakeXhr;
    dom.window.scrollTo = () => {};
    dom.window.HTMLElement.prototype.scrollIntoView = () => {};
    for (const card of dom.window.document.querySelectorAll('.group-item')) {
      Object.defineProperty(card, 'innerText', {
        configurable: true,
        get: () => card.textContent.replace(/\s+/g, ' ').trim(),
      });
    }

    const userscript = await readFile(new URL('../mlistco-filter.user.js', import.meta.url), 'utf8');
    dom.window.eval(userscript);

    const response = {
      responses: [{
        hits: {
          hits: [
            {
              _id: 'second',
              _source: {
                Slug: '2022-bmw-m4',
                title_text: '2022 BMW M4',
                price_text: '65000',
                mileage_text: '50000',
                seller_location_text: 'New York, NY',
                all_images_list_image: [`//assets.cdn.bubble.io/${secondAsset}/two.jpg`],
              },
            },
            {
              _id: 'first',
              _source: {
                Slug: '2022-bmw-m3',
                title_text: '2022 BMW M3',
                price_text: '65000',
                mileage_text: '10000',
                seller_location_text: 'New York, NY',
                all_images_list_image: [`//assets.cdn.bubble.io/${firstAsset}/one.jpg`],
              },
            },
          ],
        },
      }],
    };
    const xhr = new dom.window.XMLHttpRequest();
    xhr.open('POST', '/elasticsearch/msearch');
    xhr.responseType = '';
    xhr.responseText = JSON.stringify(response);
    xhr.send();
    xhr.dispatchEvent(new dom.window.Event('load'));

    dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
    await delay(650);
    const { document } = dom.window;
    document.getElementById('mlf-mmax').value = '20000';
    document.getElementById('mlf-apply').click();

    const listingCards = Array.from(document.querySelectorAll('.group-item'));
    assert.equal(listingCards[0].style.display, '');
    assert.equal(listingCards[1].style.display, 'none');
    assert.equal(document.getElementById('mlf-status').textContent, '1 of 2 shown');
    assert.equal(document.getElementById('mlf-status').dataset.tone, 'success');
  } finally {
    dom.window.close();
  }
});
