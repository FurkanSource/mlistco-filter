import { log, normalizeText } from '../core/utils.js';
import { MILEAGE_CACHE_KEY } from '../config.js';

const MILEAGE_HINT_RE = /mile|milage|odom|kilomet/i;
const MILEAGE_KEY_RE = /(mile|milage|odom|kilomet|^kms?$)/i;
const KM_KEY_RE = /(kilomet|^kms?$)/i;
const PRICE_KEY_RE = /(price|asking|cost)/i;
const YEAR_KEY_RE = /(^year$|model.?year|^yr$)/i;
const ID_KEY_RE = /^(_id|id|unique ?id)$/i;
const TITLE_KEY_RE = /^(title(?:_text)?|vehicle.?title(?:_text)?|listing.?title(?:_text)?)$/i;
const LOCATION_KEY_RE = /(seller.?location|^location$|city)/i;
const SLUG_KEY_RE = /^slug$/i;
const IMAGE_KEY_RE = /(all.?images|image|photo|picture)/i;
const BUBBLE_ASSET_RE = /(?:^|\/)(f\d{10,}x\d{10,})(?=\/|%2f|$)/ig;
const YEAR_RE = /\b(19\d{2}|20[0-4]\d)\b/;
const KM_TO_MILES = 0.621371;
const CACHE_SCHEMA_VERSION = 2;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_CACHE_RECORDS = 3000;
const AMBIGUOUS = Symbol('ambiguous');

export function signatureOf(price, year) {
  if (price === null || price === undefined || year === null || year === undefined) return null;
  return `${price}|${year}`;
}

