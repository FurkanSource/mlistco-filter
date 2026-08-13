import { log, settleScroll } from '../core/utils.js';

export function createReturnRestorer({
  navigationStore,
  restoreNativeFilterState,
  waitForRestoredNativeFilters,
  autoLoadCards,
  filterStore,
  filterController,
}) {
  async function restoreListingsPosition() {
    const saved = navigationStore.loadReturnState();
    if (!saved) {
      log('no return state found');
      return false;
    }
    if (!saved.createdAt || Date.now() - saved.createdAt > 30000) {
      log('return state expired', saved);
      navigationStore.clearReturnState();
      return false;
    }

    log('restoring listings position', saved);
    navigationStore.clearReturnState();
    await restoreNativeFilterState(saved.nativeFilters);
    await waitForRestoredNativeFilters(saved.nativeFilters);
    await autoLoadCards(Math.max(saved.cardCount || 0, 13), false, true);
    if (filterStore.hasAnyFilter()) filterController.applyFilter();
    await settleScroll(Math.max(saved.scrollY || 0, 0));
    return true;
  }

  return { restoreListingsPosition };
}

