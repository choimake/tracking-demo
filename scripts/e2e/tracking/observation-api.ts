import { E2E_CORRELATION_UA_PREFIX } from "../harness/config.js";
import { recordAssertionHitCursor } from "./assertion-formatter.js";
import { parseObservationHits } from "./response-parser.js";
import type { HitRecord } from "./response-parser.js";
import type { TrackingTransport } from "./transport.js";

/** このモジュールは、観測 Hit を相関 ID と Hit cursor で抽出する。 */

export interface HitFilter {
  eventId?: string | null;
  type?: string;
  afterHitId?: string | undefined;
}

export class ObservationApi {
  private diagnosticHitCursorCaptured = false;
  private diagnosticHitCursorValue: string | undefined;

  constructor(
    private readonly transport: TrackingTransport,
    private readonly correlationId?: string
  ) {}

  async getAllHits(): Promise<HitRecord[]> {
    return parseObservationHits(
      await this.transport.fetchTracking<unknown>("/api/e2e/observations/hits")
    );
  }

  async getHitsForEvent(eventId: string): Promise<HitRecord[]> {
    return (await this.getAllHits()).filter((hit) => hit.eventId === eventId);
  }

  async getPageviewHitsAfter(afterHitId?: string): Promise<HitRecord[]> {
    return this.getHitsMatching({ afterHitId, type: "pageview" });
  }

  async getPageviewCountAfter(afterHitId?: string): Promise<number> {
    return (await this.getHitsMatching({ afterHitId, type: "pageview" }))
      .length;
  }

  async captureHitCursor(): Promise<string | undefined> {
    const cursor = (await this.getAllHits()).at(-1)?.id;
    this.diagnosticHitCursorCaptured = true;
    this.diagnosticHitCursorValue = cursor;
    recordAssertionHitCursor(cursor);
    return cursor;
  }

  getDiagnosticHitCursor(): { captured: boolean; value: string | null } {
    return {
      captured: this.diagnosticHitCursorCaptured,
      value: this.diagnosticHitCursorValue ?? null,
    };
  }

  async getHitsMatching(filter: HitFilter): Promise<HitRecord[]> {
    const allHits = await this.getAllHits();
    const cursorIndex = filter.afterHitId
      ? allHits.findIndex((hit) => hit.id === filter.afterHitId)
      : -1;
    if (filter.afterHitId && cursorIndex < 0) {
      throw new Error(
        `Hit cursor が観測結果に存在しません: ${filter.afterHitId}`
      );
    }
    const expectedUaSuffix = this.correlationId
      ? ` ${E2E_CORRELATION_UA_PREFIX}${this.correlationId}`
      : undefined;
    return allHits.slice(cursorIndex + 1).filter((hit) => {
      if (hit.test) return false;
      if (expectedUaSuffix && !hit.ua.endsWith(expectedUaSuffix)) return false;
      if (filter.eventId !== undefined && hit.eventId !== filter.eventId) {
        return false;
      }
      if (filter.type !== undefined && hit.type !== filter.type) return false;
      return true;
    });
  }
}
