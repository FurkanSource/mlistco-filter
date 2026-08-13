export function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function normalizeText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

export function log(...args) {
  console.log('[MListFilter]', ...args);
}

export function isVisibleElement(node, windowObject = globalThis.window) {
  if (!node || !node.isConnected) return false;
  const style = windowObject.getComputedStyle(node);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
  const rect = node.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

export function isListingsPath(pathname) {
  return /\/listings?\/?$/.test(pathname || '');
}

export function isClassifiedPath(pathname) {
  return /\/classified\//.test(pathname || '');
}

export function resolveUrl(rawUrl, baseUrl = globalThis.location && globalThis.location.href) {
  try {
    return new URL(String(rawUrl), baseUrl);
  } catch (_) {
    return null;
  }
}

export async function waitFor(condition, timeoutMs = 6000, intervalMs = 100, waitFn = wait) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (condition()) return true;
    await waitFn(intervalMs);
  }
  return false;
}

export function waitForQuietDom(
  quietMs = 400,
  timeoutMs = 6000,
  {
    documentObject = globalThis.document,
    MutationObserverClass = globalThis.MutationObserver,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
  } = {},
) {
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
        return !el || !el.closest('#mlf-panel');
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
      characterData: true,
    });
    quietTimer = setTimeoutFn(finish, quietMs);
  });
}

export async function settleScroll(
  targetY,
  attempts = 12,
  intervalMs = 120,
  {
    documentObject = globalThis.document,
    windowObject = globalThis.window,
    waitFn = wait,
    logger = log,
  } = {},
) {
  for (let i = 0; i < attempts; i++) {
    const maxY = Math.max(0, documentObject.documentElement.scrollHeight - windowObject.innerHeight);
    const y = Math.min(Math.max(targetY, 0), maxY);
    windowObject.scrollTo(0, y);
    await waitFn(intervalMs);
    if (Math.abs(windowObject.scrollY - y) < 4) {
      await waitFn(intervalMs);
      if (Math.abs(windowObject.scrollY - y) < 4) {
        logger('scroll settled', { target: targetY, landed: windowObject.scrollY, attempts: i + 1 });
        return true;
      }
    }
  }
  logger('scroll failed to settle', { target: targetY, landed: windowObject.scrollY });
  return false;
}

export function attempt(label, fn, warn = (...args) => console.warn(...args)) {
  try {
    fn();
  } catch (error) {
    warn(`[MListFilter] ${label} failed`, error);
  }
}

export function num(value) {
  if (value === '' || value == null) return null;
  const parsed = parseInt(String(value).replace(/[^\d]/g, ''), 10);
  return Number.isFinite(parsed) ? parsed : null;
}
