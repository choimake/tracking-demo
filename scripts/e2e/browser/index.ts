export {
  deleteTdCookies,
  readDocumentCookie,
  setRawTdCookie,
  setTdCookie,
} from "./cookie.js";
export {
  disposeRequestProbes,
  forceSendBeaconFalse,
  inspectFailureQueue,
  installCollectHttp500,
  installConfigHttp500,
  installEmptyConfig,
  installTrackerScriptHttp404,
  observeCollectRequests,
  observeConfigRequests,
  observePageErrors,
  preloadFailureQueueSentinel,
} from "./failure-injection.js";
export type { PageErrorProbe, RequestProbe } from "./failure-injection.js";
export {
  changeLocationHash,
  changeQueryOnly,
  getNoReloadMarker,
  goBackTwice,
  goForwardTwice,
  setNoReloadMarker,
  spaPushState,
  spaReplaceState,
  spaReplaceStateSamePath,
} from "./history.js";
export {
  clickAddToCart,
  clickAddToCartChild,
  clickManualPageview,
  clickSpaOrderComplete,
  gotoDemoPageWithPreloadedDataLayerQueue,
  pushTdDataLayerPageview,
  runExitIntentMobileAct,
  scrollToBottom,
  scrollToExactPercent,
  scrollToTop,
  simulateExitIntent,
  simulateNonExitMouseout,
} from "./input.js";
export {
  gotoDemoPage,
  gotoDemoPageWithoutTrackerWait,
  leaveTrackedPage,
  reloadDemoPage,
} from "./navigation.js";
