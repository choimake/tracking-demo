import { parseTrigger } from "../shared/trigger.js";
import type { ApplicationError, ValidationResult } from "./errors.js";
import { applicationError } from "./errors.js";

export interface CollectInput {
  eventId: string | null | undefined;
  isTest: boolean;
  sid: string;
  type: "event" | "pageview";
  ua: string;
  url: string;
  vid: string;
  ws: string;
}

export interface EventInput {
  description: string;
  labelIds: string[];
  name: string;
  trigger: string;
}

export interface LabelInput {
  color: string;
  name: string;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function invalid(message = "invalid input"): {
  error: ApplicationError;
  ok: false;
} {
  return { error: applicationError(message), ok: false };
}

export function validateWorkspaceQuery(
  query: unknown,
  workspaceId: string
): ValidationResult<string> {
  const value = record(query)?.id;
  return value === workspaceId
    ? { ok: true, value: workspaceId }
    : {
        error: applicationError("unknown workspace", 404, "not_found"),
        ok: false,
      };
}

export function validateRequestOrigin(
  protocol: unknown,
  host: unknown
): ValidationResult<string> {
  if (
    (protocol !== "http" && protocol !== "https") ||
    typeof host !== "string" ||
    host.length === 0 ||
    host.length > 255 ||
    !/^[A-Za-z0-9.:[\]-]+$/.test(host)
  ) {
    return invalid("invalid request origin");
  }
  try {
    const url = new URL(`${protocol}://${host}`);
    return { ok: true, value: url.origin };
  } catch {
    return invalid("invalid request origin");
  }
}

const UA_MAX_LENGTH = 512;
const VID_RE = /^v_[0-9a-f-]{36}$/;
const SID_RE = /^s_[0-9a-f-]{36}$/;

function anonId(value: unknown, pattern: RegExp): string | null {
  if (value === undefined || value === "") return "";
  return typeof value === "string" && pattern.test(value) ? value : null;
}

export function validateCollectInput(
  body: unknown,
  workspaceId: string
): ValidationResult<CollectInput> {
  const value = record(body);
  if (!value) return invalid("invalid payload");
  const { eventId, sid, test, type, ua, url, vid, ws } = value;
  const normalizedVid = anonId(vid, VID_RE);
  const normalizedSid = anonId(sid, SID_RE);
  if (
    ws !== workspaceId ||
    (type !== "event" && type !== "pageview") ||
    (test !== undefined && typeof test !== "boolean") ||
    (url !== undefined && (typeof url !== "string" || url.length > 2000)) ||
    (eventId !== undefined &&
      eventId !== null &&
      typeof eventId !== "string") ||
    (ua !== undefined &&
      (typeof ua !== "string" || ua.length > UA_MAX_LENGTH)) ||
    normalizedVid === null ||
    normalizedSid === null ||
    (type === "event" &&
      (typeof eventId !== "string" || eventId.length === 0)) ||
    (type === "pageview" && eventId !== undefined && eventId !== null)
  ) {
    return invalid("invalid payload");
  }
  return {
    ok: true,
    value: {
      eventId: eventId as string | null | undefined,
      isTest: test === true,
      sid: normalizedSid,
      type,
      ua: typeof ua === "string" ? ua : "",
      url: typeof url === "string" ? url : "",
      vid: normalizedVid,
      ws,
    },
  };
}

export function validateWorkspaceInput(
  body: unknown
): ValidationResult<{ name: string }> {
  const rawName = record(body)?.name;
  const name = typeof rawName === "string" ? rawName.trim() : "";
  return name
    ? { ok: true, value: { name } }
    : invalid("ワークスペース名を入力してください");
}

export function validateEventInput(
  body: unknown,
  validLabelIds: ReadonlySet<string>
): ValidationResult<EventInput> {
  const value = record(body);
  if (
    !value ||
    typeof value.name !== "string" ||
    typeof value.trigger !== "string" ||
    (value.description !== undefined &&
      typeof value.description !== "string") ||
    (value.labelIds !== undefined &&
      (!Array.isArray(value.labelIds) ||
        value.labelIds.some((id) => typeof id !== "string")))
  ) {
    return invalid();
  }
  const name = value.name.trim();
  const trigger = value.trigger.trim();
  if (!name) return invalid("イベント名を入力してください");
  if (!parseTrigger(trigger)) {
    return invalid(
      "トリガーの値が不正です。URL到達は「/」で始まるパス(?と#は含められません)、クリックはCSSセレクタ、滞在時間は1〜86400の整数(秒)、スクロール率は1〜100の整数を入力してください"
    );
  }
  const labelIds = Array.isArray(value?.labelIds)
    ? value.labelIds.filter((id) => validLabelIds.has(id))
    : [];
  return {
    ok: true,
    value: {
      description: (value.description ?? "").trim(),
      labelIds,
      name,
      trigger,
    },
  };
}

export function validateToggleInput(
  body: unknown
): ValidationResult<{ enabled: boolean }> {
  const enabled = record(body)?.enabled;
  return typeof enabled === "boolean"
    ? { ok: true, value: { enabled } }
    : invalid("enabled must be boolean");
}

export function validateTagCheckQuery(
  query: unknown
): ValidationResult<{ since: number }> {
  const raw = record(query)?.since ?? 0;
  const since =
    typeof raw === "string" || typeof raw === "number"
      ? Number(raw)
      : Number.NaN;
  return Number.isFinite(since) && since >= 0
    ? { ok: true, value: { since } }
    : invalid("since must be a non-negative number");
}

export function validateLabelInput(
  body: unknown
): ValidationResult<LabelInput> {
  const value = record(body);
  if (
    !value ||
    typeof value.name !== "string" ||
    (value.color !== undefined && typeof value.color !== "string")
  ) {
    return invalid();
  }
  const name = value.name.trim();
  if (!name) return invalid("ラベル名を入力してください");
  const color = value.color ?? "#8b8d98";
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
    return invalid("ラベル色は #RRGGBB 形式で指定してください");
  }
  return { ok: true, value: { color, name } };
}

export function validateResourceId(
  value: unknown,
  prefix: "ev_" | "lb_"
): ValidationResult<string> {
  return typeof value === "string" &&
    value.startsWith(prefix) &&
    value.length <= 128
    ? { ok: true, value }
    : invalid("invalid resource id");
}
