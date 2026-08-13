import { log } from '../core/utils.js';
import { MILEAGE_CACHE_KEY } from '../config.js';

const MILEAGE_HINT_RE = /mile|milage|odom|kilomet/i;
const MILEAGE_KEY_RE = /(mile|milage|odom|kilomet|^kms?$)/i;
const KM_KEY_RE = /(kilomet|^kms?$)/i;
const PRICE_KEY_RE = /(price|asking|cost)/i;
const YEAR_KEY_RE = /(^year$|model.?year|^yr$)/i;
const ID_KEY_RE = /^(_id|id|unique ?id)$/i;
const KM_TO_MILES = 0.621371;
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

export function createMileageRegistry({
  storage,
  logger = log,
  onRegistryChanged = () => {},
} = {}) {
  const getStorage = () => storage === undefined ? globalThis.localStorage : storage;
  const mileageById = new Map();
  const mileageBySignature = new Map();
  const mileageByOrder = [];
  const seenRecordIds = new Set();
  const seenMileageFields = new Set();
  let registryVersion = 0;

  function extractRecord(object) {
    let miles = null;
    let milesKey = null;
    let id = null;
    let price = null;
    let year = null;

    for (const key of Object.keys(object)) {
      const value = object[key];
      if (value && typeof value === 'object') continue;
      if (miles === null && MILEAGE_KEY_RE.test(key)) {
        const parsed = numericValue(value);
        if (parsed !== null && parsed >= 0 && parsed < 2000000) {
          miles = KM_KEY_RE.test(key) ? Math.round(parsed * KM_TO_MILES) : Math.round(parsed);
          milesKey = key;
        }
      }
      if (id === null && ID_KEY_RE.test(key) && typeof value === 'string') id = value;
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
      logger('mileage field discovered in network data:', milesKey, '=', miles);
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
      if (existing !== undefined && existing !== record.miles) {
        mileageBySignature.set(signature, AMBIGUOUS);
      } else if (existing === undefined) {
        mileageBySignature.set(signature, record.miles);
      }
    }
    return true;
  }

  function harvestJson(root) {
    let added = 0;
    let nodes = 0;
    const stack = [[root, 0]];
    while (stack.length && nodes < 40000) {
      const [node, depth] = stack.pop();
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
    saveCache();
    logger('mileage records captured:', added, 'total:', mileageByOrder.length);
    onRegistryChanged();
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

  function loadCache() {
    try {
      const raw = getStorage().getItem(MILEAGE_CACHE_KEY);
      if (!raw) return;
      const list = JSON.parse(raw);
      if (!Array.isArray(list)) return;
      for (const item of list) {
        if (!item || typeof item !== 'object') continue;
        const miles = Number(item.m);
        if (!Number.isFinite(miles)) continue;
        if (item.i) mileageById.set(String(item.i), miles);
        const signature = signatureOf(item.p ?? null, item.y ?? null);
        if (signature && !mileageBySignature.has(signature)) mileageBySignature.set(signature, miles);
      }
      registryVersion++;
      logger('mileage cache loaded:', mileageById.size, 'by id,', mileageBySignature.size, 'by signature');
    } catch (_) {}
  }

  function saveCache() {
    try {
      const list = [];
      for (const [signature, miles] of mileageBySignature) {
        if (miles === AMBIGUOUS || list.length >= 3000) continue;
        const [price, year] = signature.split('|');
        list.push({ p: Number(price), y: Number(year), m: miles });
      }
      getStorage().setItem(MILEAGE_CACHE_KEY, JSON.stringify(list));
    } catch (_) {}
  }

  function lookupMiles(parsed, index) {
    const signature = signatureOf(parsed.price, parsed.year);
    if (signature) {
      const hit = mileageBySignature.get(signature);
      if (hit !== undefined && hit !== AMBIGUOUS) return hit;
    }
    if (typeof index === 'number' && index >= 0 && index < mileageByOrder.length) {
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
    saveCache,
  };
}
