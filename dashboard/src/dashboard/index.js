import { initRuntime, disposeRuntime, setTimeout } from './runtime.js';
import { AppState } from './state.js';
import { navigateToJobDetail } from './job-detail.js';
import { openReportDrawerForCandidate } from './report.js';
import { openJobFlowView } from './job-flow.js';
import { navigateToSourcing, removeCandidateFromQueue } from './sourcing.js';
import { initSpotlightShortcuts } from './spotlight.js';
import { initMountBindings } from './mount.js';
import * as IHApi from './api.js';

export function initDashboardPage() {
  initRuntime();

  window.AppState = AppState;
  window.IHApi = IHApi;
  window.navigateToJobDetail = navigateToJobDetail;
  window.openReportDrawerForCandidate = openReportDrawerForCandidate;
  window.openJobFlowView = openJobFlowView;
  window.navigateToSourcing = navigateToSourcing;
  window.removeCandidateFromQueue = removeCandidateFromQueue;

  initSpotlightShortcuts();
  // DOM is already hydrated; the original runtime ran mount bindings on the next tick
  setTimeout(initMountBindings, 0);

  return () => {
    disposeRuntime();

    delete window.navigateToJobDetail;
    delete window.openReportDrawerForCandidate;
    delete window.AppState;
    delete window.IHApi;
    delete window.openJobFlowView;
    delete window.openJobDescriptionDrawer;
    delete window.toggleJobKebab;
    delete window.handleJobKebab;
    delete window.navigateToSourcing;
    delete window.removeCandidateFromQueue;
  };
}
