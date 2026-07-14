import type { DbShape, Hit, Label, TrackEvent, Workspace } from "../types.js";
import type { ValidationResult } from "./errors.js";
import { applicationError } from "./errors.js";

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function string(value: unknown): value is string {
  return typeof value === "string";
}

function workspace(value: unknown): Workspace | null {
  const item = record(value);
  return item && string(item.id) && string(item.name) && string(item.createdAt)
    ? { createdAt: item.createdAt, id: item.id, name: item.name }
    : null;
}

function event(value: unknown): TrackEvent | null {
  const item = record(value);
  if (
    !item ||
    !string(item.id) ||
    !string(item.workspaceId) ||
    !string(item.createdAt) ||
    !string(item.updatedAt)
  ) {
    return null;
  }
  return {
    createdAt: item.createdAt,
    description: string(item.description) ? item.description : "",
    enabled: typeof item.enabled === "boolean" ? item.enabled : false,
    id: item.id,
    labelIds: Array.isArray(item.labelIds) ? item.labelIds.filter(string) : [],
    name: string(item.name) ? item.name : "(名称未設定)",
    trigger: string(item.trigger) ? item.trigger : "",
    updatedAt: item.updatedAt,
    workspaceId: item.workspaceId,
  };
}

function label(value: unknown): Label | null {
  const item = record(value);
  if (!item || !string(item.id)) return null;
  const color = String(item.color);
  return {
    color: /^#[0-9a-fA-F]{6}$/.test(color) ? color : "#8b8d98",
    id: item.id,
    name: string(item.name) ? item.name : "(名称未設定)",
  };
}

function hit(value: unknown): Hit | null {
  const item = record(value);
  if (
    !item ||
    !string(item.id) ||
    !string(item.workspaceId) ||
    !string(item.ts) ||
    (item.type !== "event" && item.type !== "pageview") ||
    (item.eventId !== null && !string(item.eventId)) ||
    (item.type === "event" && !string(item.eventId)) ||
    (item.type === "pageview" && item.eventId !== null) ||
    !string(item.url)
  ) {
    return null;
  }
  return {
    eventId: item.eventId,
    id: item.id,
    sid: string(item.sid) ? item.sid : "",
    test: typeof item.test === "boolean" ? item.test : false,
    ts: item.ts,
    type: item.type,
    ua: string(item.ua) ? item.ua : "",
    url: item.url,
    vid: string(item.vid) ? item.vid : "",
    workspaceId: item.workspaceId,
  };
}

export function validatePersistedDatabase(
  value: unknown
): ValidationResult<DbShape> {
  const root = record(value);
  const parsedWorkspace = workspace(root?.workspace);
  const events = Array.isArray(root?.events) ? root.events.map(event) : [];
  const labels = Array.isArray(root?.labels) ? root.labels.map(label) : [];
  const hits = Array.isArray(root?.hits) ? root.hits.map(hit) : [];
  if (
    !parsedWorkspace ||
    !Array.isArray(root?.events) ||
    !Array.isArray(root.labels) ||
    !Array.isArray(root.hits) ||
    events.some((item) => item === null) ||
    labels.some((item) => item === null) ||
    hits.some((item) => item === null)
  ) {
    return {
      error: applicationError("db.json の形式が不正"),
      ok: false,
    };
  }
  return {
    ok: true,
    value: {
      events: events as TrackEvent[],
      hits: hits as Hit[],
      labels: labels as Label[],
      workspace: parsedWorkspace,
    },
  };
}
