import {
  DEFAULT_WAIT_TIMEOUT_MS,
  getTrackingOrigin,
} from "../harness/config.js";
import { AdminApi } from "./admin-api.js";
import type { CreateEventInput } from "./admin-api.js";
import { ObservationApi } from "./observation-api.js";
import type { HitFilter } from "./observation-api.js";
import type {
  EventSummary,
  HitRecord,
  TagCheckResult,
} from "./response-parser.js";
import { TrackingTransport } from "./transport.js";

/** このモジュールは、transport・観測 API・管理 API を既存クライアントへ統合する。 */

export type { CreateEventInput } from "./admin-api.js";
export type { HitFilter } from "./observation-api.js";
export type {
  EventSummary,
  HitRecord,
  TagCheckResult,
} from "./response-parser.js";

export class TrackingClient {
  private readonly admin: AdminApi;
  private readonly observation: ObservationApi;
  private readonly transport: TrackingTransport;

  constructor(
    private readonly correlationId?: string,
    trackingOrigin = getTrackingOrigin(),
    requestTimeoutMs = DEFAULT_WAIT_TIMEOUT_MS
  ) {
    this.transport = new TrackingTransport(trackingOrigin, requestTimeoutMs);
    this.admin = new AdminApi(this.transport);
    this.observation = new ObservationApi(this.transport, correlationId);
  }

  fetchTracking<T = unknown>(path: string, opts: RequestInit = {}): Promise<T> {
    return this.transport.fetchTracking<T>(path, opts);
  }

  getEventSummaries(): Promise<EventSummary[]> {
    return this.admin.getEventSummaries();
  }

  async getEventCount7d(eventId: string): Promise<number> {
    if (this.correlationId) {
      return (
        await this.observation.getHitsMatching({
          eventId,
          type: "event",
        })
      ).length;
    }
    return this.admin.getEventCount7dFromApi(eventId);
  }

  getEventCount7dFromApi(eventId: string): Promise<number> {
    return this.admin.getEventCount7dFromApi(eventId);
  }

  getTagCheck(sinceMs: number): Promise<TagCheckResult> {
    return this.admin.getTagCheck(sinceMs);
  }

  getPageviewCountAfter(afterHitId?: string): Promise<number> {
    return this.observation.getPageviewCountAfter(afterHitId);
  }

  getAllHits(): Promise<HitRecord[]> {
    return this.observation.getAllHits();
  }

  getHitsForEvent(eventId: string): Promise<HitRecord[]> {
    return this.observation.getHitsForEvent(eventId);
  }

  getPageviewHitsAfter(afterHitId?: string): Promise<HitRecord[]> {
    return this.observation.getPageviewHitsAfter(afterHitId);
  }

  captureHitCursor(): Promise<string | undefined> {
    return this.observation.captureHitCursor();
  }

  getDiagnosticHitCursor(): { captured: boolean; value: string | null } {
    return this.observation.getDiagnosticHitCursor();
  }

  getHitsMatching(filter: HitFilter): Promise<HitRecord[]> {
    return this.observation.getHitsMatching(filter);
  }

  toggleEvent(eventId: string, enabled: boolean): Promise<void> {
    return this.admin.toggleEvent(eventId, enabled);
  }

  createEvent(input: CreateEventInput): Promise<string> {
    return this.admin.createEvent(input);
  }

  deleteEvent(eventId: string): Promise<void> {
    return this.admin.deleteEvent(eventId);
  }
}
