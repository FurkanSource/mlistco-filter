import { AUTO_LOAD_TARGET, CARD_SELECTOR } from '../config.js';
import { isVisibleElement, log, normalizeText, wait } from '../core/utils.js';
import { hasSpecificNativeFiltersSelected } from '../filters/native-filters.js';
import { getCards } from './cards.js';
import { setStatus, updatePanelMeta } from '../ui/status.js';

const MORE_RE = /^(show|load|view)\s+more\b|^more\s+(results|listings|cars)\b/i;

export function createAutoLoader({ windowObject = window, onCardsChanged = () => {} } = {}) {
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
        last.scrollIntoView({ block: 'end' });
      } catch (_) {}
    }
    if (container) container.scrollTop = container.scrollHeight;
    windowObject.scrollTo(0, document.documentElement.scrollHeight);
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
    const startY = windowObject.scrollY;
    let container = getCardScrollContainer();
    let startContainerY = container ? container.scrollTop : 0;
    let maxSeen = getCards().length;
    let stagnant = 0;
    const startedAt = Date.now();
    const maxMs = 60000;
    log('auto-load start', {
      cards: maxSeen,
      targetCount,
      container: container ? (container.className || container.tagName) : 'window',
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
        windowObject.scrollTo(0, startY);
        if (container) container.scrollTop = startContainerY;
      }
      const loaded = getCards().length;
      if (loaded >= targetCount) {
        setStatus(`${loaded} listings loaded`, 'success');
      } else {
        setStatus(`Stopped at ${loaded} listings — no more to load`, 'neutral');
      }
      updatePanelMeta(loaded);
      onCardsChanged();
    }
  }

  return {
    autoLoadCards,
    clickLoadMore,
    getCardScrollContainer,
    runAutoLoad,
  };
}