export function numericValue(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const parsed = parseFloat(value.replace(/[^\d.]/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function normalizeIdentityText(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function extractBubbleAssetTokens(value) {
  const tokens = new Set();
  const text = String(value || '');
  BUBBLE_ASSET_RE.lastIndex = 0;
  let match;
  while ((match = BUBBLE_ASSET_RE.exec(text)) !== null) tokens.add(match[1].toLowerCase());
  return Array.from(tokens);
}

export function extractBubbleAssetToken(value) {
  return extractBubbleAssetTokens(value)[0] || null;
}

function firstScalar(value) {
  if (Array.isArray(value)) return value.length ? firstScalar(value[0]) : null;
  return value !== null && value !== undefined && typeof value !== 'object' ? value : null;
}

function firstMatchingValue(object, keyPattern) {
  for (const key of Object.keys(object || {})) {
    if (!keyPattern.test(key)) continue;
    const value = firstScalar(object[key]);
    if (value !== null) return { key, value };
  }
  return { key: null, value: null };
}

function firstImageToken(object) {
  for (const key of Object.keys(object || {})) {
    if (!IMAGE_KEY_RE.test(key)) continue;
    const values = Array.isArray(object[key]) ? object[key] : [object[key]];
    for (const value of values) {
      const token = extractBubbleAssetToken(value);
      if (token) return token;
    }
  }
  return null;
}

function createRecord(object, inheritedId = null) {
  if (!object || typeof object !== 'object' || Array.isArray(object)) return null;

  const mileageField = firstMatchingValue(object, MILEAGE_KEY_RE);
  const parsedMileage = numericValue(mileageField.value);
  if (parsedMileage === null || parsedMileage < 0 || parsedMileage >= 2000000) return null;

  const idField = firstMatchingValue(object, ID_KEY_RE);
  const slugField = firstMatchingValue(object, SLUG_KEY_RE);
  const titleField = firstMatchingValue(object, TITLE_KEY_RE);
  const priceField = firstMatchingValue(object, PRICE_KEY_RE);
  const locationField = firstMatchingValue(object, LOCATION_KEY_RE);
  const yearField = firstMatchingValue(object, YEAR_KEY_RE);
  const title = String(titleField.value || '');
  const titleYear = title.match(YEAR_RE);
  const explicitYear = numericValue(yearField.value);
  const year = explicitYear && explicitYear > 1900 && explicitYear < 2050
    ? Math.round(explicitYear)
    : titleYear ? Number(titleYear[1]) : null;
  const priceValue = numericValue(priceField.value);
  const id = idField.value ?? inheritedId;

  return {
    id: id === null || id === undefined ? null : String(id),
    slug: slugField.value === null ? null : String(slugField.value),
    miles: KM_KEY_RE.test(mileageField.key || '')
      ? Math.round(parsedMileage * KM_TO_MILES)
      : Math.round(parsedMileage),
    title,
    titleKey: normalizeIdentityText(title),
    price: priceValue !== null && priceValue > 0 ? Math.round(priceValue) : null,
    year,
    location: String(locationField.value || ''),
    locationKey: normalizeIdentityText(locationField.value || ''),
    asset: firstImageToken(object),
  };
}

function stableRecordKey(record) {
  if (record.id) return `id:${record.id}`;
  if (record.slug) return `slug:${record.slug}`;
  if (record.asset) return `asset:${record.asset}`;
  if (record.titleKey && record.price !== null && record.locationKey) {
    return `text:${record.titleKey}|${record.price}|${record.locationKey}`;
  }
  return null;
}

function recordsEqual(left, right) {
  return left.id === right.id &&
    left.slug === right.slug &&
    left.miles === right.miles &&
    left.title === right.title &&
    left.price === right.price &&
    left.year === right.year &&
    left.location === right.location &&
    left.asset === right.asset;
}

function recordDataScore(record) {
  return [record.id, record.slug, record.title, record.price, record.year, record.location, record.asset]
    .filter((value) => value !== null && value !== undefined && value !== '').length;
}

function mergeRecord(existing, incoming) {
  const existingUpdatedAt = Number(existing.updatedAt) || 0;
  const incomingUpdatedAt = Number(incoming.updatedAt) || 0;
  const incomingIsNewer = incomingUpdatedAt > existingUpdatedAt || (
    incomingUpdatedAt === existingUpdatedAt && recordDataScore(incoming) >= recordDataScore(existing)
  );
  const primary = incomingIsNewer ? incoming : existing;
  const secondary = primary === incoming ? existing : incoming;
  const record = {
    id: primary.id || secondary.id,
    slug: primary.slug || secondary.slug,
    miles: primary.miles,
    title: primary.title || secondary.title,
    price: primary.price ?? secondary.price,
    year: primary.year ?? secondary.year,
    location: primary.location || secondary.location,
    asset: primary.asset || secondary.asset,
    updatedAt: Math.max(existingUpdatedAt, incomingUpdatedAt),
  };
  record.titleKey = normalizeIdentityText(record.title);
  record.locationKey = normalizeIdentityText(record.location);
  return record;
}

function serializeRecord(record) {
  return {
    i: record.id,
    s: record.slug,
    m: record.miles,
    t: record.title,
    p: record.price,
    y: record.year,
    l: record.location,
    a: record.asset,
    u: record.updatedAt,
  };
}

function deserializeRecord(value, fallbackUpdatedAt) {
  if (!value || typeof value !== 'object') return null;
  const miles = Number(value.m);
  if (!Number.isFinite(miles) || miles < 0 || miles >= 2000000) return null;
  const record = {
    id: value.i == null ? null : String(value.i),
    slug: value.s == null ? null : String(value.s),
    miles: Math.round(miles),
    title: typeof value.t === 'string' ? value.t : '',
    price: value.p != null && Number.isFinite(Number(value.p)) ? Number(value.p) : null,
    year: value.y != null && Number.isFinite(Number(value.y)) ? Number(value.y) : null,
    location: typeof value.l === 'string' ? value.l : '',
    asset: typeof value.a === 'string' ? value.a : null,
    updatedAt: value.u != null && Number.isFinite(Number(value.u)) ? Number(value.u) : fallbackUpdatedAt,
  };
  record.titleKey = normalizeIdentityText(record.title);
  record.locationKey = normalizeIdentityText(record.location);
  return stableRecordKey(record) ? record : null;
}

function collectCardAssetTokens(card) {
  const tokens = new Set(extractBubbleAssetTokens(card && card.outerHTML));
  if (!card || typeof card.querySelectorAll !== 'function') return Array.from(tokens);
  for (const node of card.querySelectorAll('img, source, [style], [data-src], [data-original]')) {
    const values = [
      node.currentSrc,
      node.src,
      node.srcset,
      node.getAttribute && node.getAttribute('src'),
      node.getAttribute && node.getAttribute('srcset'),
      node.getAttribute && node.getAttribute('data-src'),
      node.getAttribute && node.getAttribute('data-original'),
      node.getAttribute && node.getAttribute('style'),
    ];
    for (const value of values) {
      for (const token of extractBubbleAssetTokens(value)) tokens.add(token);
    }
  }
  return Array.from(tokens);
}

function collectCardSlugs(card) {
  const slugs = new Set();
  if (!card || typeof card.querySelectorAll !== 'function') return slugs;
  for (const link of card.querySelectorAll('a[href]')) {
    const href = link.getAttribute('href') || '';
    const match = href.match(/\/classified\/([^/?#]+)/i);
    if (match) {
      try {
        slugs.add(decodeURIComponent(match[1]));
      } catch (_) {
        slugs.add(match[1]);
      }
    }
  }
  return slugs;
}

export function createMileageRegistry({
  storage,
  logger = log,
  onRegistryChanged = () => {},
  now = Date.now,
} = {}) {
  const getStorage = () => storage === undefined ? globalThis.localStorage : storage;
  const records = new Map();
  let byId = new Map();
  let bySlug = new Map();
  let byAsset = new Map();
  let byPrice = new Map();
  let registryVersion = 0;
  let storageSyncInstalled = false;

  function indexUnique(index, key, record) {
    if (!key) return;
    const existing = index.get(key);
    if (existing === undefined) index.set(key, record);
    else if (existing !== AMBIGUOUS && stableRecordKey(existing) !== stableRecordKey(record)) {
      index.set(key, AMBIGUOUS);
    }
  }

  function rebuildIndexes() {
    byId = new Map();
    bySlug = new Map();
    byAsset = new Map();
    byPrice = new Map();
    for (const record of records.values()) {
      indexUnique(byId, record.id, record);
      indexUnique(bySlug, record.slug, record);
      indexUnique(byAsset, record.asset, record);
      if (record.price !== null) {
        if (!byPrice.has(record.price)) byPrice.set(record.price, []);
        byPrice.get(record.price).push(record);
      }
    }
  }

  function mergeRecords(incoming) {
    let changed = 0;
    let refreshed = 0;
    for (const nextRecord of incoming) {
      let key = stableRecordKey(nextRecord);
      if (!key) continue;

      let existing = records.get(key);
      let existingKey = existing ? key : null;
      if (!existing) {
        const aliases = new Map();
        const addAlias = (candidate) => {
          if (candidate && candidate !== AMBIGUOUS) aliases.set(stableRecordKey(candidate), candidate);
        };
        if (nextRecord.id) addAlias(byId.get(nextRecord.id));
        if (nextRecord.slug) addAlias(bySlug.get(nextRecord.slug));
        if (nextRecord.asset) addAlias(byAsset.get(nextRecord.asset));
        if (aliases.size === 1) {
          [existingKey, existing] = aliases.entries().next().value;
        }
      }

      const record = existing ? mergeRecord(existing, nextRecord) : nextRecord;
      key = stableRecordKey(record);
      if (existing && existingKey === key && recordsEqual(existing, record)) {
        if (record.updatedAt !== existing.updatedAt) {
          records.set(key, record);
          refreshed++;
        }
        continue;
      }
      if (existingKey && existingKey !== key) records.delete(existingKey);
      records.set(key, record);
      changed++;
      rebuildIndexes();
    }
    return { changed, refreshed };
  }

  function extractRecords(root) {
    const found = [];
    const visited = new Set();
    const stack = [[root, 0, null]];
    let nodes = 0;

    while (stack.length && nodes < 40000) {
      const [node, depth, inheritedId] = stack.pop();
      nodes++;
      if (!node || typeof node !== 'object' || depth > 14 || visited.has(node)) continue;
      visited.add(node);

      if (Array.isArray(node)) {
        for (let index = node.length - 1; index >= 0; index--) {
          stack.push([node[index], depth + 1, inheritedId]);
        }
        continue;
      }

      const source = node._source && typeof node._source === 'object' ? node._source : null;
      if (source) {
        const record = createRecord(source, node._id ?? source._id ?? inheritedId);
        if (record) found.push(record);
      } else {
        const record = createRecord(node, inheritedId);
        if (record) found.push(record);
      }

      const entries = Object.entries(node);
      for (let index = entries.length - 1; index >= 0; index--) {
        const [key, value] = entries[index];
        if (source && key === '_source') continue;
        if (value && typeof value === 'object') {
          stack.push([value, depth + 1, node._id ?? inheritedId]);
        } else if (typeof value === 'string' && value.length > 20 && MILEAGE_HINT_RE.test(value)) {
          const head = value.slice(0, 40).trim();
          if (head.startsWith('{') || head.startsWith('[')) {
            try {
              stack.push([JSON.parse(value), depth + 1, inheritedId]);
            } catch (_) {}
          }
        }
      }
    }
    return found;
  }

  function saveCache() {
    try {
      const payload = {
        version: CACHE_SCHEMA_VERSION,
        savedAt: now(),
        records: Array.from(records.values()).slice(-MAX_CACHE_RECORDS).map(serializeRecord),
      };
      getStorage().setItem(MILEAGE_CACHE_KEY, JSON.stringify(payload));
    } catch (_) {}
  }

  function parseCache(raw) {
    if (!raw) return [];
    const payload = JSON.parse(raw);
    if (!payload || payload.version !== CACHE_SCHEMA_VERSION || !Array.isArray(payload.records)) return [];
    if (!Number.isFinite(payload.savedAt) || now() - payload.savedAt > CACHE_TTL_MS) return [];
    return payload.records
      .map((record) => deserializeRecord(record, payload.savedAt))
      .filter(Boolean);
  }

  function mergeCache(raw, notify = false) {
    try {
      const { changed } = mergeRecords(parseCache(raw));
      if (!changed) return 0;
      registryVersion++;
      logger('mileage cache merged:', changed, 'records');
      if (notify) onRegistryChanged();
      return changed;
    } catch (_) {
      return 0;
    }
  }

  function loadCache() {
    try {
      mergeCache(getStorage().getItem(MILEAGE_CACHE_KEY), false);
    } catch (_) {}
  }

  function ingestValue(value, sourceUrl = '') {
    if (!value || typeof value !== 'object') return 0;
    const observedAt = now();
    const incoming = extractRecords(value).map((record) => ({ ...record, updatedAt: observedAt }));
    const { changed, refreshed } = mergeRecords(incoming);
    if (!changed && !refreshed) return 0;
    saveCache();
    if (!changed) return 0;
    registryVersion++;
    logger('mileage records captured:', changed, 'total:', records.size, 'from:', sourceUrl || 'unknown');
    onRegistryChanged();
    return changed;
  }

  function ingestText(text, sourceUrl = '') {
    if (typeof text !== 'string' || !text || text.length > 5000000) return 0;
    const head = text.slice(0, 200).trim();
    if (!head.startsWith('{') && !head.startsWith('[')) return 0;
    if (!MILEAGE_HINT_RE.test(text)) return 0;
    try {
      return ingestValue(JSON.parse(text), sourceUrl);
    } catch (_) {
      return 0;
    }
  }

  function resolveStrongIdentity(card) {
    const candidates = new Map();
    let ambiguous = false;
    const addCandidate = (record) => {
      if (record === AMBIGUOUS) {
        ambiguous = true;
        return;
      }
      if (record) candidates.set(stableRecordKey(record), record);
    };

    for (const slug of collectCardSlugs(card)) addCandidate(bySlug.get(slug));
    for (const asset of collectCardAssetTokens(card)) addCandidate(byAsset.get(asset));
    if (ambiguous || candidates.size !== 1) return candidates.size > 1 || ambiguous ? AMBIGUOUS : null;
    return candidates.values().next().value;
  }

  function resolveTextIdentity(card, parsed) {
    if (!card || parsed.price === null || parsed.price === undefined) return null;
    const identityTexts = new Set();
    for (const node of card.querySelectorAll('*')) {
      const text = normalizeIdentityText(node.innerText || node.textContent || '');
      if (text) identityTexts.add(text);
    }
    const candidates = (byPrice.get(parsed.price) || []).filter((record) =>
      record.titleKey && record.locationKey &&
      identityTexts.has(record.titleKey) && identityTexts.has(record.locationKey)
    );
    return candidates.length === 1 ? candidates[0] : null;
  }

  function lookupMiles(cardOrParsed, maybeParsed) {
    const hasDomCard = cardOrParsed && typeof cardOrParsed.querySelectorAll === 'function';
    const card = hasDomCard ? cardOrParsed : null;
    const parsed = hasDomCard ? maybeParsed : cardOrParsed;
    if (!parsed) return null;

    const strong = card ? resolveStrongIdentity(card) : null;
    if (strong === AMBIGUOUS) return null;
    if (strong) return strong.miles;

    const textMatch = card ? resolveTextIdentity(card, parsed) : null;
    return textMatch ? textMatch.miles : null;
  }

  function installStorageSync(windowObject = globalThis.window) {
    if (storageSyncInstalled || !windowObject || typeof windowObject.addEventListener !== 'function') return;
    storageSyncInstalled = true;
    windowObject.addEventListener('storage', (event) => {
      if (event.key !== MILEAGE_CACHE_KEY || !event.newValue) return;
      mergeCache(event.newValue, true);
    });
  }

  function getStats() {
    let ambiguousAssets = 0;
    for (const value of byAsset.values()) if (value === AMBIGUOUS) ambiguousAssets++;
    return {
      records: records.size,
      assets: Array.from(byAsset.values()).filter((value) => value !== AMBIGUOUS).length,
      ambiguousAssets,
    };
  }

  return {
    getStats,
    getVersion: () => registryVersion,
    harvestJson: (value) => ingestValue(value),
    ingestText,
    ingestValue,
    installStorageSync,
    loadCache,
    lookupMiles,
    saveCache,
  };
}
