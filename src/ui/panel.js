import panelCss from './panel.css';
import panelHtml from './panel.html';
import { AUTO_LOAD_TARGET } from '../config.js';
import { num } from '../core/utils.js';
import { getCards } from '../listings/cards.js';
import { setStatus, updatePanelMeta } from './status.js';

const INPUT_IDS = [
  'mlf-q',
  'mlf-ymin',
  'mlf-ymax',
  'mlf-pmin',
  'mlf-pmax',
  'mlf-mmin',
  'mlf-mmax',
];

export function createPanel({ filterStore, filterController, autoLoader }) {
  function readForm() {
    const { state } = filterStore;
    state.query = document.getElementById('mlf-q').value.trim();
    state.yearMin = num(document.getElementById('mlf-ymin').value);
    state.yearMax = num(document.getElementById('mlf-ymax').value);
    state.priceMin = num(document.getElementById('mlf-pmin').value);
    state.priceMax = num(document.getElementById('mlf-pmax').value);
    state.milesMin = num(document.getElementById('mlf-mmin').value);
    state.milesMax = num(document.getElementById('mlf-mmax').value);
    state.hideSold = document.getElementById('mlf-sold').checked;
  }

  async function applyFromForm() {
    readForm();
    filterStore.save();
    updatePanelMeta(getCards().length);
    filterController.applyFilter();
  }

  function getLoadTarget() {
    const requested = num(document.getElementById('mlf-load-count').value);
    return Math.max(1, Math.min(requested ?? AUTO_LOAD_TARGET, 9999));
  }

  function loadInventory() {
    return autoLoader.autoLoadCards(getLoadTarget(), true, true);
  }

  function hydrateForm() {
    const { state } = filterStore;
    document.getElementById('mlf-q').value = state.query || '';
    document.getElementById('mlf-ymin').value = state.yearMin ?? '';
    document.getElementById('mlf-ymax').value = state.yearMax ?? '';
    document.getElementById('mlf-pmin').value = state.priceMin ?? '';
    document.getElementById('mlf-pmax').value = state.priceMax ?? '';
    document.getElementById('mlf-mmin').value = state.milesMin ?? '';
    document.getElementById('mlf-mmax').value = state.milesMax ?? '';
    document.getElementById('mlf-sold').checked = !!state.hideSold;
  }

  function buildPanel() {
    if (document.getElementById('mlf-panel')) return;

    const style = document.createElement('style');
    style.textContent = panelCss;
    document.head.appendChild(style);

    const panel = document.createElement('div');
    panel.id = 'mlf-panel';
    panel.innerHTML = panelHtml;
    document.body.appendChild(panel);

    document.getElementById('mlf-title').addEventListener('click', () => {
      panel.classList.toggle('collapsed');
      const collapsed = panel.classList.contains('collapsed');
      document.getElementById('mlf-toggle').textContent = collapsed ? '+' : '-';
      document.getElementById('mlf-title').setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      document.getElementById('mlf-title').setAttribute(
        'aria-label',
        collapsed ? 'Expand filter panel' : 'Minimize filter panel',
      );
    });

    document.getElementById('mlf-sold').addEventListener('change', applyFromForm);

    hydrateForm();
    updatePanelMeta(getCards().length);
    setStatus('Ready to filter', 'neutral');

    document.getElementById('mlf-apply').addEventListener('click', applyFromForm);
    document.getElementById('mlf-reset').addEventListener('click', () => {
      for (const id of INPUT_IDS) document.getElementById(id).value = '';
      document.getElementById('mlf-sold').checked = false;
      filterStore.reset();
      filterController.resetVisibleCards();
      updatePanelMeta(getCards().length);
      setStatus('Filters cleared', 'neutral');
    });

    document.getElementById('mlf-load').addEventListener('click', loadInventory);

    document.getElementById('mlf-load-count').addEventListener('keydown', async (event) => {
      if (event.key === 'Enter') await loadInventory();
    });

    panel.querySelectorAll('input:not(#mlf-load-count)').forEach((input) => {
      input.addEventListener('keydown', async (event) => {
        if (event.key === 'Enter') await applyFromForm();
      });
    });
  }

  return { applyFromForm, buildPanel, getLoadTarget, loadInventory, readForm };
}
