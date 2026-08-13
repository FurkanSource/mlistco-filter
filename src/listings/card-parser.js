const PRICE_RE = /\$\s*([\d,]+(?:\.\d+)?)(k|m)?(?![a-z])/i;
const YEAR_RE = /(?<!\$)\b(19\d{2}|20[0-4]\d)\b/;
const MILES_RE = /([\d,]+(?:\.\d+)?)\s*(k)?\s*(mi\b|miles\b|km\b|kilometers\b)/gi;
const MILES_LABEL_RE = /(?:miles|mileage|odometer)\s*:?\s*([\d,]+(?:\.\d+)?)[ \t]*(k)?\b/i;
const KM_TO_MILES = 0.621371;

export function parsePrice(text) {
  const match = text.match(PRICE_RE);
  if (!match) return null;
  const value = parseFloat(match[1].replace(/,/g, ''));
  if (!Number.isFinite(value)) return null;
  const suffix = (match[2] || '').toLowerCase();
  if (suffix === 'k') return Math.round(value * 1000);
  if (suffix === 'm') return Math.round(value * 1000000);
  return Math.round(value);
}

function precededByDollar(text, index) {
  let cursor = index - 1;
  while (cursor >= 0 && /\s/.test(text[cursor])) cursor--;
  return cursor >= 0 && text[cursor] === '$';
}

export function parseMiles(text) {
  let number = null;
  let thousands = null;
  let unit = 'mi';

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

  const value = parseFloat(String(number).replace(/,/g, ''));
  if (!Number.isFinite(value)) return null;
  const scaled = thousands ? value * 1000 : value;
  const isKilometers = /^k(m|ilometers)/i.test(unit);
  return Math.round(isKilometers ? scaled * KM_TO_MILES : scaled);
}

export function parseCard(card) {
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

export function matches(parsed, state) {
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

export function createCardParser({ mileageRegistry } = {}) {
  const parseCache = new WeakMap();
  const registry = mileageRegistry || {
    getVersion: () => 0,
    lookupMiles: () => null,
  };

  const parseCardCached = (card, index) => {
    const key = `${card.textContent || ''}\0${registry.getVersion()}`;
    const cached = parseCache.get(card);
    if (cached && cached.key === key) return cached.parsed;

    const parsed = parseCard(card);
    if (parsed.miles === null) {
      const found = registry.lookupMiles(parsed, index);
      if (found !== null && found !== undefined) parsed.miles = found;
    }
    parseCache.set(card, { key, parsed });
    return parsed;
  };

  return { parseCard, parseCardCached };
}
