import { initRuntime, disposeRuntime, setTimeout } from './runtime';
import { AppState } from './state';
import { navigateToJobDetail, navigateToJobStage } from './job-detail';
import { openReportDrawerForCandidate } from './report';
import { openJobFlowView } from './job-flow';
import { navigateToSourcing, removeCandidateFromQueue } from './sourcing';
import { initSpotlightShortcuts } from './spotlight';
import { initMountBindings } from './mount';
import { initUrlSync } from './url-sync';
import { navigateToTab, navigateToSubtab } from './navigation';
import * as IHApi from './api';

export function initDashboardPage() {
  initRuntime();

  window.AppState = AppState;
  window.IHApi = IHApi;
  window.navigateToTab = navigateToTab;
  window.navigateToSubtab = navigateToSubtab;
  window.navigateToJobDetail = navigateToJobDetail;
  window.navigateToJobStage = navigateToJobStage;
  window.openReportDrawerForCandidate = openReportDrawerForCandidate;
  window.openJobFlowView = openJobFlowView;
  window.navigateToSourcing = navigateToSourcing;
  window.removeCandidateFromQueue = removeCandidateFromQueue;

  initSpotlightShortcuts();
  // DOM is already hydrated; the original runtime ran mount bindings on the next tick.
  // initUrlSync runs after initMountBindings so it can patch the window globals that
  // mount.js/index.js expose and intercept sidebar clicks already bound by mount.js.
  setTimeout(initMountBindings, 0);
  setTimeout(initUrlSync, 10);

  return () => {
    disposeRuntime();

    const w = window as any;
    delete w.navigateToTab;
    delete w.navigateToSubtab;
    delete w.navigateToJobDetail;
    delete w.navigateToJobStage;
    delete w.openReportDrawerForCandidate;
    delete w.AppState;
    delete w.IHApi;
    delete w.openJobFlowView;
    delete w.openJobDescriptionDrawer;
    delete w.toggleJobKebab;
    delete w.handleJobKebab;
    delete w.navigateToSourcing;
    delete w.removeCandidateFromQueue;
  };
}
