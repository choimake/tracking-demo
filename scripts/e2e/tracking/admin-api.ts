import {
  parseDeleteResult,
  parseEventMutation,
  parseEventSummaries,
  parseTagCheckResult,
} from "./response-parser.js";
import type { EventSummary, TagCheckResult } from "./response-parser.js";
import type { TrackingTransport } from "./transport.js";

/** このモジュールは、管理 API でイベントを照会・変更する。 */

export interface CreateEventInput {
  name: string;
  description: string;
  trigger: string;
  labelIds: string[];
}

export class AdminApi {
  constructor(private readonly transport: TrackingTransport) {}

  async getEventSummaries(): Promise<EventSummary[]> {
    return parseEventSummaries(
      await this.transport.fetchTracking<unknown>("/api/events")
    );
  }

  async getEventCount7dFromApi(eventId: string): Promise<number> {
    return this.requireEventSummary(eventId, await this.getEventSummaries())
      .count7d;
  }

  async getTagCheck(sinceMs: number): Promise<TagCheckResult> {
    return parseTagCheckResult(
      await this.transport.fetchTracking<unknown>(
        `/api/tag-check?since=${sinceMs}`
      )
    );
  }

  async toggleEvent(eventId: string, enabled: boolean): Promise<void> {
    parseEventMutation(
      await this.transport.fetchTracking(`/api/events/${eventId}/toggle`, {
        body: JSON.stringify({ enabled }),
        method: "POST",
      }),
      "管理API POST /api/events/:id/toggle"
    );
  }

  async createEvent(input: CreateEventInput): Promise<string> {
    const created = parseEventMutation(
      await this.transport.fetchTracking<unknown>("/api/events", {
        body: JSON.stringify(input),
        method: "POST",
      }),
      "管理API POST /api/events"
    );
    return created.id;
  }

  async deleteEvent(eventId: string): Promise<void> {
    try {
      parseDeleteResult(
        await this.transport.fetchTracking(`/api/events/${eventId}`, {
          method: "DELETE",
        })
      );
    } catch (error) {
      if (error instanceof Error && error.message.endsWith("-> HTTP 404")) {
        return;
      }
      throw error;
    }
  }

  private requireEventSummary(
    eventId: string,
    events: EventSummary[]
  ): EventSummary {
    const event = events.find((item) => item.id === eventId);
    if (!event) {
      throw new Error(
        `イベントが管理API応答に存在しません: eventId=${eventId}`
      );
    }
    return event;
  }
}
