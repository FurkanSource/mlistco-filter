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
'use strict';
(() => {
  // src/config.js
  var STORAGE_KEY = "mlf_state_v2";
  var NEW_TAB_KEY = "mlf_new_tab_pending_v1";
  var RETURN_KEY = "mlf_return_state_v1";
  var MILEAGE_CACHE_KEY = "mlf_mileage_v1";
  var DEFAULT_STATE = {
    query: "",
    yearMin: null,
    yearMax: null,
    priceMin: null,
    priceMax: null,
    milesMin: null,
    milesMax: null,
    hideSold: false
  };
  var CARD_SELECTOR = ".bubble-element.group-item";
  var MIN_FILTER_CARS = 100;
  var AUTO_LOAD_TARGET = 200;
  var MAX_BODY_BYTES = 5e6;
  var MAX_INFLIGHT_READS = 4;

  // src/filters/filter-store.js
  var NUMERIC_FILTERS = [
    "yearMin",
    "yearMax",
    "priceMin",
    "priceMax",
    "milesMin",
    "milesMax"
  ];
  function sanitizeState(raw) {
    if (!raw || typeof raw !== "object") return {};
    const clean = {};
    if (typeof raw.query === "string") clean.query = raw.query;
    for (const key of NUMERIC_FILTERS) {
      const value = Number(raw[key]);
      if (Number.isFinite(value)) clean[key] = Math.round(value);
    }
    clean.hideSold = !!raw.hideSold;
    return clean;
  }
  function hasAnyFilter(state) {
    return !!(state.query || state.yearMin || state.yearMax || state.priceMin || state.priceMax || state.milesMin || state.milesMax || state.hideSold);
  }
  function getActiveFilterCount(state) {
    let count = 0;
    if (state.query) count++;
    if (state.yearMin != null || state.yearMax != null) count++;
    if (state.priceMin != null || state.priceMax != null) count++;
    if (state.milesMin != null || state.milesMax != null) count++;
    if (state.hideSold) count++;
    return count;
  }
  function createFilterStore({
    storage,
    storageKey = STORAGE_KEY,
    initialState
  } = {}) {
    const getStorage = () => storage === void 0 ? globalThis.localStorage : storage;
    const load = () => {
      if (initialState !== void 0) return sanitizeState(initialState);
      try {
        const raw = getStorage().getItem(storageKey);
        return raw ? sanitizeState(JSON.parse(raw)) : {};
      } catch (_) {
        return {};
      }
    };
    const state = Object.assign({}, DEFAULT_STATE, load());
    const save = () => {
      try {
        getStorage().setItem(storageKey, JSON.stringify(state));
      } catch (_) {
      }
    };
    const reset = () => {
      Object.assign(state, DEFAULT_STATE);
      save();
      return state;
    };
    return {
      state,
      save,
      reset,
      hasAnyFilter: () => hasAnyFilter(state),
      getActiveFilterCount: () => getActiveFilterCount(state)
    };
  }

  // src/core/utils.js
  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  function normalizeText(text) {
    return String(text || "").replace(/\s+/g, " ").trim();
  }
  function log(...args) {
    console.log("[MListFilter]", ...args);
  }
  function isVisibleElement(node, windowObject = globalThis.window) {
    if (!node || !node.isConnected) return false;
    const style = windowObject.getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }
  function isListingsPath(pathname) {
    return /\/listings?\/?$/.test(pathname || "");
  }
  function isClassifiedPath(pathname) {
    return /\/classified\//.test(pathname || "");
  }
  function resolveUrl(rawUrl, baseUrl = globalThis.location && globalThis.location.href) {
    try {
      return new URL(String(rawUrl), baseUrl);
    } catch (_) {
      return null;
    }
  }
  async function waitFor(condition, timeoutMs = 6e3, intervalMs = 100, waitFn = wait) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (condition()) return true;
      await waitFn(intervalMs);
    }
    return false;
  }
  function waitForQuietDom(quietMs = 400, timeoutMs = 6e3, {
    documentObject = globalThis.document,
    MutationObserverClass = globalThis.MutationObserver,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout
  } = {}) {
    return new Promise((resolve) => {
      let quietTimer = null;
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeoutFn(quietTimer);
        clearTimeoutFn(deadline);
        observer.disconnect();
        resolve();
      };
      const observer = new MutationObserverClass((records) => {
        const outsidePanel = records.some((record) => {
          const target = record.target;
          const el = target && target.nodeType === 1 ? target : target && target.parentElement;
          return !el || !el.closest("#mlf-panel");
        });
        if (!outsidePanel) return;
        clearTimeoutFn(quietTimer);
        quietTimer = setTimeoutFn(finish, quietMs);
      });
      const deadline = setTimeoutFn(finish, timeoutMs);
      observer.observe(documentObject.body, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true
      });
      quietTimer = setTimeoutFn(finish, quietMs);
    });
  }
  async function settleScroll(targetY, attempts = 12, intervalMs = 120, {
    documentObject = globalThis.document,
    windowObject = globalThis.window,
    waitFn = wait,
    logger = log
  } = {}) {
    for (let i = 0; i < attempts; i++) {
      const maxY = Math.max(0, documentObject.documentElement.scrollHeight - windowObject.innerHeight);
      const y = Math.min(Math.max(targetY, 0), maxY);
      windowObject.scrollTo(0, y);
      await waitFn(intervalMs);
      if (Math.abs(windowObject.scrollY - y) < 4) {
        await waitFn(intervalMs);
        if (Math.abs(windowObject.scrollY - y) < 4) {
          logger("scroll settled", { target: targetY, landed: windowObject.scrollY, attempts: i + 1 });
          return true;
        }
      }
    }
    logger("scroll failed to settle", { target: targetY, landed: windowObject.scrollY });
    return false;
  }
  function attempt(label, fn, warn = (...args) => console.warn(...args)) {
    try {
      fn();
    } catch (error) {
      warn(`[MListFilter] ${label} failed`, error);
    }
  }
  function num(value) {
    if (value === "" || value == null) return null;
    const parsed = parseInt(String(value).replace(/[^\d]/g, ""), 10);
    return Number.isFinite(parsed) ? parsed : null;
  }

  // src/filters/native-filters.js
  function getElementPath(element) {
    if (!element || !element.tagName) return null;
    if (element.id) return `#${element.id}`;
    const parts = [];
    let node = element;
    while (node && node.nodeType === 1 && node !== document.body && parts.length < 5) {
      let part = node.tagName.toLowerCase();
      if (node.name) {
        part += `[name="${CSS.escape(node.name)}"]`;
      } else if (node.classList && node.classList.length) {
        const classes = Array.from(node.classList).slice(0, 2).map((className) => `.${CSS.escape(className)}`).join("");
        part += classes;
      }
      const parent = node.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter((child) => child.tagName === node.tagName);
        if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(node) + 1})`;
      }
      parts.unshift(part);
      node = parent;
    }
    return parts.join(" > ");
  }
  function isBubbleDropdown(node) {
    return !!(node && node.classList && node.classList.contains("Dropdown"));
  }
  function isMeaningfulNativeValue(value) {
    const text = normalizeText(value).toLowerCase();
    if (!text) return false;
    const blocked = [
      "all",
      "all models",
      "all generations",
      "any",
      "make",
      "model",
      "generation",
      "select",
      "select make",
      "select model",
      "select generation",
      "choose",
      "choose make",
      "choose model",
      "choose generation",
      "filter",
      "filters"
    ];
    return !blocked.includes(text);
  }
  function getNativeFilterState() {
    const activeSelects = Array.from(document.querySelectorAll("select.bubble-element.Dropdown")).filter((node) => !node.closest("#mlf-panel")).filter((node) => isVisibleElement(node)).filter((node) => node.options && node.options.length > 1).map((node, index) => ({
      kind: "native-select",
      index,
      value: node.value,
      selectedText: node.options[node.selectedIndex]?.text || "",
      disabled: !!node.disabled
    })).filter((item) => isMeaningfulNativeValue(item.value) || isMeaningfulNativeValue(item.selectedText));
    if (activeSelects.length) {
      log("captured native selects", activeSelects);
      return activeSelects;
    }
    const nodes = Array.from(document.querySelectorAll(
      'select, input:not([type="hidden"]), textarea, .bubble-element.Dropdown'
    ));
    return nodes.map((node) => {
      const path = getElementPath(node);
      if (!path) return null;
      const text = normalizeText(node.innerText || node.textContent || "");
      const value = isBubbleDropdown(node) ? text : "value" in node ? node.value : "";
      return {
        path,
        tag: node.tagName.toLowerCase(),
        type: node.type || "",
        value,
        checked: !!node.checked,
        text
      };
    }).filter(Boolean);
  }
  function hasSpecificNativeFiltersSelected() {
    const nativeStates = getNativeFilterState();
    const meaningful = nativeStates.filter((item) => {
      if (!item) return false;
      if (item.kind === "native-select") {
        return isMeaningfulNativeValue(item.value || item.selectedText);
      }
      if (!item.path || item.path.includes("#mlf-panel")) return false;
      if (!(item.tag === "select" || isBubbleDropdown(document.querySelector(item.path)))) return false;
      return isMeaningfulNativeValue(item.value || item.text);
    });
    return meaningful.length >= 2;
  }
  function dispatchNativeEvents(node) {
    node.dispatchEvent(new Event("input", { bubbles: true }));
    node.dispatchEvent(new Event("change", { bubbles: true }));
  }
  function collectClickableTextNodes() {
    const candidates = [];
    for (const node of document.querySelectorAll("div, span, li, button, a")) {
      if (!node || !node.isConnected) continue;
      if (node.closest("#mlf-panel")) continue;
      const text = normalizeText(node.textContent || "");
      if (!text || text.length > 120) continue;
      candidates.push(node);
    }
    return candidates.filter((node) => isVisibleElement(node));
  }
  async function restoreBubbleDropdown(node, item) {
    const targetText = normalizeText(item.value || item.text);
    if (!targetText) return;
    const currentText = normalizeText(node.innerText || node.textContent || "");
    if (currentText === targetText) return;
    node.click();
    await waitForQuietDom(150, 1500);
    const candidates = collectClickableTextNodes();
    const exactMatch = candidates.find(
      (candidate) => normalizeText(candidate.innerText || candidate.textContent || "") === targetText
    );
    const partialMatch = candidates.find(
      (candidate) => normalizeText(candidate.innerText || candidate.textContent || "").includes(targetText)
    );
    const option = exactMatch || partialMatch;
    if (!option) return;
    option.click();
    await waitForQuietDom();
  }
  async function restoreNativeFilterState(saved) {
    if (!Array.isArray(saved) || !saved.length) {
      log("no native filter state to restore");
      return;
    }
    log("restoring native filters", saved);
    if (saved.every((item) => item && item.kind === "native-select")) {
      for (const item of saved) {
        const ready = await waitFor(() => {
          const current = Array.from(document.querySelectorAll("select.bubble-element.Dropdown")).filter((node3) => !node3.closest("#mlf-panel")).filter((node3) => isVisibleElement(node3));
          const node2 = current[item.index];
          if (!node2 || node2.disabled) return false;
          return Array.from(node2.options || []).some(
            (option2) => option2.value === item.value || normalizeText(option2.text) === normalizeText(item.selectedText)
          );
        }, 8e3, 150);
        log("restore wait result", {
          index: item.index,
          targetValue: item.value,
          targetText: item.selectedText,
          ready
        });
        const selects = Array.from(document.querySelectorAll("select.bubble-element.Dropdown")).filter((node2) => !node2.closest("#mlf-panel")).filter((node2) => isVisibleElement(node2));
        log("visible selects on restore", selects.map((node2, index) => ({
          index,
          disabled: !!node2.disabled,
          value: node2.value,
          selectedText: node2.options[node2.selectedIndex]?.text || "",
          optionCount: node2.options?.length || 0
        })));
        const node = selects[item.index];
        if (!node) {
          log("restore failed: select missing", item.index);
          continue;
        }
        if (node.disabled) {
          log("restore skipped: select disabled", item.index);
          continue;
        }
        const option = Array.from(node.options || []).find(
          (entry) => entry.value === item.value || normalizeText(entry.text) === normalizeText(item.selectedText)
        );
        if (!option) {
          log("restore failed: option not found", {
            index: item.index,
            targetValue: item.value,
            targetText: item.selectedText,
            options: Array.from(node.options || []).map((entry) => ({
              value: entry.value,
              text: entry.text
            }))
          });
          continue;
        }
        if (node.value === option.value) {
          log("restore re-trigger: already selected", { index: item.index, value: option.value, text: option.text });
          dispatchNativeEvents(node);
          await waitForQuietDom();
          continue;
        }
        log("restoring select", { index: item.index, from: node.value, to: option.value, text: option.text });
        node.value = option.value;
        dispatchNativeEvents(node);
        await waitForQuietDom();
        log("restore post-dispatch state", {
          index: item.index,
          value: node.value,
          selectedText: node.options[node.selectedIndex]?.text || ""
        });
      }
      return;
    }
    for (const item of saved) {
      const node = document.querySelector(item.path);
      if (!node || node.closest("#mlf-panel")) continue;
      if (isBubbleDropdown(node)) {
        await restoreBubbleDropdown(node, item);
        continue;
      }
      if (item.tag === "select" || item.tag === "textarea" || item.tag === "input" && item.type !== "checkbox" && item.type !== "radio") {
        if (node.value !== item.value) {
          node.value = item.value;
          dispatchNativeEvents(node);
        }
        continue;
      }
      if (item.tag === "input" && (item.type === "checkbox" || item.type === "radio")) {
        if (!!node.checked !== !!item.checked) {
          node.checked = !!item.checked;
          dispatchNativeEvents(node);
        }
      }
    }
    await waitForQuietDom();
  }
  async function waitForRestoredNativeFilters(saved) {
    if (!Array.isArray(saved) || !saved.length) return true;
    if (!saved.every((item) => item && item.kind === "native-select")) return true;
    const ready = await waitFor(() => {
      const selects = Array.from(document.querySelectorAll("select.bubble-element.Dropdown")).filter((node) => !node.closest("#mlf-panel")).filter((node) => isVisibleElement(node));
      return saved.every((item) => {
        const node = selects[item.index];
        if (!node || node.disabled) return false;
        const selectedText = node.options[node.selectedIndex]?.text || "";
        return node.value === item.value || normalizeText(selectedText) === normalizeText(item.selectedText);
      });
    }, 12e3, 200);
    log("native filters stabilized", { ready });
    if (ready) await waitForQuietDom();
    return ready;
  }

  // src/listings/card-parser.js
  var PRICE_RE = /\$\s*([\d,]+(?:\.\d+)?)(k|m)?(?![a-z])/i;
  var YEAR_RE = /(?<!\$)\b(19\d{2}|20[0-4]\d)\b/;
  var MILES_RE = /([\d,]+(?:\.\d+)?)\s*(k)?\s*(mi\b|miles\b|km\b|kilometers\b)/gi;
  var MILES_LABEL_RE = /(?:miles|mileage|odometer)\s*:?\s*([\d,]+(?:\.\d+)?)[ \t]*(k)?\b/i;
  var KM_TO_MILES = 0.621371;
  function parsePrice(text) {
    const match = text.match(PRICE_RE);
    if (!match) return null;
    const value = parseFloat(match[1].replace(/,/g, ""));
    if (!Number.isFinite(value)) return null;
    const suffix = (match[2] || "").toLowerCase();
    if (suffix === "k") return Math.round(value * 1e3);
    if (suffix === "m") return Math.round(value * 1e6);
    return Math.round(value);
  }
  function precededByDollar(text, index) {
    let cursor = index - 1;
    while (cursor >= 0 && /\s/.test(text[cursor])) cursor--;
    return cursor >= 0 && text[cursor] === "$";
  }
  function parseMiles(text) {
    let number = null;
    let thousands = null;
    let unit = "mi";
    let adjacent = null;
    MILES_RE.lastIndex = 0;
    let match;
    while ((match = MILES_RE.exec(text)) !== null) {
      if (precededByDollar(text, match.index)) continue;
      adjacent = match;
      break;
    }
    if (adjacent) {
      number = adjacent[1];
      thousands = adjacent[2];
      unit = adjacent[3];
    } else {
      const labelled = text.match(MILES_LABEL_RE);
      if (!labelled) return null;
      number = labelled[1];
      thousands = labelled[2];
    }
    const value = parseFloat(String(number).replace(/,/g, ""));
    if (!Number.isFinite(value)) return null;
    const scaled = thousands ? value * 1e3 : value;
    const isKilometers = /^k(m|ilometers)/i.test(unit);
    return Math.round(isKilometers ? scaled * KM_TO_MILES : scaled);
  }
  function parseCard(card) {
    const text = card.innerText || "";
    const raw = card.textContent || "";
    const yearMatch = text.match(YEAR_RE);
    const sold = /\bsold\b/i.test(text);
    return {
      text: text.toLowerCase(),
      price: parsePrice(text),
      year: yearMatch ? parseInt(yearMatch[1], 10) : null,
      miles: parseMiles(text) ?? (raw !== text ? parseMiles(raw) : null),
      sold
    };
  }
  function matches(parsed, state) {
    if (state.hideSold && parsed.sold) return false;
    if (state.query) {
      const terms = state.query.toLowerCase().split(/\s+/).filter(Boolean);
      if (!terms.every((term) => parsed.text.includes(term))) return false;
    }
    if (state.yearMin != null && parsed.year != null && parsed.year < state.yearMin) return false;
    if (state.yearMax != null && parsed.year != null && parsed.year > state.yearMax) return false;
    if (state.priceMin != null && parsed.price != null && parsed.price < state.priceMin) return false;
    if (state.priceMax != null && parsed.price != null && parsed.price > state.priceMax) return false;
    if (state.milesMin != null && parsed.miles != null && parsed.miles < state.milesMin) return false;
    if (state.milesMax != null && parsed.miles != null && parsed.miles > state.milesMax) return false;
    return true;
  }
  function createCardParser({ mileageRegistry: mileageRegistry2 } = {}) {
    const parseCache = /* @__PURE__ */ new WeakMap();
    const registry = mileageRegistry2 || {
      getVersion: () => 0,
      lookupMiles: () => null
    };
    const parseCardCached = (card, index) => {
      const key = `${card.textContent || ""}\0${registry.getVersion()}`;
      const cached = parseCache.get(card);
      if (cached && cached.key === key) return cached.parsed;
      const parsed = parseCard(card);
      if (parsed.miles === null) {
        const found = registry.lookupMiles(parsed, index);
        if (found !== null && found !== void 0) parsed.miles = found;
      }
      parseCache.set(card, { key, parsed });
      return parsed;
    };
    return { parseCard, parseCardCached };
  }

  // src/listings/cards.js
  function getCards(root = globalThis.document, selector = CARD_SELECTOR) {
    return Array.from(root.querySelectorAll(selector));
  }
  function showAllCards(cards) {
    for (const card of cards) card.style.display = "";
  }
  function getFilterGateState(active, {
    cards = null,
    root = globalThis.document,
    selector = CARD_SELECTOR,
    minFilterCars = MIN_FILTER_CARS
  } = {}) {
    const resolvedCards = cards || getCards(root, selector);
    return {
      cards: resolvedCards,
      count: resolvedCards.length,
      active,
      ready: resolvedCards.length >= minFilterCars
    };
  }

  // src/ui/status.js
  function setStatus(message, tone = "neutral") {
    const status = document.getElementById("mlf-status");
    if (!status) return;
    status.dataset.tone = tone;
    status.textContent = message || "Load listings, then filter";
  }
  function renderOdometer(value) {
    const odometer = document.getElementById("mlf-odo");
    if (!odometer) return;
    const digits = String(Math.max(0, Math.min(value, 9999))).padStart(4, "0").split("");
    if (odometer.childElementCount !== digits.length) {
      odometer.innerHTML = digits.map(() => '<span class="mlf-digit"><i>0</i></span>').join("");
    }
    Array.from(odometer.children).forEach((cell, index) => {
      const inner = cell.firstElementChild;
      if (!inner || inner.textContent === digits[index]) return;
      inner.textContent = digits[index];
      cell.classList.remove("roll");
      void cell.offsetWidth;
      cell.classList.add("roll");
    });
  }
  function updatePanelMeta(cardCount) {
    renderOdometer(cardCount);
  }

  // src/listings/filter-controller.js
  function createFilterController({ filterStore: filterStore2, cardParser: cardParser2 }) {
    let lastCards = [];
    function refreshPanelMeta() {
      updatePanelMeta(getCards().length);
    }
    function applyFilter() {
      const gate = getFilterGateState(filterStore2.hasAnyFilter());
      lastCards = gate.cards;
      if (!gate.count && isListingsPath(location.pathname)) {
        log("card selector matched nothing", CARD_SELECTOR);
        setStatus("No listings found — the page markup may have changed", "warning");
        refreshPanelMeta();
        return;
      }
      if (gate.active && !gate.ready) {
        showAllCards(gate.cards);
        setStatus(`Load ${MIN_FILTER_CARS} listings before filtering — ${gate.count} so far`, "loading");
        refreshPanelMeta();
        return;
      }
      showAllCards(gate.cards);
      const parsedCards = gate.cards.map((card, index) => cardParser2.parseCardCached(card, index));
      let shown = 0;
      for (let index = 0; index < gate.cards.length; index++) {
        const visible = matches(parsedCards[index], filterStore2.state);
        gate.cards[index].style.display = visible ? "" : "none";
        if (visible) shown++;
      }
      setStatus(`${shown} of ${gate.cards.length} shown`, shown === gate.cards.length ? "neutral" : "success");
      refreshPanelMeta();
    }
    function applyFilterIfActive() {
      if (filterStore2.hasAnyFilter()) applyFilter();
      else refreshPanelMeta();
    }
    function resetVisibleCards() {
      showAllCards(lastCards);
    }
    return {
      applyFilter,
      applyFilterIfActive,
      refreshPanelMeta,
      resetVisibleCards
    };
  }

  // src/listings/auto-loader.js
  var MORE_RE = /^(show|load|view)\s+more\b|^more\s+(results|listings|cars)\b/i;
  function createAutoLoader({ windowObject = window } = {}) {
    let autoLoading = false;
    let autoLoadingPromise = null;
    function getCardScrollContainer() {
      const card = document.querySelector(CARD_SELECTOR);
      let node = card && card.parentElement;
      let depth = 0;
      while (node && node !== document.body && depth++ < 15) {
        const style = windowObject.getComputedStyle(node);
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
          last.scrollIntoView({ block: "end" });
        } catch (_) {
        }
      }
      if (container) container.scrollTop = container.scrollHeight;
      windowObject.scrollTo(0, document.documentElement.scrollHeight);
    }
    function clickLoadMore(container) {
      const root = container || document;
      for (const node of root.querySelectorAll('button, [role="button"], div, span')) {
        if (node.closest("#mlf-panel")) continue;
        const text = normalizeText(node.textContent || "");
        if (!text || text.length > 30 || !MORE_RE.test(text)) continue;
        if (!isVisibleElement(node)) continue;
        log("clicking load-more control", text);
        node.click();
        return true;
      }
      return false;
    }
    async function autoLoadCards(targetCount = AUTO_LOAD_TARGET, preserveScroll = true, force = false) {
      if (!force && !hasSpecificNativeFiltersSelected()) {
        setStatus("Choose a model and generation first", "warning");
        return;
      }
      if (autoLoading) return autoLoadingPromise;
      autoLoading = true;
      autoLoadingPromise = runAutoLoad(targetCount, preserveScroll);
      return autoLoadingPromise;
    }
    async function runAutoLoad(targetCount, preserveScroll) {
      const startY = windowObject.scrollY;
      let container = getCardScrollContainer();
      let startContainerY = container ? container.scrollTop : 0;
      let maxSeen = getCards().length;
      let stagnant = 0;
      const startedAt = Date.now();
      const maxMs = 6e4;
      log("auto-load start", {
        cards: maxSeen,
        targetCount,
        container: container ? container.className || container.tagName : "window"
      });
      try {
        while (Date.now() - startedAt < maxMs) {
          if (getCards().length >= targetCount) break;
          if (!container) {
            container = getCardScrollContainer();
            if (container) startContainerY = container.scrollTop;
          }
          scrollCardsToBottom(container);
          await wait(700);
          const count = getCards().length;
          setStatus(`Loading… ${count} listings`, "loading");
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
          windowObject.scrollTo(0, startY);
          if (container) container.scrollTop = startContainerY;
        }
        const loaded = getCards().length;
        if (loaded >= targetCount) {
          setStatus(`${loaded} listings loaded`, "success");
        } else {
          setStatus(`Stopped at ${loaded} listings — no more to load`, "neutral");
        }
        updatePanelMeta(loaded);
      }
    }
    return {
      autoLoadCards,
      clickLoadMore,
      getCardScrollContainer,
      runAutoLoad
    };
  }

  // src/mileage/registry.js
  var MILEAGE_HINT_RE = /mile|milage|odom|kilomet/i;
  var MILEAGE_KEY_RE = /(mile|milage|odom|kilomet|^kms?$)/i;
  var KM_KEY_RE = /(kilomet|^kms?$)/i;
  var PRICE_KEY_RE = /(price|asking|cost)/i;
  var YEAR_KEY_RE = /(^year$|model.?year|^yr$)/i;
  var ID_KEY_RE = /^(_id|id|unique ?id)$/i;
  var KM_TO_MILES2 = 0.621371;
  var AMBIGUOUS = /* @__PURE__ */ Symbol("ambiguous");
  function signatureOf(price, year) {
    if (price === null || price === void 0 || year === null || year === void 0) return null;
    return `${price}|${year}`;
  }
  function numericValue(value) {
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (typeof value === "string") {
      const parsed = parseFloat(value.replace(/[^\d.]/g, ""));
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }
  function createMileageRegistry({
    storage,
    logger = log,
    onRegistryChanged = () => {
    }
  } = {}) {
    const getStorage = () => storage === void 0 ? globalThis.localStorage : storage;
    const mileageById = /* @__PURE__ */ new Map();
    const mileageBySignature = /* @__PURE__ */ new Map();
    const mileageByOrder = [];
    const seenRecordIds = /* @__PURE__ */ new Set();
    const seenMileageFields = /* @__PURE__ */ new Set();
    let registryVersion = 0;
    function extractRecord(object) {
      let miles = null;
      let milesKey = null;
      let id = null;
      let price = null;
      let year = null;
      for (const key of Object.keys(object)) {
        const value = object[key];
        if (value && typeof value === "object") continue;
        if (miles === null && MILEAGE_KEY_RE.test(key)) {
          const parsed = numericValue(value);
          if (parsed !== null && parsed >= 0 && parsed < 2e6) {
            miles = KM_KEY_RE.test(key) ? Math.round(parsed * KM_TO_MILES2) : Math.round(parsed);
            milesKey = key;
          }
        }
        if (id === null && ID_KEY_RE.test(key) && typeof value === "string") id = value;
        if (price === null && PRICE_KEY_RE.test(key)) {
          const parsed = numericValue(value);
          if (parsed !== null && parsed > 0) price = Math.round(parsed);
        }
        if (year === null && YEAR_KEY_RE.test(key)) {
          const parsed = numericValue(value);
          if (parsed !== null && parsed > 1900 && parsed < 2050) year = Math.round(parsed);
        }
      }
      if (miles === null) return null;
      if (milesKey && !seenMileageFields.has(milesKey)) {
        seenMileageFields.add(milesKey);
        logger("mileage field discovered in network data:", milesKey, "=", miles);
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
      const signature = signatureOf(record.price, record.year);
      if (signature) {
        const existing = mileageBySignature.get(signature);
        if (existing !== void 0 && existing !== record.miles) {
          mileageBySignature.set(signature, AMBIGUOUS);
        } else if (existing === void 0) {
          mileageBySignature.set(signature, record.miles);
        }
      }
      return true;
    }
    function harvestJson(root) {
      let added = 0;
      let nodes = 0;
      const stack = [[root, 0]];
      while (stack.length && nodes < 4e4) {
        const [node, depth] = stack.pop();
        nodes++;
        if (!node || typeof node !== "object" || depth > 14) continue;
        if (Array.isArray(node)) {
          for (const item of node) stack.push([item, depth + 1]);
          continue;
        }
        const record = extractRecord(node);
        if (record && addRecord(record)) added++;
        for (const key of Object.keys(node)) {
          const value = node[key];
          if (value && typeof value === "object") {
            stack.push([value, depth + 1]);
          } else if (typeof value === "string" && value.length > 20 && MILEAGE_HINT_RE.test(value)) {
            const head = value.slice(0, 40).trim();
            if (head.startsWith("{") || head.startsWith("[")) {
              try {
                stack.push([JSON.parse(value), depth + 1]);
              } catch (_) {
              }
            }
          }
        }
      }
      return added;
    }
    function ingestValue(value) {
      if (!value || typeof value !== "object") return;
      const added = harvestJson(value);
      if (!added) return;
      registryVersion++;
      saveCache();
      logger("mileage records captured:", added, "total:", mileageByOrder.length);
      onRegistryChanged();
    }
    function ingestText(text) {
      if (typeof text !== "string" || !text || text.length > 5e6) return;
      const head = text.slice(0, 200).trim();
      if (!head.startsWith("{") && !head.startsWith("[")) return;
      if (!MILEAGE_HINT_RE.test(text)) return;
      let value;
      try {
        value = JSON.parse(text);
      } catch (_) {
        return;
      }
      ingestValue(value);
    }
    function loadCache() {
      try {
        const raw = getStorage().getItem(MILEAGE_CACHE_KEY);
        if (!raw) return;
        const list = JSON.parse(raw);
        if (!Array.isArray(list)) return;
        for (const item of list) {
          if (!item || typeof item !== "object") continue;
          const miles = Number(item.m);
          if (!Number.isFinite(miles)) continue;
          if (item.i) mileageById.set(String(item.i), miles);
          const signature = signatureOf(item.p ?? null, item.y ?? null);
          if (signature && !mileageBySignature.has(signature)) mileageBySignature.set(signature, miles);
        }
        registryVersion++;
        logger("mileage cache loaded:", mileageById.size, "by id,", mileageBySignature.size, "by signature");
      } catch (_) {
      }
    }
    function saveCache() {
      try {
        const list = [];
        for (const [signature, miles] of mileageBySignature) {
          if (miles === AMBIGUOUS || list.length >= 3e3) continue;
          const [price, year] = signature.split("|");
          list.push({ p: Number(price), y: Number(year), m: miles });
        }
        getStorage().setItem(MILEAGE_CACHE_KEY, JSON.stringify(list));
      } catch (_) {
      }
    }
    function lookupMiles(parsed, index) {
      const signature = signatureOf(parsed.price, parsed.year);
      if (signature) {
        const hit = mileageBySignature.get(signature);
        if (hit !== void 0 && hit !== AMBIGUOUS) return hit;
      }
      if (typeof index === "number" && index >= 0 && index < mileageByOrder.length) {
        return mileageByOrder[index];
      }
      return null;
    }
    return {
      getVersion: () => registryVersion,
      harvestJson,
      ingestText,
      ingestValue,
      loadCache,
      lookupMiles,
      saveCache
    };
  }

  // src/mileage/interceptors.js
  function isJsonContentType(value) {
    return typeof value === "string" && /\bjson\b/i.test(value);
  }
  function createDataInterceptors({
    ingestText,
    ingestValue,
    logger = log,
    windowObject = window
  } = {}) {
    let inflightReads = 0;
    function maybeIngestResponse(response) {
      if (!response || !response.headers || typeof response.clone !== "function") return;
      if (!isJsonContentType(response.headers.get("content-type"))) return;
      const length = Number(response.headers.get("content-length"));
      if (Number.isFinite(length) && length > MAX_BODY_BYTES) return;
      if (inflightReads >= MAX_INFLIGHT_READS) return;
      inflightReads++;
      response.clone().text().then((text) => {
        inflightReads--;
        ingestText(text);
      }).catch(() => {
        inflightReads--;
      });
    }
    function install() {
      if (windowObject.__mlfDataPatched) return;
      windowObject.__mlfDataPatched = true;
      const originalFetch = windowObject.fetch;
      if (typeof originalFetch === "function") {
        windowObject.fetch = function patchedFetch() {
          const result = originalFetch.apply(this, arguments);
          if (!result || typeof result.then !== "function") return result;
          return result.then((response) => {
            try {
              maybeIngestResponse(response);
            } catch (_) {
            }
            return response;
          });
        };
      }
      const XHR = windowObject.XMLHttpRequest;
      if (XHR && XHR.prototype) {
        const open = XHR.prototype.open;
        const send = XHR.prototype.send;
        XHR.prototype.open = function patchedOpen(method, url) {
          this.__mlfUrl = String(url || "");
          return open.apply(this, arguments);
        };
        XHR.prototype.send = function patchedSend() {
          try {
            this.addEventListener("load", () => {
              try {
                const type = this.getResponseHeader && this.getResponseHeader("content-type");
                if (!isJsonContentType(type)) return;
                const responseType = this.responseType;
                if (responseType === "" || responseType === "text") ingestText(this.responseText);
                else if (responseType === "json") ingestValue(this.response);
              } catch (_) {
              }
            });
          } catch (_) {
          }
          return send.apply(this, arguments);
        };
      }
      logger("data interceptors installed");
    }
    return { install, maybeIngestResponse };
  }

  // src/navigation/session-store.js
  function createNavigationStore({ storage } = {}) {
    const getStorage = () => storage === void 0 ? globalThis.sessionStorage : storage;
    function load(key) {
      try {
        const raw = getStorage().getItem(key);
        return raw ? JSON.parse(raw) : null;
      } catch (_) {
        return null;
      }
    }
    function save(key, value) {
      try {
        getStorage().setItem(key, JSON.stringify(value));
      } catch (_) {
      }
    }
    function clear(key) {
      try {
        getStorage().removeItem(key);
      } catch (_) {
      }
    }
    return {
      clearPendingNewTab: () => clear(NEW_TAB_KEY),
      clearReturnState: () => clear(RETURN_KEY),
      loadPendingNewTab: () => load(NEW_TAB_KEY),
      loadReturnState: () => load(RETURN_KEY),
      savePendingNewTab: (value) => save(NEW_TAB_KEY, value),
      saveReturnState: (value) => save(RETURN_KEY, value)
    };
  }

  // src/navigation/location-interceptor.js
  function createLocationInterceptor({ navigationStore: navigationStore2, windowObject = window }) {
    function consumePendingNewTabForUrl(rawUrl) {
      const pending = navigationStore2.loadPendingNewTab();
      if (!pending) return false;
      if (!pending.createdAt || Date.now() - pending.createdAt > 1e4) {
        navigationStore2.clearPendingNewTab();
        return false;
      }
      const target = resolveUrl(rawUrl);
      if (!target || !isClassifiedPath(target.pathname)) return false;
      navigationStore2.clearPendingNewTab();
      try {
        windowObject.open(target.href, pending.token);
        return true;
      } catch (_) {
        return false;
      }
    }
    function install() {
      if (windowObject.__mlfNavPatched) return;
      windowObject.__mlfNavPatched = true;
      const locationProto = Object.getPrototypeOf(windowObject.location);
      try {
        const assign = locationProto.assign;
        if (typeof assign === "function") {
          locationProto.assign = function patchedAssign(url) {
            if (this === windowObject.location && consumePendingNewTabForUrl(url)) return;
            return assign.call(this, url);
          };
        }
      } catch (_) {
      }
      try {
        const replace = locationProto.replace;
        if (typeof replace === "function") {
          locationProto.replace = function patchedReplace(url) {
            if (this === windowObject.location && consumePendingNewTabForUrl(url)) return;
            return replace.call(this, url);
          };
        }
      } catch (_) {
      }
      try {
        const hrefDescriptor = Object.getOwnPropertyDescriptor(locationProto, "href");
        if (hrefDescriptor && typeof hrefDescriptor.get === "function" && typeof hrefDescriptor.set === "function" && hrefDescriptor.configurable) {
          Object.defineProperty(locationProto, "href", {
            configurable: true,
            enumerable: hrefDescriptor.enumerable,
            get() {
              return hrefDescriptor.get.call(this);
            },
            set(url) {
              if (this === windowObject.location && consumePendingNewTabForUrl(url)) return;
              return hrefDescriptor.set.call(this, url);
            }
          });
        }
      } catch (_) {
      }
    }
    return { consumePendingNewTabForUrl, install };
  }

  // src/navigation/tab-continuity.js
  function createTabContinuity({
    navigationStore: navigationStore2,
    getCards: getCards2,
    getNativeFilterState: getNativeFilterState2,
    windowObject = window
  }) {
    function installNewTabHook() {
      if (windowObject.__mlfClickHookInstalled) return;
      windowObject.__mlfClickHookInstalled = true;
      document.addEventListener("click", (event) => {
        if (!isListingsPath(location.pathname)) return;
        const card = event.target.closest(CARD_SELECTOR);
        if (!card) return;
        if (event.ctrlKey || event.metaKey || event.shiftKey || event.button !== 0) return;
        const token = `mlf-tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const popup = windowObject.open("about:blank", token);
        if (!popup) {
          console.warn("[MListFilter] popup blocked; cannot open listing in new tab");
          setStatus("Allow popups to keep your place", "warning");
          return;
        }
        navigationStore2.savePendingNewTab({
          token,
          sourceUrl: location.href,
          scrollY: windowObject.scrollY,
          cardCount: getCards2().length,
          nativeFilters: getNativeFilterState2(),
          createdAt: Date.now()
        });
        log("saved pending new-tab state", navigationStore2.loadPendingNewTab());
        setTimeout(() => {
          const latest = navigationStore2.loadPendingNewTab();
          if (latest && latest.token === token) navigationStore2.clearPendingNewTab();
        }, 4e3);
      }, true);
    }
    function finalizePendingNewTab() {
      const pending = navigationStore2.loadPendingNewTab();
      if (!pending) return;
      if (!pending.createdAt || Date.now() - pending.createdAt > 15e3) {
        navigationStore2.clearPendingNewTab();
        return;
      }
      if (isListingsPath(location.pathname)) return;
      navigationStore2.clearPendingNewTab();
      try {
        windowObject.open(location.href, pending.token);
      } catch (_) {
      }
      navigationStore2.saveReturnState({
        sourceUrl: pending.sourceUrl,
        scrollY: pending.scrollY || 0,
        cardCount: pending.cardCount || getCards2().length,
        nativeFilters: pending.nativeFilters || [],
        createdAt: Date.now()
      });
      log("saved return state", navigationStore2.loadReturnState());
      setTimeout(() => {
        if (history.length > 1) {
          history.back();
        } else if (pending.sourceUrl) {
          location.replace(pending.sourceUrl);
        }
      }, 50);
    }
    return { finalizePendingNewTab, installNewTabHook };
  }

  // src/navigation/history-watcher.js
  function createHistoryWatcher({ autoLoadCards, windowObject = window }) {
    let lastPath = windowObject.location.pathname;
    function install() {
      if (windowObject.__mlfHistoryPatched) return;
      windowObject.__mlfHistoryPatched = true;
      const onChange = () => {
        if (windowObject.location.pathname === lastPath) return;
        lastPath = windowObject.location.pathname;
        log("url changed →", lastPath);
        if (isListingsPath(lastPath)) {
          setTimeout(() => {
            autoLoadCards();
          }, 800);
        }
      };
      for (const method of ["pushState", "replaceState"]) {
        const original = windowObject.history[method];
        if (typeof original !== "function") continue;
        windowObject.history[method] = function patchedHistoryMethod(...args) {
          const result = original.apply(this, args);
          onChange();
          return result;
        };
      }
      windowObject.addEventListener("popstate", onChange);
      windowObject.addEventListener("hashchange", onChange);
    }
    return { install };
  }

  // src/navigation/return-restorer.js
  function createReturnRestorer({
    navigationStore: navigationStore2,
    restoreNativeFilterState: restoreNativeFilterState2,
    waitForRestoredNativeFilters: waitForRestoredNativeFilters2,
    autoLoadCards,
    filterStore: filterStore2,
    filterController: filterController2
  }) {
    async function restoreListingsPosition() {
      const saved = navigationStore2.loadReturnState();
      if (!saved) {
        log("no return state found");
        return false;
      }
      if (!saved.createdAt || Date.now() - saved.createdAt > 3e4) {
        log("return state expired", saved);
        navigationStore2.clearReturnState();
        return false;
      }
      log("restoring listings position", saved);
      navigationStore2.clearReturnState();
      await restoreNativeFilterState2(saved.nativeFilters);
      await waitForRestoredNativeFilters2(saved.nativeFilters);
      await autoLoadCards(Math.max(saved.cardCount || 0, 13), false, true);
      if (filterStore2.hasAnyFilter()) filterController2.applyFilter();
      await settleScroll(Math.max(saved.scrollY || 0, 0));
      return true;
    }
    return { restoreListingsPosition };
  }

  // src/ui/panel.css
  var panel_default = `#mlf-panel {
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
  to { transform: translateY(0); opacity: 1; }
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

@keyframes mlf-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: .2; }
}

@media (prefers-reduced-motion: reduce) {
  #mlf-panel .mlf-digit.roll i,
  #mlf-status[data-tone="loading"]::before { animation: none; }
}

#mlf-panel ::selection { background: var(--mlf-amber); color: #12151a; }

`;

  // src/ui/panel.html
  var panel_default2 = '<div class="mlf-head">\n  <div>\n    <div class="mlf-odo" id="mlf-odo"></div>\n    <div class="mlf-cap">Listings loaded</div>\n  </div>\n  <button id="mlf-title" class="mlf-toggle" type="button" aria-expanded="true" aria-controls="mlf-body" aria-label="Collapse filters"><span id="mlf-toggle">&minus;</span></button>\n</div>\n<div class="mlf-body" id="mlf-body">\n  <div class="mlf-field">\n    <label class="mlf-label" for="mlf-q">Search</label>\n    <input id="mlf-q" type="text" placeholder="m3 xdrive" />\n  </div>\n  <div class="mlf-field">\n    <label class="mlf-label" for="mlf-ymin">Year</label>\n    <div class="mlf-pair">\n      <input id="mlf-ymin" class="mlf-num" type="text" inputmode="numeric" placeholder="min" aria-label="Minimum year" />\n      <input id="mlf-ymax" class="mlf-num" type="text" inputmode="numeric" placeholder="max" aria-label="Maximum year" />\n    </div>\n  </div>\n  <div class="mlf-field">\n    <label class="mlf-label" for="mlf-pmin">Price</label>\n    <div class="mlf-pair">\n      <input id="mlf-pmin" class="mlf-num" type="text" inputmode="numeric" placeholder="min" aria-label="Minimum price" />\n      <input id="mlf-pmax" class="mlf-num" type="text" inputmode="numeric" placeholder="max" aria-label="Maximum price" />\n    </div>\n  </div>\n  <div class="mlf-field">\n    <label class="mlf-label" for="mlf-mmin">Miles</label>\n    <div class="mlf-pair">\n      <input id="mlf-mmin" class="mlf-num" type="text" inputmode="numeric" placeholder="min" aria-label="Minimum miles" />\n      <input id="mlf-mmax" class="mlf-num" type="text" inputmode="numeric" placeholder="max" aria-label="Maximum miles" />\n    </div>\n  </div>\n  <label class="mlf-check" for="mlf-sold">\n    <input id="mlf-sold" type="checkbox" />\n    Hide sold listings\n  </label>\n  <div class="mlf-actions">\n    <button id="mlf-apply" class="mlf-btn primary" type="button">Apply</button>\n    <button id="mlf-reset" class="mlf-btn" type="button">Reset</button>\n  </div>\n  <button id="mlf-load" class="mlf-btn ghost" type="button">Load inventory</button>\n  <div id="mlf-status" data-tone="neutral"></div>\n</div>\n\n';

  // src/ui/panel.js
  var INPUT_IDS = [
    "mlf-q",
    "mlf-ymin",
    "mlf-ymax",
    "mlf-pmin",
    "mlf-pmax",
    "mlf-mmin",
    "mlf-mmax"
  ];
  function createPanel({ filterStore: filterStore2, filterController: filterController2, autoLoader: autoLoader2 }) {
    function readForm() {
      const { state } = filterStore2;
      state.query = document.getElementById("mlf-q").value.trim();
      state.yearMin = num(document.getElementById("mlf-ymin").value);
      state.yearMax = num(document.getElementById("mlf-ymax").value);
      state.priceMin = num(document.getElementById("mlf-pmin").value);
      state.priceMax = num(document.getElementById("mlf-pmax").value);
      state.milesMin = num(document.getElementById("mlf-mmin").value);
      state.milesMax = num(document.getElementById("mlf-mmax").value);
      state.hideSold = document.getElementById("mlf-sold").checked;
    }
    async function applyFromForm() {
      readForm();
      filterStore2.save();
      updatePanelMeta(getCards().length);
      if (filterStore2.getActiveFilterCount() && getCards().length < MIN_FILTER_CARS) {
        setStatus(`Loading ${MIN_FILTER_CARS} listings first…`, "loading");
        await autoLoader2.autoLoadCards(MIN_FILTER_CARS, true, true);
      }
      filterController2.applyFilter();
    }
    function hydrateForm() {
      const { state } = filterStore2;
      document.getElementById("mlf-q").value = state.query || "";
      document.getElementById("mlf-ymin").value = state.yearMin ?? "";
      document.getElementById("mlf-ymax").value = state.yearMax ?? "";
      document.getElementById("mlf-pmin").value = state.priceMin ?? "";
      document.getElementById("mlf-pmax").value = state.priceMax ?? "";
      document.getElementById("mlf-mmin").value = state.milesMin ?? "";
      document.getElementById("mlf-mmax").value = state.milesMax ?? "";
      document.getElementById("mlf-sold").checked = !!state.hideSold;
    }
    function buildPanel() {
      if (document.getElementById("mlf-panel")) return;
      const style = document.createElement("style");
      style.textContent = panel_default;
      document.head.appendChild(style);
      const panel2 = document.createElement("div");
      panel2.id = "mlf-panel";
      panel2.innerHTML = panel_default2;
      document.body.appendChild(panel2);
      document.getElementById("mlf-title").addEventListener("click", () => {
        panel2.classList.toggle("collapsed");
        const collapsed = panel2.classList.contains("collapsed");
        document.getElementById("mlf-toggle").textContent = collapsed ? "+" : "-";
        document.getElementById("mlf-title").setAttribute("aria-expanded", collapsed ? "false" : "true");
        document.getElementById("mlf-title").setAttribute(
          "aria-label",
          collapsed ? "Expand filter panel" : "Minimize filter panel"
        );
      });
      document.getElementById("mlf-sold").addEventListener("change", applyFromForm);
      hydrateForm();
      updatePanelMeta(getCards().length);
      setStatus("Load listings, then filter", "neutral");
      document.getElementById("mlf-apply").addEventListener("click", applyFromForm);
      document.getElementById("mlf-reset").addEventListener("click", () => {
        for (const id of INPUT_IDS) document.getElementById(id).value = "";
        document.getElementById("mlf-sold").checked = false;
        filterStore2.reset();
        filterController2.resetVisibleCards();
        updatePanelMeta(getCards().length);
        setStatus("Filters cleared", "neutral");
      });
      document.getElementById("mlf-load").addEventListener("click", () => {
        autoLoader2.autoLoadCards(Math.max(AUTO_LOAD_TARGET, MIN_FILTER_CARS), true, true);
      });
      panel2.querySelectorAll("input").forEach((input) => {
        input.addEventListener("keydown", async (event) => {
          if (event.key === "Enter") await applyFromForm();
        });
      });
    }
    return { applyFromForm, buildPanel, readForm };
  }

  // src/main.js
  var filterStore = createFilterStore();
  var navigationStore = createNavigationStore();
  var filterController;
  var mileageRegistry = createMileageRegistry({
    onRegistryChanged: () => {
      if (document.getElementById("mlf-panel")) filterController.applyFilterIfActive();
    }
  });
  var cardParser = createCardParser({ mileageRegistry });
  filterController = createFilterController({ filterStore, cardParser });
  var autoLoader = createAutoLoader();
  var panel = createPanel({ filterStore, filterController, autoLoader });
  var dataInterceptors = createDataInterceptors({
    ingestText: mileageRegistry.ingestText,
    ingestValue: mileageRegistry.ingestValue
  });
  var locationInterceptor = createLocationInterceptor({ navigationStore });
  var tabContinuity = createTabContinuity({
    navigationStore,
    getCards,
    getNativeFilterState
  });
  var historyWatcher = createHistoryWatcher({ autoLoadCards: autoLoader.autoLoadCards });
  var returnRestorer = createReturnRestorer({
    navigationStore,
    restoreNativeFilterState,
    waitForRestoredNativeFilters,
    autoLoadCards: autoLoader.autoLoadCards,
    filterStore,
    filterController
  });
  function boot() {
    log("booting on", location.href);
    attempt("buildPanel", panel.buildPanel);
    attempt("installNavigationInterceptor", locationInterceptor.install);
    attempt("finalizePendingNewTab", tabContinuity.finalizePendingNewTab);
    attempt("installNewTabHook", tabContinuity.installNewTabHook);
    attempt("watchUrlChanges", historyWatcher.install);
    if (isListingsPath(location.pathname)) {
      setTimeout(() => {
        attempt("restoreListingsPosition", returnRestorer.restoreListingsPosition);
      }, 1e3);
    }
  }
  if (document.readyState === "complete" || document.readyState === "interactive") {
    setTimeout(boot, 500);
  } else {
    window.addEventListener("DOMContentLoaded", () => setTimeout(boot, 500));
  }
  attempt("installDataInterceptors", dataInterceptors.install);
  attempt("loadMileageCache", mileageRegistry.loadCache);
})();
