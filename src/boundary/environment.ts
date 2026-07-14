import path from "node:path";

import type { ValidationResult } from "./errors.js";
import { applicationError } from "./errors.js";

type Environment = Readonly<Record<string, string | undefined>>;

export interface TrackingServerEnvironment {
  demoSiteUrl: string;
  e2eObservationEnabled: boolean;
  port: number;
}

export interface DemoServerEnvironment {
  sitePort: number;
  trackingOrigin: string;
}

export interface DatabaseEnvironment {
  dbPath: string;
  saveDebounceMs: number;
}

function integerInRange(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  name: string
): number {
  const candidate = value === undefined ? fallback : Number(value);
  if (
    !Number.isInteger(candidate) ||
    candidate < minimum ||
    candidate > maximum
  ) {
    throw applicationError(
      `${name} must be an integer from ${minimum} to ${maximum}`
    );
  }
  return candidate;
}

function httpUrl(value: string, name: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw applicationError(`${name} must be an HTTP URL`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw applicationError(`${name} must be an HTTP URL`);
  }
  return parsed.toString().replace(/\/$/, "");
}

export function loadTrackingServerEnvironment(
  environment: Environment = process.env
): TrackingServerEnvironment {
  const observation = environment.E2E_OBSERVATION_ENABLED ?? "0";
  if (observation !== "0" && observation !== "1") {
    throw applicationError("E2E_OBSERVATION_ENABLED must be 0 or 1");
  }
  return {
    demoSiteUrl: httpUrl(
      environment.DEMO_SITE_URL ?? "http://localhost:3200",
      "DEMO_SITE_URL"
    ),
    e2eObservationEnabled: observation === "1",
    port: integerInRange(environment.PORT, 3100, 1, 65_535, "PORT"),
  };
}

export function loadDemoServerEnvironment(
  environment: Environment = process.env
): DemoServerEnvironment {
  const trackingPort = integerInRange(
    environment.PORT,
    3100,
    1,
    65_535,
    "PORT"
  );
  return {
    sitePort: integerInRange(
      environment.SITE_PORT,
      3200,
      1,
      65_535,
      "SITE_PORT"
    ),
    trackingOrigin: httpUrl(
      environment.TRACKING_ORIGIN ?? `http://localhost:${trackingPort}`,
      "TRACKING_ORIGIN"
    ),
  };
}

export function loadDatabaseEnvironment(
  root: string,
  environment: Environment = process.env
): DatabaseEnvironment {
  const rawPath = environment.DB_PATH;
  if (rawPath !== undefined && rawPath.trim() === "") {
    throw applicationError("DB_PATH must not be empty");
  }
  return {
    dbPath: rawPath
      ? path.resolve(rawPath)
      : path.join(root, "data", "db.json"),
    saveDebounceMs: integerInRange(
      environment.DB_SAVE_DEBOUNCE_MS,
      100,
      0,
      60_000,
      "DB_SAVE_DEBOUNCE_MS"
    ),
  };
}

export function validateEnvironmentForContract(
  environment: Environment
): ValidationResult<TrackingServerEnvironment> {
  try {
    return { ok: true, value: loadTrackingServerEnvironment(environment) };
  } catch (error) {
    if (error && typeof error === "object" && "kind" in error) {
      return { error: error as ReturnType<typeof applicationError>, ok: false };
    }
    throw error;
  }
}
