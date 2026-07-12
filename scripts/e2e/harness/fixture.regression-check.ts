import assert from "node:assert/strict";

import type { CreateEventInput, EventSummary } from "../tracking/client.js";
import {
  E2E_FIXTURE_TTL_MS,
  setupE2eFixtures,
  teardownE2eFixtures,
} from "./session.js";

const NOW_MS = 2_000_000_000_000;
const OWNER_A = "11111111-1111-4111-8111-111111111111";
const OWNER_B = "22222222-2222-4222-8222-222222222222";

class FakeTrackingClient {
  readonly events = new Map<string, EventSummary>();
  readonly deleteAttempts: string[] = [];
  createAttempt = 0;
  failCreateAt?: number;
  readonly deleteFailures = new Set<string>();

  addEvent(event: EventSummary): void {
    this.events.set(event.id, event);
  }

  async getEventSummaries(): Promise<EventSummary[]> {
    return [...this.events.values()];
  }

  async createEvent(input: CreateEventInput): Promise<string> {
    this.createAttempt++;
    if (this.createAttempt === this.failCreateAt) {
      throw new Error(`create failure ${this.createAttempt}`);
    }
    const id = `created-${this.createAttempt}`;
    this.addEvent({ count7d: 0, enabled: true, id, name: input.name });
    return id;
  }

  async deleteEvent(eventId: string): Promise<void> {
    this.deleteAttempts.push(eventId);
    if (this.deleteFailures.has(eventId)) {
      throw new Error(`delete failure ${eventId}`);
    }
    this.events.delete(eventId);
  }
}

function userEvent(id: string, name: string, enabled = true): EventSummary {
  return { count7d: 0, enabled, id, name };
}

async function checkExistingDataAndRerun(): Promise<void> {
  const tracking = new FakeTrackingClient();
  tracking.addEvent(userEvent("user-same-name", "E2E滞在2秒"));
  tracking.addEvent(userEvent("ev_exit", "離脱インテント", true));

  const first = await setupE2eFixtures(tracking, {
    nowMs: NOW_MS,
    ownerId: OWNER_A,
  });
  await teardownE2eFixtures(tracking, first);
  const second = await setupE2eFixtures(tracking, {
    nowMs: NOW_MS + 1,
    ownerId: OWNER_B,
  });
  await teardownE2eFixtures(tracking, second);

  assert.equal(tracking.events.get("user-same-name")?.enabled, true);
  assert.equal(tracking.events.get("ev_exit")?.enabled, true);
  assert.equal(tracking.events.size, 2);
  console.log(
    "fixture rerun: existing same-name data and enabled state retained"
  );
}

async function checkConcurrentOwnership(): Promise<void> {
  const tracking = new FakeTrackingClient();
  const [fixturesA, fixturesB] = await Promise.all([
    setupE2eFixtures(tracking, { nowMs: NOW_MS, ownerId: OWNER_A }),
    setupE2eFixtures(tracking, { nowMs: NOW_MS, ownerId: OWNER_B }),
  ]);
  const idsA = new Set(Object.values(fixturesA));
  const idsB = new Set(Object.values(fixturesB));
  assert.equal(
    [...idsA].some((id) => idsB.has(id)),
    false
  );

  await teardownE2eFixtures(tracking, fixturesA);
  for (const id of idsB) assert.equal(tracking.events.has(id), true);
  await teardownE2eFixtures(tracking, fixturesB);
  assert.equal(tracking.events.size, 0);
  console.log("fixture concurrency: each run removed only its owned IDs");
}

async function checkTtlCleanup(): Promise<void> {
  const tracking = new FakeTrackingClient();
  const staleMs = NOW_MS - E2E_FIXTURE_TTL_MS - 1;
  const freshMs = NOW_MS - E2E_FIXTURE_TTL_MS + 1;
  tracking.addEvent(
    userEvent("stale", `__e2e_fixture__:${staleMs}:${OWNER_A}:stale`)
  );
  tracking.addEvent(
    userEvent("fresh", `__e2e_fixture__:${freshMs}:${OWNER_A}:fresh`)
  );
  tracking.addEvent(userEvent("lookalike", `E2E滞在2秒`));

  const fixtures = await setupE2eFixtures(tracking, {
    nowMs: NOW_MS,
    ownerId: OWNER_B,
  });
  assert.equal(tracking.events.has("stale"), false);
  assert.equal(tracking.events.has("fresh"), true);
  assert.equal(tracking.events.has("lookalike"), true);
  await teardownE2eFixtures(tracking, fixtures);
  console.log(
    "fixture TTL: stale owned marker removed; fresh and user data retained"
  );
}

async function checkSetupRollback(): Promise<void> {
  const tracking = new FakeTrackingClient();
  tracking.failCreateAt = 2;
  await assert.rejects(
    setupE2eFixtures(tracking, { nowMs: NOW_MS, ownerId: OWNER_A }),
    /create failure 2/
  );
  assert.equal(tracking.events.size, 0);
  assert.deepEqual(tracking.deleteAttempts, ["created-1"]);
  console.log("fixture setup failure: partial fixture rolled back");
}

async function checkTeardownFailure(): Promise<void> {
  const tracking = new FakeTrackingClient();
  const fixtures = await setupE2eFixtures(tracking, {
    nowMs: NOW_MS,
    ownerId: OWNER_A,
  });
  tracking.deleteFailures.add(fixtures.exitIntentEventId);
  tracking.deleteFailures.add(fixtures.japaneseUrlEventId);
  await assert.rejects(
    teardownE2eFixtures(tracking, fixtures),
    (error: unknown) => {
      assert(error instanceof AggregateError);
      assert.match(error.message, new RegExp(fixtures.exitIntentEventId));
      assert.match(error.message, new RegExp(fixtures.japaneseUrlEventId));
      return true;
    }
  );
  assert.deepEqual(tracking.deleteAttempts.slice(-3), [
    fixtures.exitIntentEventId,
    fixtures.timeOnPageEventId,
    fixtures.japaneseUrlEventId,
  ]);
  assert.equal(tracking.events.has(fixtures.timeOnPageEventId), false);
  console.log(
    "fixture teardown failure: all IDs attempted and failure propagated"
  );
}

await checkExistingDataAndRerun();
await checkConcurrentOwnership();
await checkTtlCleanup();
await checkSetupRollback();
await checkTeardownFailure();
