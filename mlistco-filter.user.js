// ==UserScript==
// @name         MListCo Vehicle Filter
// @namespace    https://mlistco.com/
// @version      1.5.0
// @description  Filter vehicle listings on mlistco.com by make/model, year, price, and mileage
// @match        *://mlistco.com/*
// @match        *://*.mlistco.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==
(function () {
  'use strict';

  const STORAGE_KEY = 'mlf_state_v2';
  const NEW_TAB_KEY = 'mlf_new_tab_pending_v1';
  const RETURN_KEY = 'mlf_return_state_v1';
  const DEFAULT_STATE = {
    query: '',
    yearMin: null,
    yearMax: null,
    priceMin: null,
    priceMax: null,
    milesMin: null,
    milesMax: null,
    hideSold: false,
  };
  const STATE = Object.assign({}, DEFAULT_STATE, loadState());

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? sanitizeState(JSON.parse(raw)) : {};
    } catch (_) { return {}; }
  }
  function sanitizeState(raw) {
    if (!raw || typeof raw !== 'object') return {};
    const clean = {};
    if (typeof raw.query === 'string') clean.query = raw.query;
    for (const key of ['yearMin', 'yearMax', 'priceMin', 'priceMax', 'milesMin', 'milesMax']) {
      const n = Number(raw[key]);
      if (Number.isFinite(n)) clean[key] = Math.round(n);
    }
    clean.hideSold = !!raw.hideSold;
    return clean;
  }
  function saveState() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(STATE)); } catch (_) {}
  }
  function hasAnyFilter() {
    return !!(STATE.query || STATE.yearMin || STATE.yearMax || STATE.priceMin ||
              STATE.priceMax || STATE.milesMin || STATE.milesMax || STATE.hideSold);
  }

  function loadPendingNewTab() {
    try {
      const raw = sessionStorage.getItem(NEW_TAB_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
  }

  function savePendingNewTab(value) {
    try {
      sessionStorage.setItem(NEW_TAB_KEY, JSON.stringify(value));
    } catch (_) {}
  }

  function clearPendingNewTab() {
    try {
      sessionStorage.removeItem(NEW_TAB_KEY);
    } catch (_) {}
  }

  function loadReturnState() {
    try {
      const raw = sessionStorage.getItem(RETURN_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
  }

  function saveReturnState(value) {
    try {
      sessionStorage.setItem(RETURN_KEY, JSON.stringify(value));
    } catch (_) {}
  }

  function clearReturnState() {
    try {
      sessionStorage.removeItem(RETURN_KEY);
    } catch (_) {}
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function normalizeText(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
  }

  function log(...args) {
    console.log('[MListFilter]', ...args);
  }

  function isVisibleElement(node) {
    if (!node || !node.isConnected) return false;
    const style = window.getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function isListingsPath(pathname) {
    return /\/listings?\/?$/.test(pathname || '');
  }

  function isClassifiedPath(pathname) {
    return /\/classified\//.test(pathname || '');
  }

  function resolveUrl(rawUrl) {
    try {
      return new URL(String(rawUrl), location.href);
    } catch (_) {
      return null;
    }
  }

  function consumePendingNewTabForUrl(rawUrl) {
    const pending = loadPendingNewTab();
    if (!pending) return false;
    if (!pending.createdAt || Date.now() - pending.createdAt > 10000) {
      clearPendingNewTab();
      return false;
    }

    const target = resolveUrl(rawUrl);
    if (!target || !isClassifiedPath(target.pathname)) return false;

    clearPendingNewTab();
    try {
      window.open(target.href, pending.token);
      return true;
    } catch (_) {
      return false;
    }
  }

  function installNavigationInterceptor() {
    if (window.__mlfNavPatched) return;
    window.__mlfNavPatched = true;

    const locationProto = Object.getPrototypeOf(window.location);

    try {
      const assign = locationProto.assign;
      if (typeof assign === 'function') {
        locationProto.assign = function patchedAssign(url) {
          if (this === window.location && consumePendingNewTabForUrl(url)) return;
          return assign.call(this, url);
        };
      }
    } catch (_) {}

    try {
      const replace = locationProto.replace;
      if (typeof replace === 'function') {
        locationProto.replace = function patchedReplace(url) {
          if (this === window.location && consumePendingNewTabForUrl(url)) return;
          return replace.call(this, url);
        };
      }
    } catch (_) {}

    try {
      const hrefDesc = Object.getOwnPropertyDescriptor(locationProto, 'href');
      if (hrefDesc && typeof hrefDesc.get === 'function' && typeof hrefDesc.set === 'function' && hrefDesc.configurable) {
        Object.defineProperty(locationProto, 'href', {
          configurable: true,
          enumerable: hrefDesc.enumerable,
          get() {
            return hrefDesc.get.call(this);
          },
          set(url) {
            if (this === window.location && consumePendingNewTabForUrl(url)) return;
            return hrefDesc.set.call(this, url);
          },
        });
      }
    } catch (_) {}
  }

  function getElementPath(el) {
    if (!el || !el.tagName) return null;
    if (el.id) return `#${el.id}`;
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.body && parts.length < 5) {
      let part = node.tagName.toLowerCase();
      if (node.name) {
        part += `[name="${CSS.escape(node.name)}"]`;
      } else if (node.classList && node.classList.length) {
        const cls = Array.from(node.classList).slice(0, 2).map((c) => `.${CSS.escape(c)}`).join('');
        part += cls;
      }
      const parent = node.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter((child) => child.tagName === node.tagName);
        if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(node) + 1})`;
      }
      parts.unshift(part);
      node = parent;
    }
    return parts.join(' > ');
  }

  function getNativeFilterState() {
    const activeSelects = Array.from(document.querySelectorAll('select.bubble-element.Dropdown'))
      .filter((node) => !node.closest('#mlf-panel'))
      .filter((node) => isVisibleElement(node))
      .filter((node) => node.options && node.options.length > 1)
      .map((node, index) => ({
        kind: 'native-select',
        index,
        value: node.value,
        selectedText: node.options[node.selectedIndex]?.text || '',
        disabled: !!node.disabled,
      }))
      .filter((item) => isMeaningfulNativeValue(item.value) || isMeaningfulNativeValue(item.selectedText));

    if (activeSelects.length) {
      log('captured native selects', activeSelects);
      return activeSelects;
    }

    const nodes = Array.from(document.querySelectorAll('select, input:not([type="hidden"]), textarea, .bubble-element.Dropdown'));
    return nodes.map((node) => {
      const path = getElementPath(node);
      if (!path) return null;
      const text = normalizeText(node.innerText || node.textContent || '');
      const value = isBubbleDropdown(node) ? text : ('value' in node ? node.value : '');
      return {
        path,
        tag: node.tagName.toLowerCase(),
        type: node.type || '',
        value,
        checked: !!node.checked,
        text,
      };
    }).filter(Boolean);
  }

  function isMeaningfulNativeValue(value) {
    const text = normalizeText(value).toLowerCase();
    if (!text) return false;
    const blocked = [
      'all',
      'all models',
      'all generations',
      'any',
      'make',
      'model',
      'generation',
      'select',
      'select make',
      'select model',
      'select generation',
      'choose',
      'choose make',
      'choose model',
      'choose generation',
      'filter',
      'filters',
    ];
    return !blocked.includes(text);
  }

  function hasSpecificNativeFiltersSelected() {
    const nativeStates = getNativeFilterState();
    const meaningful = nativeStates.filter((item) => {
      if (!item) return false;
      if (item.kind === 'native-select') {
        return isMeaningfulNativeValue(item.value || item.selectedText);
      }
      if (!item.path || item.path.includes('#mlf-panel')) return false;
      if (!(item.tag === 'select' || isBubbleDropdown(document.querySelector(item.path)))) return false;
      return isMeaningfulNativeValue(item.value || item.text);
    });
    return meaningful.length >= 2;
  }

  function dispatchNativeEvents(node) {
    node.dispatchEvent(new Event('input', { bubbles: true }));
    node.dispatchEvent(new Event('change', { bubbles: true }));
  }

  async function waitFor(condition, timeoutMs = 6000, intervalMs = 100) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (condition()) return true;
      await wait(intervalMs);
    }
    return false;
  }

  function waitForQuietDom(quietMs = 400, timeoutMs = 6000) {
    return new Promise((resolve) => {
      let quietTimer = null;
      let settled = false;

      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(quietTimer);
        clearTimeout(deadline);
        observer.disconnect();
        resolve();
      };

      const observer = new MutationObserver((records) => {
        const outsidePanel = records.some((record) => {
          const target = record.target;
          const el = target && target.nodeType === 1 ? target : target && target.parentElement;
          return !el || !el.closest('#mlf-panel');
        });
        if (!outsidePanel) return;
        clearTimeout(quietTimer);
        quietTimer = setTimeout(finish, quietMs);
      });

      const deadline = setTimeout(finish, timeoutMs);
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true,
      });
      quietTimer = setTimeout(finish, quietMs);
    });
  }

  async function settleScroll(targetY, attempts = 12, intervalMs = 120) {
    for (let i = 0; i < attempts; i++) {
      const maxY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      const y = Math.min(Math.max(targetY, 0), maxY);
      window.scrollTo(0, y);
      await wait(intervalMs);
      if (Math.abs(window.scrollY - y) < 4) {
        await wait(intervalMs);
        if (Math.abs(window.scrollY - y) < 4) {
          log('scroll settled', { target: targetY, landed: window.scrollY, attempts: i + 1 });
          return true;
        }
      }
    }
    log('scroll failed to settle', { target: targetY, landed: window.scrollY });
    return false;
  }

  function isBubbleDropdown(node) {
    return !!(node && node.classList && node.classList.contains('Dropdown'));
  }

  function collectClickableTextNodes() {
    const selector = 'div, span, li, button, a';
    const candidates = [];
    for (const node of document.querySelectorAll(selector)) {
      if (!node || !node.isConnected) continue;
      if (node.closest('#mlf-panel')) continue;
      const text = normalizeText(node.textContent || '');
      if (!text || text.length > 120) continue;
      candidates.push(node);
    }
    return candidates.filter((node) => isVisibleElement(node));
  }

  async function restoreBubbleDropdown(node, item) {
    const targetText = normalizeText(item.value || item.text);
    if (!targetText) return;
    const currentText = normalizeText(node.innerText || node.textContent || '');
    if (currentText === targetText) return;

    node.click();
    await waitForQuietDom(150, 1500);

    const candidates = collectClickableTextNodes();
    const exactMatch = candidates.find((candidate) => normalizeText(candidate.innerText || candidate.textContent || '') === targetText);
    const partialMatch = candidates.find((candidate) => normalizeText(candidate.innerText || candidate.textContent || '').includes(targetText));
    const option = exactMatch || partialMatch;
    if (!option) return;

    option.click();
    await waitForQuietDom();
  }

  async function restoreNativeFilterState(saved) {
    if (!Array.isArray(saved) || !saved.length) {
      log('no native filter state to restore');
      return;
    }
    log('restoring native filters', saved);

    if (saved.every((item) => item && item.kind === 'native-select')) {
      for (const item of saved) {
        const ready = await waitFor(() => {
          const current = Array.from(document.querySelectorAll('select.bubble-element.Dropdown'))
            .filter((node) => !node.closest('#mlf-panel'))
            .filter((node) => isVisibleElement(node));
          const node = current[item.index];
          if (!node) return false;
          if (node.disabled) return false;
          return Array.from(node.options || []).some((option) =>
            option.value === item.value || normalizeText(option.text) === normalizeText(item.selectedText)
          );
        }, 8000, 150);
        log('restore wait result', {
          index: item.index,
          targetValue: item.value,
          targetText: item.selectedText,
          ready,
        });

        const selects = Array.from(document.querySelectorAll('select.bubble-element.Dropdown'))
          .filter((node) => !node.closest('#mlf-panel'))
          .filter((node) => isVisibleElement(node));
        log('visible selects on restore', selects.map((node, index) => ({
          index,
          disabled: !!node.disabled,
          value: node.value,
          selectedText: node.options[node.selectedIndex]?.text || '',
          optionCount: node.options?.length || 0,
        })));
        const node = selects[item.index];
        if (!node) {
          log('restore failed: select missing', item.index);
          continue;
        }
        if (node.disabled) {
          log('restore skipped: select disabled', item.index);
          continue;
        }
        const option = Array.from(node.options || []).find((entry) =>
          entry.value === item.value || normalizeText(entry.text) === normalizeText(item.selectedText)
        );
        if (!option) {
          log('restore failed: option not found', {
            index: item.index,
            targetValue: item.value,
            targetText: item.selectedText,
            options: Array.from(node.options || []).map((entry) => ({
              value: entry.value,
              text: entry.text,
            })),
          });
          continue;
        }
        if (node.value === option.value) {
          log('restore re-trigger: already selected', { index: item.index, value: option.value, text: option.text });
          dispatchNativeEvents(node);
          await waitForQuietDom();
          continue;
        }

        log('restoring select', { index: item.index, from: node.value, to: option.value, text: option.text });
        node.value = option.value;
        dispatchNativeEvents(node);
        await waitForQuietDom();
        log('restore post-dispatch state', {
          index: item.index,
          value: node.value,
          selectedText: node.options[node.selectedIndex]?.text || '',
        });
      }
      return;
    }

    for (const item of saved) {
      const node = document.querySelector(item.path);
      if (!node || node.closest('#mlf-panel')) continue;

      if (isBubbleDropdown(node)) {
        await restoreBubbleDropdown(node, item);
        continue;
      }

      if (item.tag === 'select' || item.tag === 'textarea' || (item.tag === 'input' && item.type !== 'checkbox' && item.type !== 'radio')) {
        if (node.value !== item.value) {
          node.value = item.value;
          dispatchNativeEvents(node);
        }
        continue;
      }

      if (item.tag === 'input' && (item.type === 'checkbox' || item.type === 'radio')) {
        if (!!node.checked !== !!item.checked) {
          node.checked = !!item.checked;
          dispatchNativeEvents(node);
        }
        continue;
      }
    }

    await waitForQuietDom();
  }

  async function waitForRestoredNativeFilters(saved) {
    if (!Array.isArray(saved) || !saved.length) return true;
    if (!saved.every((item) => item && item.kind === 'native-select')) return true;

    const ready = await waitFor(() => {
      const selects = Array.from(document.querySelectorAll('select.bubble-element.Dropdown'))
        .filter((node) => !node.closest('#mlf-panel'))
        .filter((node) => isVisibleElement(node));
      return saved.every((item) => {
        const node = selects[item.index];
        if (!node || node.disabled) return false;
        const selectedText = node.options[node.selectedIndex]?.text || '';
        return node.value === item.value || normalizeText(selectedText) === normalizeText(item.selectedText);
      });
    }, 12000, 200);

    log('native filters stabilized', { ready });
    if (ready) await waitForQuietDom();
    return ready;
  }

  const CARD_SELECTOR = '.bubble-element.group-item';
  const PRICE_RE = /\$\s*([\d,]+(?:\.\d+)?)(k|m)?(?![a-z])/i;
  const YEAR_RE = /(?<!\$)\b(19\d{2}|20[0-4]\d)\b/;
  const MILES_RE = /([\d,]+(?:\.\d+)?)\s*(k)?\s*(mi\b|miles\b|km\b|kilometers\b)/gi;
  const MILES_LABEL_RE = /(?:miles|mileage|odometer)\s*:?\s*([\d,]+(?:\.\d+)?)[ \t]*(k)?\b/i;
  const KM_TO_MILES = 0.621371;

  function getCards() {
    return Array.from(document.querySelectorAll(CARD_SELECTOR));
  }

  function parsePrice(text) {
    const m = text.match(PRICE_RE);
    if (!m) return null;
    const n = parseFloat(m[1].replace(/,/g, ''));
    if (!Number.isFinite(n)) return null;
    const suffix = (m[2] || '').toLowerCase();
    if (suffix === 'k') return Math.round(n * 1000);
    if (suffix === 'm') return Math.round(n * 1000000);
    return Math.round(n);
  }

  function precededByDollar(text, index) {
    let i = index - 1;
    while (i >= 0 && /\s/.test(text[i])) i--;
    return i >= 0 && text[i] === '$';
  }

  function parseMiles(text) {
    let num = null;
    let thousands = null;
    let unit = 'mi';

    let adjacent = null;
    MILES_RE.lastIndex = 0;
    let m;
    while ((m = MILES_RE.exec(text)) !== null) {
      if (precededByDollar(text, m.index)) continue;
      adjacent = m;
      break;
    }

    if (adjacent) {
      num = adjacent[1];
      thousands = adjacent[2];
      unit = adjacent[3];
    } else {
      const labelled = text.match(MILES_LABEL_RE);
      if (!labelled) return null;
      num = labelled[1];
      thousands = labelled[2];
    }

    const n = parseFloat(String(num).replace(/,/g, ''));
    if (!Number.isFinite(n)) return null;
    const scaled = thousands ? n * 1000 : n;
    const isKm = /^k(m|ilometers)/i.test(unit);
    return Math.round(isKm ? scaled * KM_TO_MILES : scaled);
  }

  const MILEAGE_CACHE_KEY = 'mlf_mileage_v1';
  const MILEAGE_HINT_RE = /mile|milage|odom|kilomet/i;
  const MILEAGE_KEY_RE = /(mile|milage|odom|kilomet|^kms?$)/i;
  const KM_KEY_RE = /(kilomet|^kms?$)/i;
  const PRICE_KEY_RE = /(price|asking|cost)/i;
  const YEAR_KEY_RE = /(^year$|model.?year|^yr$)/i;
  const ID_KEY_RE = /^(_id|id|unique ?id)$/i;
  const AMBIGUOUS = Symbol('ambiguous');

  const mileageById = new Map();
  const mileageBySignature = new Map();
  const mileageByOrder = [];
  const seenRecordIds = new Set();
  const seenMileageFields = new Set();
  let registryVersion = 0;

  function signatureOf(price, year) {
    if (price === null || price === undefined || year === null || year === undefined) return null;
    return price + '|' + year;
  }

  function numericValue(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'string') {
      const n = parseFloat(value.replace(/[^\d.]/g, ''));
      return Number.isFinite(n) ? n : null;
    }
    return null;
  }

  function extractRecord(obj) {
    let miles = null;
    let milesKey = null;
    let id = null;
    let price = null;
    let year = null;

    for (const key of Object.keys(obj)) {
      const value = obj[key];
      if (value && typeof value === 'object') continue;
      if (miles === null && MILEAGE_KEY_RE.test(key)) {
        const n = numericValue(value);
        if (n !== null && n >= 0 && n < 2000000) {
          miles = KM_KEY_RE.test(key) ? Math.round(n * KM_TO_MILES) : Math.round(n);
          milesKey = key;
        }
      }
      if (id === null && ID_KEY_RE.test(key) && typeof value === 'string') id = value;
      if (price === null && PRICE_KEY_RE.test(key)) {
        const n = numericValue(value);
        if (n !== null && n > 0) price = Math.round(n);
      }
      if (year === null && YEAR_KEY_RE.test(key)) {
        const n = numericValue(value);
        if (n !== null && n > 1900 && n < 2050) year = Math.round(n);
      }
    }

    if (miles === null) return null;
    if (milesKey && !seenMileageFields.has(milesKey)) {
      seenMileageFields.add(milesKey);
      log('mileage field discovered in network data:', milesKey, '=', miles);
    }
    return { id, miles, price, year };
  }

  function addRecord(record) {
    if (record.id) {
      if (seenRecordIds.has(record.id)) return false;
      seenRecordIds.add(record.id);
      mileageById.set(record.id, record.miles);
    }
    mileageByOrder.push(record.miles);
    const sig = signatureOf(record.price, record.year);
    if (sig) {
      const existing = mileageBySignature.get(sig);
      if (existing !== undefined && existing !== record.miles) {
        mileageBySignature.set(sig, AMBIGUOUS);
      } else if (existing === undefined) {
        mileageBySignature.set(sig, record.miles);
      }
    }
    return true;
  }

  function harvestJson(root) {
    let added = 0;
    let nodes = 0;
    const stack = [[root, 0]];
    while (stack.length && nodes < 40000) {
      const entry = stack.pop();
      const node = entry[0];
      const depth = entry[1];
      nodes++;
      if (!node || typeof node !== 'object' || depth > 14) continue;
      if (Array.isArray(node)) {
        for (const item of node) stack.push([item, depth + 1]);
        continue;
      }
      const record = extractRecord(node);
      if (record && addRecord(record)) added++;
      for (const key of Object.keys(node)) {
        const value = node[key];
        if (value && typeof value === 'object') {
          stack.push([value, depth + 1]);
        } else if (typeof value === 'string' && value.length > 20 && MILEAGE_HINT_RE.test(value)) {
          const head = value.slice(0, 40).trim();
          if (head.startsWith('{') || head.startsWith('[')) {
            try {
              stack.push([JSON.parse(value), depth + 1]);
            } catch (_) {}
          }
        }
      }
    }
    return added;
  }

  function ingestValue(value) {
    if (!value || typeof value !== 'object') return;
    const added = harvestJson(value);
    if (!added) return;
    registryVersion++;
    saveMileageCache();
    log('mileage records captured:', added, 'total:', mileageByOrder.length);
    if (document.getElementById('mlf-panel')) applyFilterIfActive();
  }

  function ingestText(text) {
    if (typeof text !== 'string' || !text || text.length > 5000000) return;
    const head = text.slice(0, 200).trim();
    if (!head.startsWith('{') && !head.startsWith('[')) return;
    if (!MILEAGE_HINT_RE.test(text)) return;
    let value;
    try {
      value = JSON.parse(text);
    } catch (_) {
      return;
    }
    ingestValue(value);
  }

  function applyFilterIfActive() {
    if (hasAnyFilter()) applyFilter();
    else updatePanelMeta();
  }

  function loadMileageCache() {
    try {
      const raw = localStorage.getItem(MILEAGE_CACHE_KEY);
      if (!raw) return;
      const list = JSON.parse(raw);
      if (!Array.isArray(list)) return;
      for (const item of list) {
        if (!item || typeof item !== 'object') continue;
        const miles = Number(item.m);
        if (!Number.isFinite(miles)) continue;
        if (item.i) mileageById.set(String(item.i), miles);
        const sig = signatureOf(item.p ?? null, item.y ?? null);
        if (sig && !mileageBySignature.has(sig)) mileageBySignature.set(sig, miles);
      }
      registryVersion++;
      log('mileage cache loaded:', mileageById.size, 'by id,', mileageBySignature.size, 'by signature');
    } catch (_) {}
  }

  function saveMileageCache() {
    try {
      const list = [];
      for (const [sig, miles] of mileageBySignature) {
        if (miles === AMBIGUOUS || list.length >= 3000) continue;
        const parts = sig.split('|');
        list.push({ p: Number(parts[0]), y: Number(parts[1]), m: miles });
      }
      localStorage.setItem(MILEAGE_CACHE_KEY, JSON.stringify(list));
    } catch (_) {}
  }

  const MAX_BODY_BYTES = 5000000;
  const MAX_INFLIGHT_READS = 4;
  let inflightReads = 0;

  function isJsonContentType(value) {
    return typeof value === 'string' && /\bjson\b/i.test(value);
  }

  function maybeIngestResponse(response) {
    if (!response || !response.headers || typeof response.clone !== 'function') return;
    if (!isJsonContentType(response.headers.get('content-type'))) return;
    const length = Number(response.headers.get('content-length'));
    if (Number.isFinite(length) && length > MAX_BODY_BYTES) return;
    if (inflightReads >= MAX_INFLIGHT_READS) return;
    inflightReads++;
    response.clone().text()
      .then((text) => {
        inflightReads--;
        ingestText(text);
      })
      .catch(() => {
        inflightReads--;
      });
  }

  function installDataInterceptors() {
    if (window.__mlfDataPatched) return;
    window.__mlfDataPatched = true;

    const originalFetch = window.fetch;
    if (typeof originalFetch === 'function') {
      window.fetch = function patchedFetch() {
        const result = originalFetch.apply(this, arguments);
        if (!result || typeof result.then !== 'function') return result;
        return result.then((response) => {
          try {
            maybeIngestResponse(response);
          } catch (_) {}
          return response;
        });
      };
    }

    const open = XMLHttpRequest.prototype.open;
    const send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function patchedOpen(method, url) {
      this.__mlfUrl = String(url || '');
      return open.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function patchedSend() {
      try {
        this.addEventListener('load', () => {
          try {
            const type = this.getResponseHeader && this.getResponseHeader('content-type');
            if (!isJsonContentType(type)) return;
            const responseType = this.responseType;
            if (responseType === '' || responseType === 'text') ingestText(this.responseText);
            else if (responseType === 'json') ingestValue(this.response);
          } catch (_) {}
        });
      } catch (_) {}
      return send.apply(this, arguments);
    };

    log('data interceptors installed');
  }

  function lookupMiles(parsed, index) {
    const sig = signatureOf(parsed.price, parsed.year);
    if (sig) {
      const hit = mileageBySignature.get(sig);
      if (hit !== undefined && hit !== AMBIGUOUS) return hit;
    }
    if (typeof index === 'number' && index >= 0 && index < mileageByOrder.length) {
      return mileageByOrder[index];
    }
    return null;
  }

  const parseCache = new WeakMap();

  function parseCardCached(card, index) {
    const key = (card.textContent || '') + ' ' + registryVersion;
    const cached = parseCache.get(card);
    if (cached && cached.key === key) return cached.parsed;
    const parsed = parseCard(card);
    if (parsed.miles === null) {
      const found = lookupMiles(parsed, index);
      if (found !== null && found !== undefined) parsed.miles = found;
    }
    parseCache.set(card, { key, parsed });
    return parsed;
  }

  function parseCard(card) {
    const text = card.innerText || '';
    const raw = card.textContent || '';
    const yearMatch = text.match(YEAR_RE);
    const sold = /\bsold\b/i.test(text);
    return {
      text: text.toLowerCase(),
      price: parsePrice(text),
      year: yearMatch ? parseInt(yearMatch[1], 10) : null,
      miles: parseMiles(text) ?? (raw !== text ? parseMiles(raw) : null),
      sold,
    };
  }

  function matches(parsed) {
    if (STATE.hideSold && parsed.sold) return false;
    if (STATE.query) {
      const terms = STATE.query.toLowerCase().split(/\s+/).filter(Boolean);
      if (!terms.every((t) => parsed.text.includes(t))) return false;
    }
    if (STATE.yearMin != null && parsed.year != null && parsed.year < STATE.yearMin) return false;
    if (STATE.yearMax != null && parsed.year != null && parsed.year > STATE.yearMax) return false;
    if (STATE.priceMin != null && parsed.price != null && parsed.price < STATE.priceMin) return false;
    if (STATE.priceMax != null && parsed.price != null && parsed.price > STATE.priceMax) return false;
    if (STATE.milesMin != null && parsed.miles != null && parsed.miles < STATE.milesMin) return false;
    if (STATE.milesMax != null && parsed.miles != null && parsed.miles > STATE.milesMax) return false;
    return true;
  }

  let lastCards = [];
  const MIN_FILTER_CARS = 100;

  function getFilterGateState() {
    const cards = getCards();
    return {
      cards,
      count: cards.length,
      active: hasAnyFilter(),
      ready: cards.length >= MIN_FILTER_CARS,
    };
  }

  function showAllCards(cards) {
    for (const card of cards) card.style.display = '';
  }

  function applyFilter() {
    const gate = getFilterGateState();
    lastCards = gate.cards;
    if (!gate.count && isListingsPath(location.pathname)) {
      log('card selector matched nothing', CARD_SELECTOR);
      setStatus('No listings found — the page markup may have changed', 'warning');
      updatePanelMeta();
      return;
    }
    if (gate.active && !gate.ready) {
      showAllCards(gate.cards);
      setStatus(`Load ${MIN_FILTER_CARS} listings before filtering — ${gate.count} so far`, 'loading');
      updatePanelMeta();
      return;
    }
    showAllCards(gate.cards);
    const parsedCards = gate.cards.map((card, index) => parseCardCached(card, index));
    let shown = 0;
    for (let i = 0; i < gate.cards.length; i++) {
      const ok = matches(parsedCards[i]);
      gate.cards[i].style.display = ok ? '' : 'none';
      if (ok) shown++;
    }
    setStatus(`${shown} of ${gate.cards.length} shown`, shown === gate.cards.length ? 'neutral' : 'success');
    updatePanelMeta();
  }

  function num(v) {
    if (v === '' || v == null) return null;
    const n = parseInt(String(v).replace(/[^\d]/g, ''), 10);
    return Number.isFinite(n) ? n : null;
  }

  function setStatus(message, tone = 'neutral') {
    const status = document.getElementById('mlf-status');
    if (!status) return;
    status.dataset.tone = tone;
    status.textContent = message || 'Load listings, then filter';
  }

  function getActiveFilterCount() {
    let count = 0;
    if (STATE.query) count++;
    if (STATE.yearMin != null || STATE.yearMax != null) count++;
    if (STATE.priceMin != null || STATE.priceMax != null) count++;
    if (STATE.milesMin != null || STATE.milesMax != null) count++;
    if (STATE.hideSold) count++;
    return count;
  }

  function renderOdometer(value) {
    const odo = document.getElementById('mlf-odo');
    if (!odo) return;
    const digits = String(Math.max(0, Math.min(value, 9999))).padStart(4, '0').split('');
    if (odo.childElementCount !== digits.length) {
      odo.innerHTML = digits.map(() => '<span class="mlf-digit"><i>0</i></span>').join('');
    }
    Array.from(odo.children).forEach((cell, index) => {
      const inner = cell.firstElementChild;
      if (!inner || inner.textContent === digits[index]) return;
      inner.textContent = digits[index];
      cell.classList.remove('roll');
      void cell.offsetWidth;
      cell.classList.add('roll');
    });
  }

  function updatePanelMeta() {
    renderOdometer(getCards().length);
  }

  function buildPanel() {
    if (document.getElementById('mlf-panel')) return;
    const style = document.createElement('style');
    style.textContent = `
      #mlf-panel {
        --mlf-base: #12151a;
        --mlf-raise: #1b1f26;
        --mlf-rule: #2c333d;
        --mlf-text: #e6eaf0;
        --mlf-dim: #8a94a2;
        --mlf-amber: #ffb020;
        --mlf-good: #46c79b;
        --mlf-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
        --mlf-mono: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;

        position: fixed;
        top: 16px;
        right: 16px;
        z-index: 2147483647;
        width: 268px;
        max-height: calc(100vh - 32px);
        overflow: auto;
        box-sizing: border-box;
        background: var(--mlf-base);
        color: var(--mlf-text);
        font-family: var(--mlf-sans);
        font-size: 13px;
        line-height: 1.45;
        text-align: left;
        border: 1px solid var(--mlf-rule);
        border-radius: 10px;
        box-shadow: 0 14px 34px rgba(0,0,0,.45), 0 2px 6px rgba(0,0,0,.3);
      }
      #mlf-panel * { box-sizing: border-box; }
      #mlf-panel.collapsed .mlf-body { display: none; }
      #mlf-panel.collapsed .mlf-head { border-bottom: 0; }

      #mlf-panel .mlf-head {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        padding: 12px;
        border-bottom: 1px solid var(--mlf-rule);
      }
      #mlf-panel .mlf-odo { display: flex; gap: 2px; }
      #mlf-panel .mlf-digit {
        position: relative;
        width: 15px;
        height: 22px;
        overflow: hidden;
        border: 1px solid #000;
        border-radius: 2px;
        background: linear-gradient(180deg, #05070a 0%, #1d232c 46%, #10141a 55%, #05070a 100%);
      }
      #mlf-panel .mlf-digit i {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        font: 600 13px/1 var(--mlf-mono);
        font-style: normal;
        color: var(--mlf-amber);
      }
      #mlf-panel .mlf-digit.roll i {
        animation: mlf-roll 240ms cubic-bezier(.2,.8,.25,1);
      }
      @keyframes mlf-roll {
        from { transform: translateY(-105%); opacity: .15; }
        to   { transform: translateY(0); opacity: 1; }
      }
      #mlf-panel .mlf-cap {
        margin-top: 5px;
        font: 600 9px/1 var(--mlf-sans);
        letter-spacing: .12em;
        text-transform: uppercase;
        color: var(--mlf-dim);
      }
      #mlf-panel .mlf-toggle {
        margin-left: auto;
        width: 24px;
        height: 24px;
        padding: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        background: transparent;
        color: var(--mlf-dim);
        border: 1px solid var(--mlf-rule);
        border-radius: 6px;
        cursor: pointer;
        font: 600 15px/1 var(--mlf-sans);
      }
      #mlf-panel .mlf-toggle:hover { color: var(--mlf-text); border-color: var(--mlf-dim); }

      #mlf-panel .mlf-body { padding: 12px; }
      #mlf-panel .mlf-field + .mlf-field { margin-top: 10px; }
      #mlf-panel .mlf-label {
        display: block;
        margin: 0 0 5px;
        font: 600 9.5px/1 var(--mlf-sans);
        letter-spacing: .11em;
        text-transform: uppercase;
        color: var(--mlf-dim);
      }
      #mlf-panel input[type="text"] {
        width: 100%;
        height: auto;
        margin: 0;
        padding: 7px 9px;
        background: var(--mlf-raise);
        color: var(--mlf-text);
        border: 1px solid var(--mlf-rule);
        border-radius: 6px;
        font: 400 13px/1.2 var(--mlf-sans);
        outline: none;
      }
      #mlf-panel input.mlf-num {
        font-family: var(--mlf-mono);
        font-variant-numeric: tabular-nums;
        font-size: 12px;
      }
      #mlf-panel input[type="text"]:focus {
        border-color: var(--mlf-amber);
        box-shadow: 0 0 0 3px rgba(255,176,32,.14);
      }
      #mlf-panel input::placeholder { color: #5d6672; }
      #mlf-panel .mlf-pair { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }

      #mlf-panel .mlf-check {
        display: flex;
        align-items: center;
        gap: 9px;
        margin-top: 13px;
        cursor: pointer;
        font-size: 12.5px;
        color: var(--mlf-text);
      }
      #mlf-panel .mlf-check input {
        appearance: none;
        -webkit-appearance: none;
        width: 16px;
        height: 16px;
        margin: 0;
        background: var(--mlf-raise);
        border: 1px solid var(--mlf-rule);
        border-radius: 4px;
        cursor: pointer;
        position: relative;
        flex: none;
      }
      #mlf-panel .mlf-check input:checked {
        background: var(--mlf-amber);
        border-color: var(--mlf-amber);
      }
      #mlf-panel .mlf-check input:checked::after {
        content: "";
        position: absolute;
        left: 5px;
        top: 1px;
        width: 4px;
        height: 8px;
        border: solid #12151a;
        border-width: 0 2px 2px 0;
        transform: rotate(43deg);
      }

      #mlf-panel .mlf-actions {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 6px;
        margin-top: 14px;
      }
      #mlf-panel button.mlf-btn {
        padding: 8px 13px;
        font: 600 12.5px/1 var(--mlf-sans);
        border-radius: 6px;
        border: 1px solid var(--mlf-rule);
        background: var(--mlf-raise);
        color: var(--mlf-text);
        cursor: pointer;
        text-transform: none;
        letter-spacing: 0;
      }
      #mlf-panel button.mlf-btn:hover { border-color: var(--mlf-dim); }
      #mlf-panel button.mlf-btn.primary {
        background: var(--mlf-amber);
        border-color: var(--mlf-amber);
        color: #1a1200;
      }
      #mlf-panel button.mlf-btn.primary:hover { filter: brightness(1.07); }
      #mlf-panel button.mlf-btn.ghost {
        width: 100%;
        margin-top: 6px;
        background: transparent;
        color: var(--mlf-dim);
      }
      #mlf-panel button.mlf-btn.ghost:hover { color: var(--mlf-text); border-color: var(--mlf-dim); }
      #mlf-panel button:focus-visible,
      #mlf-panel input:focus-visible {
        outline: 2px solid var(--mlf-amber);
        outline-offset: 2px;
      }

      #mlf-status {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        margin-top: 13px;
        padding-top: 12px;
        border-top: 1px solid var(--mlf-rule);
        font: 400 12px/1.4 var(--mlf-sans);
        color: var(--mlf-dim);
        min-height: 20px;
      }
      #mlf-status::before {
        content: "";
        flex: none;
        width: 6px;
        height: 6px;
        margin-top: 5px;
        border-radius: 50%;
        background: var(--mlf-dim);
      }
      #mlf-status[data-tone="success"] { color: var(--mlf-text); }
      #mlf-status[data-tone="success"]::before { background: var(--mlf-good); }
      #mlf-status[data-tone="warning"] { color: #ffc4a0; }
      #mlf-status[data-tone="warning"]::before { background: #ff7a45; }
      #mlf-status[data-tone="loading"]::before {
        background: var(--mlf-amber);
        animation: mlf-pulse 1s ease-in-out infinite;
      }
      @keyframes mlf-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .2; } }

      @media (prefers-reduced-motion: reduce) {
        #mlf-panel .mlf-digit.roll i,
        #mlf-status[data-tone="loading"]::before { animation: none; }
      }

      #mlf-panel ::selection { background: var(--mlf-amber); color: #12151a; }
    `;
    document.head.appendChild(style);

    const panel = document.createElement('div');
    panel.id = 'mlf-panel';
    panel.innerHTML = `
      <div class="mlf-head">
        <div>
          <div class="mlf-odo" id="mlf-odo"></div>
          <div class="mlf-cap">Listings loaded</div>
        </div>
        <button id="mlf-title" class="mlf-toggle" type="button" aria-expanded="true" aria-controls="mlf-body" aria-label="Collapse filters"><span id="mlf-toggle">&minus;</span></button>
      </div>
      <div class="mlf-body" id="mlf-body">
        <div class="mlf-field">
          <label class="mlf-label" for="mlf-q">Search</label>
          <input id="mlf-q" type="text" placeholder="m3 xdrive" />
        </div>
        <div class="mlf-field">
          <label class="mlf-label" for="mlf-ymin">Year</label>
          <div class="mlf-pair">
            <input id="mlf-ymin" class="mlf-num" type="text" inputmode="numeric" placeholder="min" aria-label="Minimum year" />
            <input id="mlf-ymax" class="mlf-num" type="text" inputmode="numeric" placeholder="max" aria-label="Maximum year" />
          </div>
        </div>
        <div class="mlf-field">
          <label class="mlf-label" for="mlf-pmin">Price</label>
          <div class="mlf-pair">
            <input id="mlf-pmin" class="mlf-num" type="text" inputmode="numeric" placeholder="min" aria-label="Minimum price" />
            <input id="mlf-pmax" class="mlf-num" type="text" inputmode="numeric" placeholder="max" aria-label="Maximum price" />
          </div>
        </div>
        <div class="mlf-field">
          <label class="mlf-label" for="mlf-mmin">Miles</label>
          <div class="mlf-pair">
            <input id="mlf-mmin" class="mlf-num" type="text" inputmode="numeric" placeholder="min" aria-label="Minimum miles" />
            <input id="mlf-mmax" class="mlf-num" type="text" inputmode="numeric" placeholder="max" aria-label="Maximum miles" />
          </div>
        </div>
        <label class="mlf-check" for="mlf-sold">
          <input id="mlf-sold" type="checkbox" />
          Hide sold listings
        </label>
        <div class="mlf-actions">
          <button id="mlf-apply" class="mlf-btn primary" type="button">Apply</button>
          <button id="mlf-reset" class="mlf-btn" type="button">Reset</button>
        </div>
        <button id="mlf-load" class="mlf-btn ghost" type="button">Load inventory</button>
        <div id="mlf-status" data-tone="neutral"></div>
      </div>
    `;
    document.body.appendChild(panel);

    document.getElementById('mlf-title').addEventListener('click', () => {
      panel.classList.toggle('collapsed');
      const collapsed = panel.classList.contains('collapsed');
      document.getElementById('mlf-toggle').textContent = collapsed ? '+' : '-';
      document.getElementById('mlf-title').setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      document.getElementById('mlf-title').setAttribute('aria-label', collapsed ? 'Expand filter panel' : 'Minimize filter panel');
    });

    const read = () => {
      STATE.query = document.getElementById('mlf-q').value.trim();
      STATE.yearMin = num(document.getElementById('mlf-ymin').value);
      STATE.yearMax = num(document.getElementById('mlf-ymax').value);
      STATE.priceMin = num(document.getElementById('mlf-pmin').value);
      STATE.priceMax = num(document.getElementById('mlf-pmax').value);
      STATE.milesMin = num(document.getElementById('mlf-mmin').value);
      STATE.milesMax = num(document.getElementById('mlf-mmax').value);
      STATE.hideSold = document.getElementById('mlf-sold').checked;
    };

    document.getElementById('mlf-sold').addEventListener('change', async () => {
      read();
      saveState();
      updatePanelMeta();
      if (getActiveFilterCount() && getCards().length < MIN_FILTER_CARS) {
        setStatus(`Loading ${MIN_FILTER_CARS} listings first…`, 'loading');
        await autoLoadCards(MIN_FILTER_CARS, true, true);
      }
      applyFilter();
    });

    document.getElementById('mlf-q').value = STATE.query || '';
    document.getElementById('mlf-ymin').value = STATE.yearMin ?? '';
    document.getElementById('mlf-ymax').value = STATE.yearMax ?? '';
    document.getElementById('mlf-pmin').value = STATE.priceMin ?? '';
    document.getElementById('mlf-pmax').value = STATE.priceMax ?? '';
    document.getElementById('mlf-mmin').value = STATE.milesMin ?? '';
    document.getElementById('mlf-mmax').value = STATE.milesMax ?? '';
    document.getElementById('mlf-sold').checked = !!STATE.hideSold;
    updatePanelMeta();
    setStatus('Load listings, then filter', 'neutral');

    document.getElementById('mlf-apply').addEventListener('click', async () => {
      read();
      saveState();
      updatePanelMeta();
      if (getActiveFilterCount() && getCards().length < MIN_FILTER_CARS) {
        setStatus(`Loading ${MIN_FILTER_CARS} listings first…`, 'loading');
        await autoLoadCards(MIN_FILTER_CARS, true, true);
      }
      applyFilter();
    });
    document.getElementById('mlf-reset').addEventListener('click', () => {
      for (const id of ['mlf-q','mlf-ymin','mlf-ymax','mlf-pmin','mlf-pmax','mlf-mmin','mlf-mmax']) {
        document.getElementById(id).value = '';
      }
      document.getElementById('mlf-sold').checked = false;
      Object.assign(STATE, DEFAULT_STATE);
      saveState();
      showAllCards(lastCards);
      updatePanelMeta();
      setStatus('Filters cleared', 'neutral');
    });

    document.getElementById('mlf-load').addEventListener('click', () => autoLoadCards(Math.max(AUTO_LOAD_TARGET, MIN_FILTER_CARS), true, true));

    panel.querySelectorAll('input').forEach((inp) => {
      inp.addEventListener('keydown', async (e) => {
        if (e.key === 'Enter') {
          read();
          saveState();
          updatePanelMeta();
          if (getActiveFilterCount() && getCards().length < MIN_FILTER_CARS) {
            setStatus(`Loading ${MIN_FILTER_CARS} listings first…`, 'loading');
            await autoLoadCards(MIN_FILTER_CARS, true, true);
          }
          applyFilter();
        }
      });
    });
  }

  const AUTO_LOAD_TARGET = 200;
  const MORE_RE = /^(show|load|view)\s+more\b|^more\s+(results|listings|cars)\b/i;
  let autoLoading = false;
  let autoLoadingPromise = null;

  function getCardScrollContainer() {
    const card = document.querySelector(CARD_SELECTOR);
    let node = card && card.parentElement;
    let depth = 0;
    while (node && node !== document.body && depth++ < 15) {
      const style = window.getComputedStyle(node);
      if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 4) {
        return node;
      }
      node = node.parentElement;
    }
    return null;
  }

  function scrollCardsToBottom(container) {
    const cards = getCards();
    const last = cards[cards.length - 1];
    if (last) {
      try {
        last.scrollIntoView({ block: 'end' });
      } catch (_) {}
    }
    if (container) container.scrollTop = container.scrollHeight;
    window.scrollTo(0, document.documentElement.scrollHeight);
  }

  function clickLoadMore(container) {
    const root = container || document;
    for (const node of root.querySelectorAll('button, [role="button"], div, span')) {
      if (node.closest('#mlf-panel')) continue;
      const text = normalizeText(node.textContent || '');
      if (!text || text.length > 30 || !MORE_RE.test(text)) continue;
      if (!isVisibleElement(node)) continue;
      log('clicking load-more control', text);
      node.click();
      return true;
    }
    return false;
  }
  async function autoLoadCards(targetCount = AUTO_LOAD_TARGET, preserveScroll = true, force = false) {
    if (!force && !hasSpecificNativeFiltersSelected()) {
      setStatus('Choose a model and generation first', 'warning');
      return;
    }
    if (autoLoading) return autoLoadingPromise;
    autoLoading = true;
    autoLoadingPromise = runAutoLoad(targetCount, preserveScroll);
    return autoLoadingPromise;
  }

  async function runAutoLoad(targetCount, preserveScroll) {
    const startY = window.scrollY;
    let container = getCardScrollContainer();
    let startContainerY = container ? container.scrollTop : 0;
    let maxSeen = getCards().length;
    let stagnant = 0;
    const startedAt = Date.now();
    const MAX_MS = 60000;
    log('auto-load start', { cards: maxSeen, targetCount, container: container ? (container.className || container.tagName) : 'window' });

    try {
      while (Date.now() - startedAt < MAX_MS) {
        if (getCards().length >= targetCount) break;
        if (!container) {
          container = getCardScrollContainer();
          if (container) startContainerY = container.scrollTop;
        }
        scrollCardsToBottom(container);
        await wait(700);
        const count = getCards().length;
        setStatus(`Loading… ${count} listings`, 'loading');
        if (count >= targetCount) break;
        if (count > maxSeen) {
          maxSeen = count;
          stagnant = 0;
        } else {
          stagnant++;
          if (stagnant === 2 || stagnant === 4) clickLoadMore(container);
          if (stagnant >= 6) break;
        }
      }
    } finally {
      autoLoading = false;
      autoLoadingPromise = null;
      if (preserveScroll) {
        window.scrollTo(0, startY);
        if (container) container.scrollTop = startContainerY;
      }
      const loaded = getCards().length;
      if (loaded >= targetCount) {
        setStatus(`${loaded} listings loaded`, 'success');
      } else {
        setStatus(`Stopped at ${loaded} listings — no more to load`, 'neutral');
      }
      updatePanelMeta();
    }
  }

  async function restoreListingsPosition() {
    const saved = loadReturnState();
    if (!saved) {
      log('no return state found');
      return false;
    }
    if (!saved.createdAt || Date.now() - saved.createdAt > 30000) {
      log('return state expired', saved);
      clearReturnState();
      return false;
    }

    log('restoring listings position', saved);
    clearReturnState();
    await restoreNativeFilterState(saved.nativeFilters);
    await waitForRestoredNativeFilters(saved.nativeFilters);
    await autoLoadCards(Math.max(saved.cardCount || 0, 13), false, true);
    if (hasAnyFilter()) applyFilter();
    await settleScroll(Math.max(saved.scrollY || 0, 0));
    return true;
  }

  let lastPath = location.pathname;
  function watchUrlChanges() {
    if (window.__mlfHistoryPatched) return;
    window.__mlfHistoryPatched = true;

    const onChange = () => {
      if (location.pathname === lastPath) return;
      lastPath = location.pathname;
      log('url changed →', lastPath);
      if (isListingsPath(lastPath)) {
        setTimeout(() => { autoLoadCards(); }, 800);
      }
    };

    for (const method of ['pushState', 'replaceState']) {
      const original = history[method];
      if (typeof original !== 'function') continue;
      history[method] = function patchedHistoryMethod(...args) {
        const result = original.apply(this, args);
        onChange();
        return result;
      };
    }
    window.addEventListener('popstate', onChange);
    window.addEventListener('hashchange', onChange);
  }

  function installNewTabHook() {
    if (window.__mlfClickHookInstalled) return;
    window.__mlfClickHookInstalled = true;

    document.addEventListener('click', (e) => {
      if (!isListingsPath(location.pathname)) return;
      const card = e.target.closest(CARD_SELECTOR);
      if (!card) return;
      if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
      const token = `mlf-tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const popup = window.open('about:blank', token);
      if (!popup) {
        console.warn('[MListFilter] popup blocked; cannot open listing in new tab');
        setStatus('Allow popups to keep your place', 'warning');
        return;
      }

      savePendingNewTab({
        token,
        sourceUrl: location.href,
        scrollY: window.scrollY,
        cardCount: getCards().length,
        nativeFilters: getNativeFilterState(),
        createdAt: Date.now(),
      });
      log('saved pending new-tab state', loadPendingNewTab());

      setTimeout(() => {
        const latest = loadPendingNewTab();
        if (latest && latest.token === token) clearPendingNewTab();
      }, 4000);
    }, true);
  }

  function finalizePendingNewTab() {
    const pending = loadPendingNewTab();
    if (!pending) return;

    if (!pending.createdAt || Date.now() - pending.createdAt > 15000) {
      clearPendingNewTab();
      return;
    }

    if (isListingsPath(location.pathname)) {
      return;
    }

    clearPendingNewTab();

    try {
      window.open(location.href, pending.token);
    } catch (_) {}

    saveReturnState({
      sourceUrl: pending.sourceUrl,
      scrollY: pending.scrollY || 0,
      cardCount: pending.cardCount || getCards().length,
      nativeFilters: pending.nativeFilters || [],
      createdAt: Date.now(),
    });
    log('saved return state', loadReturnState());

    setTimeout(() => {
      if (history.length > 1) {
        history.back();
      } else if (pending.sourceUrl) {
        location.replace(pending.sourceUrl);
      }
    }, 50);
  }

  function attempt(label, fn) {
    try {
      fn();
    } catch (error) {
      console.warn(`[MListFilter] ${label} failed`, error);
    }
  }

  function boot() {
    log('booting on', location.href);
    attempt('buildPanel', buildPanel);
    attempt('installNavigationInterceptor', installNavigationInterceptor);
    attempt('finalizePendingNewTab', finalizePendingNewTab);
    attempt('installNewTabHook', installNewTabHook);
    attempt('watchUrlChanges', watchUrlChanges);
    if (isListingsPath(location.pathname)) {
      setTimeout(() => {
        attempt('restoreListingsPosition', restoreListingsPosition);
      }, 1000);
    }
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(boot, 500);
  } else {
    window.addEventListener('DOMContentLoaded', () => setTimeout(boot, 500));
  }

  attempt('installDataInterceptors', installDataInterceptors);
  attempt('loadMileageCache', loadMileageCache);
})();
