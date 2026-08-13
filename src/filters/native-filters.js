import {
  isVisibleElement,
  log,
  normalizeText,
  waitFor,
  waitForQuietDom,
} from '../core/utils.js';

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
      const classes = Array.from(node.classList)
        .slice(0, 2)
        .map((className) => `.${CSS.escape(className)}`)
        .join('');
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
  return parts.join(' > ');
}

export function isBubbleDropdown(node) {
  return !!(node && node.classList && node.classList.contains('Dropdown'));
}

export function isMeaningfulNativeValue(value) {
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

export function getNativeFilterState() {
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

  const nodes = Array.from(document.querySelectorAll(
    'select, input:not([type="hidden"]), textarea, .bubble-element.Dropdown',
  ));
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

export function hasSpecificNativeFiltersSelected() {
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

function collectClickableTextNodes() {
  const candidates = [];
  for (const node of document.querySelectorAll('div, span, li, button, a')) {
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
  const exactMatch = candidates.find(
    (candidate) => normalizeText(candidate.innerText || candidate.textContent || '') === targetText,
  );
  const partialMatch = candidates.find(
    (candidate) => normalizeText(candidate.innerText || candidate.textContent || '').includes(targetText),
  );
  const option = exactMatch || partialMatch;
  if (!option) return;

  option.click();
  await waitForQuietDom();
}

export async function restoreNativeFilterState(saved) {
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
        if (!node || node.disabled) return false;
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

    if (item.tag === 'select' || item.tag === 'textarea' ||
        (item.tag === 'input' && item.type !== 'checkbox' && item.type !== 'radio')) {
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
    }
  }

  await waitForQuietDom();
}

export async function waitForRestoredNativeFilters(saved) {
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

