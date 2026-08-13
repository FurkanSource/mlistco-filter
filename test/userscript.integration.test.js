import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { JSDOM, VirtualConsole } from 'jsdom';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('generated userscript mounts and operates the complete filter panel', async (context) => {
  const cards = Array.from({ length: 12 }, (_, index) => {
    const make = index % 2 === 0 ? 'Honda Civic' : 'Toyota Camry';
    return `<article class="bubble-element group-item">2021 ${make} $20,000 10k miles</article>`;
  }).join('');
  const virtualConsole = new VirtualConsole();
  const dom = new JSDOM(`<!doctype html><html><head></head><body>${cards}</body></html>`, {
    url: 'https://mlistco.com/listings',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole,
  });
  context.after(() => dom.window.close());

  dom.window.scrollTo = () => {};
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  for (const card of dom.window.document.querySelectorAll('.group-item')) {
    Object.defineProperty(card, 'innerText', { configurable: true, get: () => card.textContent });
  }

  const userscript = await readFile(new URL('../mlistco-filter.user.js', import.meta.url), 'utf8');
  dom.window.eval(userscript);
  dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  await delay(650);

  const { document } = dom.window;
  const panel = document.getElementById('mlf-panel');
  assert.ok(panel, 'panel should mount');
  assert.equal(document.querySelectorAll('#mlf-panel').length, 1);
  assert.match(document.querySelector('style').textContent, /--mlf-amber/);
  assert.equal(document.getElementById('mlf-odo').textContent, '0012');
  assert.equal(document.getElementById('mlf-status').textContent, 'Ready to filter');
  assert.equal(document.getElementById('mlf-load-count').placeholder, '200');

  document.getElementById('mlf-q').value = 'honda civic';
  document.getElementById('mlf-apply').click();
  const visibleCards = Array.from(document.querySelectorAll('.group-item'))
    .filter((card) => card.style.display !== 'none');
  assert.equal(visibleCards.length, 6);
  assert.equal(document.getElementById('mlf-status').textContent, '6 of 12 shown');
  assert.equal(document.getElementById('mlf-status').dataset.tone, 'success');

  document.getElementById('mlf-title').click();
  assert.equal(panel.classList.contains('collapsed'), true);
  assert.equal(document.getElementById('mlf-title').getAttribute('aria-expanded'), 'false');
  assert.equal(document.getElementById('mlf-title').getAttribute('aria-label'), 'Expand filter panel');

  document.getElementById('mlf-reset').click();
  assert.equal(Array.from(document.querySelectorAll('.group-item')).every((card) => card.style.display === ''), true);
  assert.equal(document.getElementById('mlf-status').textContent, 'Filters cleared');

  document.getElementById('mlf-load-count').value = '10';
  document.getElementById('mlf-load').click();
  await delay(20);
  assert.equal(document.getElementById('mlf-status').textContent, '12 listings loaded');

  document.getElementById('mlf-q').value = 'honda civic';
  document.getElementById('mlf-status').textContent = 'Waiting';
  document.getElementById('mlf-load-count').dispatchEvent(new dom.window.KeyboardEvent('keydown', {
    bubbles: true,
    key: 'Enter',
  }));
  await delay(20);
  assert.equal(document.getElementById('mlf-status').textContent, '12 listings loaded');
  assert.equal(Array.from(document.querySelectorAll('.group-item')).every((card) => card.style.display === ''), true);
});
