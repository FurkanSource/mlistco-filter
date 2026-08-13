export const STORAGE_KEY = 'mlf_state_v2';
export const NEW_TAB_KEY = 'mlf_new_tab_pending_v1';
export const RETURN_KEY = 'mlf_return_state_v1';
export const MILEAGE_CACHE_KEY = 'mlf_mileage_v2';

export const DEFAULT_STATE = {
  query: '',
  yearMin: null,
  yearMax: null,
  priceMin: null,
  priceMax: null,
  milesMin: null,
  milesMax: null,
  hideSold: false,
};

export const CARD_SELECTOR = '.bubble-element.group-item';
export const AUTO_LOAD_TARGET = 200;
export const MAX_BODY_BYTES = 5000000;
export const MAX_INFLIGHT_READS = 4;
