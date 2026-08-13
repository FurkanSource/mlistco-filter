import { createFilterStore } from './filters/filter-store.js';
import {
  getNativeFilterState,
  restoreNativeFilterState,
  waitForRestoredNativeFilters,
} from './filters/native-filters.js';
import { createCardParser } from './listings/card-parser.js';
import { getCards } from './listings/cards.js';
import { createFilterController } from './listings/filter-controller.js';
import { createAutoLoader } from './listings/auto-loader.js';
import { createMileageRegistry } from './mileage/registry.js';
import { createDataInterceptors } from './mileage/interceptors.js';
import { createNavigationStore } from './navigation/session-store.js';
import { createLocationInterceptor } from './navigation/location-interceptor.js';
import { createTabContinuity } from './navigation/tab-continuity.js';
import { createHistoryWatcher } from './navigation/history-watcher.js';
import { createReturnRestorer } from './navigation/return-restorer.js';
import { createPanel } from './ui/panel.js';
import { attempt, isListingsPath, log } from './core/utils.js';

const filterStore = createFilterStore();
const navigationStore = createNavigationStore();

let filterController;
const mileageRegistry = createMileageRegistry({
  onRegistryChanged: () => {
    if (document.getElementById('mlf-panel')) filterController.applyFilterIfActive();
  },
});

const cardParser = createCardParser({ mileageRegistry });
filterController = createFilterController({ filterStore, cardParser });

const autoLoader = createAutoLoader();
const panel = createPanel({ filterStore, filterController, autoLoader });
const dataInterceptors = createDataInterceptors({
  ingestText: mileageRegistry.ingestText,
  ingestValue: mileageRegistry.ingestValue,
});
const locationInterceptor = createLocationInterceptor({ navigationStore });
const tabContinuity = createTabContinuity({
  navigationStore,
  getCards,
  getNativeFilterState,
});
const historyWatcher = createHistoryWatcher({ autoLoadCards: autoLoader.autoLoadCards });
const returnRestorer = createReturnRestorer({
  navigationStore,
  restoreNativeFilterState,
  waitForRestoredNativeFilters,
  autoLoadCards: autoLoader.autoLoadCards,
  filterStore,
  filterController,
});

function boot() {
  log('booting on', location.href);
  attempt('buildPanel', panel.buildPanel);
  attempt('installNavigationInterceptor', locationInterceptor.install);
  attempt('finalizePendingNewTab', tabContinuity.finalizePendingNewTab);
  attempt('installNewTabHook', tabContinuity.installNewTabHook);
  attempt('watchUrlChanges', historyWatcher.install);
  if (isListingsPath(location.pathname)) {
    setTimeout(() => {
      attempt('restoreListingsPosition', returnRestorer.restoreListingsPosition);
    }, 1000);
  }
}

if (document.readyState === 'complete' || document.readyState === 'interactive') {
  setTimeout(boot, 500);
} else {
  window.addEventListener('DOMContentLoaded', () => setTimeout(boot, 500));
}

attempt('installDataInterceptors', dataInterceptors.install);
attempt('loadMileageCache', mileageRegistry.loadCache);

