import type { HitFilter, HitRecord, TrackingClient } from "./client.js";
import {
  expectEventCountExactlyIncreasedBy,
  expectHitCountExactly,
} from "./count-assertions.js";
import type { ExpectedHitPayload } from "./hit-payload-assertions.js";
import { expectHitPayload, waitForNewHit } from "./hit-payload-assertions.js";

/** このモジュールは、発火検証の必須順序だけを固定する。 */

type FireTracking = Pick<
  TrackingClient,
  "captureHitCursor" | "getEventCount7d" | "getHitsMatching"
>;

interface HitCountOptions {
  observationMs?: number;
  pollIntervalMs?: number;
  timeoutMs?: number;
}

export type FiredHitExactCount =
  | {
      countBefore: number;
      eventId: string;
      expectedDelta: number;
      kind: "event-increase";
      label: string;
      timeoutMs?: number;
    }
  | {
      expectedCount: number;
      kind: "hit-count";
      label: string;
      options?: HitCountOptions;
    };

export type ExpectedFiredHitPayload = ExpectedHitPayload &
  Required<Pick<ExpectedHitPayload, "type">>;

export interface ExpectFiredHitInput {
  act: () => Promise<void>;
  exactCount: FiredHitExactCount;
  expectedPayload: ExpectedFiredHitPayload;
  filter: Omit<HitFilter, "afterHitId">;
  hitLabel: string;
  hitTimeoutMs?: number;
  tracking: FireTracking;
}

export interface VerifiedFireResult {
  hit: HitRecord;
  hitCursor: string | undefined;
}

/** Hitカーソル、Act、exact count、new Hit、payloadの順で発火を検証する。 */
export async function expectFiredHit({
  act,
  exactCount,
  expectedPayload,
  filter,
  hitLabel,
  hitTimeoutMs,
  tracking,
}: ExpectFiredHitInput): Promise<VerifiedFireResult> {
  const expectedCount =
    exactCount.kind === "event-increase"
      ? exactCount.expectedDelta
      : exactCount.expectedCount;
  if (!Number.isInteger(expectedCount) || expectedCount < 1) {
    throw new Error("発火検証のexact countは1以上にする");
  }
  const hitCursor = await tracking.captureHitCursor();
  await act();
  if (exactCount.kind === "event-increase") {
    await expectEventCountExactlyIncreasedBy(
      tracking,
      exactCount.eventId,
      exactCount.countBefore,
      exactCount.expectedDelta,
      exactCount.label,
      exactCount.timeoutMs
    );
  } else {
    await expectHitCountExactly(
      tracking,
      { ...filter, afterHitId: hitCursor },
      exactCount.expectedCount,
      exactCount.label,
      exactCount.options
    );
  }
  const hit = await waitForNewHit(
    tracking,
    { ...filter, afterHitId: hitCursor },
    hitLabel,
    hitTimeoutMs
  );
  expectHitPayload(hit, expectedPayload);
  return { hit, hitCursor };
}
