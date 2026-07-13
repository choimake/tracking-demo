export { TrackingClient } from "./client.js";
export type { CreateEventInput } from "./client.js";
export {
  ASSERTION_FAILURE_MARKER,
  assertionError,
  formatAssertionFailure,
  parseAssertionFailure,
  recordAssertionHitCursor,
  runWithAssertionContext,
} from "./assertion-formatter.js";
export type {
  AssertionFailureDetails,
  AssertionFailureInput,
  AssertionScenarioContext,
} from "./assertion-formatter.js";
export {
  expectEventCountExactly,
  expectEventCountExactlyIncreasedBy,
  expectHitCountAtLeast,
  expectHitCountAtMost,
  expectHitCountExactly,
  expectNoHitsDuringObservation,
  expectPageviewCountAtLeast,
  expectPageviewCountExactly,
} from "./count-assertions.js";
export {
  ANON_SID_RE,
  ANON_VID_RE,
  expectAnonIdentityValues,
  expectAnonIdsPresent,
  expectHitPayload,
  expectTagCheckContainsHit,
  waitForNewHit,
} from "./hit-payload-assertions.js";
export type { ExpectedHitPayload } from "./hit-payload-assertions.js";
export { expectFiredHit } from "./fire-assertion-helper.js";
export type {
  ExpectFiredHitInput,
  ExpectedFiredHitPayload,
  FiredHitExactCount,
  VerifiedFireResult,
} from "./fire-assertion-helper.js";
export { expectTrackerLogContains } from "./log-assertions.js";
export { quiesceBeacons, waitForCondition } from "./polling.js";
export type { WaitObservation } from "./polling.js";
export {
  EVENT_ID_CART,
  EVENT_ID_PURCHASE,
  EVENT_ID_SCROLL_50,
} from "./seed-events.js";
