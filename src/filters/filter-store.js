import { DEFAULT_STATE, STORAGE_KEY } from '../config.js';

const NUMERIC_FILTERS = [
  'yearMin',
  'yearMax',
  'priceMin',
  'priceMax',
  'milesMin',
  'milesMax',
];

export function sanitizeState(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const clean = {};
  if (typeof raw.query === 'string') clean.query = raw.query;
  for (const key of NUMERIC_FILTERS) {
    const value = Number(raw[key]);
    if (Number.isFinite(value)) clean[key] = Math.round(value);
  }
  clean.hideSold = !!raw.hideSold;
  return clean;
}

export function hasAnyFilter(state) {
  return !!(
    state.query ||
    state.yearMin ||
    state.yearMax ||
    state.priceMin ||
    state.priceMax ||
    state.milesMin ||
    state.milesMax ||
    state.hideSold
  );
}

export function getActiveFilterCount(state) {
  let count = 0;
  if (state.query) count++;
  if (state.yearMin != null || state.yearMax != null) count++;
  if (state.priceMin != null || state.priceMax != null) count++;
  if (state.milesMin != null || state.milesMax != null) count++;
  if (state.hideSold) count++;
  return count;
}

export function createFilterStore({
  storage,
  storageKey = STORAGE_KEY,
  initialState,
} = {}) {
  const getStorage = () => storage === undefined ? globalThis.localStorage : storage;

  const load = () => {
    if (initialState !== undefined) return sanitizeState(initialState);
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
    } catch (_) {}
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
    getActiveFilterCount: () => getActiveFilterCount(state),
  };
}
