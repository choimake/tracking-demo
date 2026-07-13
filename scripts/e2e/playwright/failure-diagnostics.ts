import fs from "node:fs/promises";
import path from "node:path";

import type { AssertionFailureDetails } from "../tracking/assertion-formatter.js";
import { parseAssertionFailure } from "../tracking/assertion-formatter.js";

export const DIAGNOSTIC_CONTEXT_ANNOTATION = "e2e-diagnostic-context";
export const FAILURE_DIAGNOSTICS_SCHEMA_VERSION = 1;

export interface FailureDiagnosticContext {
  browser: string;
  correlationId: string;
  hitCursor: { captured: boolean; value: string | null };
  manifestPath: string;
  repeat: number;
  scenarioId: string;
  scenarioName: string;
  seed: number | null;
  video: { mode: "all" | "on-failure"; path: string } | null;
}

export interface DiagnosticAttachment {
  body?: Buffer;
  contentType: string;
  name: string;
  path?: string;
}

export interface DiagnosticError {
  message?: string;
  stack?: string;
}

export type ArtifactReference =
  | { path: string; status: "available" }
  | { generationError?: string; reason: string; status: "unavailable" };

export interface FailureDiagnosticManifest {
  artifacts: Record<
    | "console"
    | "hit"
    | "pageError"
    | "screenshot"
    | "stackLog"
    | "trace"
    | "video",
    ArtifactReference
  >;
  failure: {
    assertion:
      | ({ status: "available" } & AssertionFailureDetails)
      | { reason: string; status: "unavailable" };
    errors: { message: string; stack?: string }[];
    finalObserved: unknown;
  };
  generatedAt: string;
  scenario: {
    browser: string;
    correlationId: string;
    hitCursor: { captured: boolean; value: string | null };
    id: string;
    name: string;
    repeat: number;
    seed: number | null;
  };
  schemaVersion: 1;
}

export interface ManifestOperations {
  access(filePath: string): Promise<void>;
  mkdir(directory: string): Promise<void>;
  writeFile(filePath: string, value: string | Buffer): Promise<void>;
}

export interface WriteManifestOptions {
  attachments: readonly DiagnosticAttachment[];
  context: FailureDiagnosticContext;
  errors: readonly DiagnosticError[];
  now?: () => Date;
  operations?: ManifestOperations;
}

const defaultOperations: ManifestOperations = {
  access: (filePath) => fs.access(filePath),
  mkdir: async (directory) => {
    await fs.mkdir(directory, { recursive: true });
  },
  writeFile: (filePath, value) => fs.writeFile(filePath, value),
};

function errorText(error: unknown): string {
  return error instanceof Error
    ? `${error.name}: ${error.message}`
    : String(error);
}

function attachment(
  attachments: readonly DiagnosticAttachment[],
  name: string
): DiagnosticAttachment | undefined {
  return attachments.find((item) => item.name === name);
}

function attachmentErrorText(
  item: DiagnosticAttachment | undefined
): string | undefined {
  if (!item?.body) return undefined;
  const raw = item.body.toString("utf8");
  try {
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === "string" ? parsed : raw;
  } catch {
    return raw;
  }
}

async function materializeAttachment(
  item: DiagnosticAttachment | undefined,
  outputPath: string,
  missingReason: string,
  operations: ManifestOperations
): Promise<ArtifactReference> {
  if (!item) return { reason: missingReason, status: "unavailable" };
  if (item.path) {
    try {
      await operations.access(item.path);
      return { path: path.resolve(item.path), status: "available" };
    } catch (error) {
      return {
        generationError: errorText(error),
        reason: `${item.name}のpathにファイルがありません`,
        status: "unavailable",
      };
    }
  }
  if (!item.body) {
    return {
      reason: `${item.name}にpathとbodyがありません`,
      status: "unavailable",
    };
  }
  try {
    await operations.writeFile(outputPath, item.body);
    return { path: path.resolve(outputPath), status: "available" };
  } catch (error) {
    return {
      generationError: errorText(error),
      reason: `${item.name}の保存に失敗しました`,
      status: "unavailable",
    };
  }
}

async function diagnosticArtifactReference(
  attachments: readonly DiagnosticAttachment[],
  name: string,
  outputPath: string,
  missingReason: string,
  operations: ManifestOperations
): Promise<ArtifactReference> {
  const generationError = attachmentErrorText(
    attachment(attachments, `${name}-error`)
  );
  if (generationError) {
    return {
      generationError,
      reason: `${name}の生成または添付に失敗しました`,
      status: "unavailable",
    };
  }
  return materializeAttachment(
    attachment(attachments, name),
    outputPath,
    missingReason,
    operations
  );
}

function normalizedErrors(
  errors: readonly DiagnosticError[]
): { message: string; stack?: string }[] {
  const normalized = errors.map((error) => ({
    message: error.message ?? "messageのない失敗",
    ...(error.stack ? { stack: error.stack } : {}),
  }));
  return normalized.length > 0
    ? normalized
    : [{ message: "失敗情報を取得できませんでした" }];
}

function finalObserved(
  assertion: AssertionFailureDetails | undefined,
  errors: readonly { message: string }[]
): unknown {
  if (assertion) return assertion.actual;
  for (const error of errors) {
    const match = /finalObserved=(?<value>[^;\n]+)/.exec(error.message);
    if (!match?.groups?.value) continue;
    try {
      return JSON.parse(match.groups.value) as unknown;
    } catch {
      return match.groups.value;
    }
  }
  return null;
}

async function videoReference(
  context: FailureDiagnosticContext,
  errors: readonly { message: string }[],
  operations: ManifestOperations
): Promise<ArtifactReference> {
  if (!context.video) {
    return { reason: "RECORD_VIDEOが無効です", status: "unavailable" };
  }
  const teardownError = errors.find((item) =>
    item.message.includes("video cleanup")
  );
  if (teardownError) {
    return {
      generationError: teardownError.message,
      reason: "videoの確定または破棄に失敗しました",
      status: "unavailable",
    };
  }
  try {
    await operations.access(context.video.path);
    return { path: path.resolve(context.video.path), status: "available" };
  } catch (error) {
    return {
      generationError: errorText(error),
      reason: "videoを生成できませんでした",
      status: "unavailable",
    };
  }
}

/** 必須fieldとartifactのpath/不存在理由contractを検証する。 */
export function validateFailureDiagnosticManifest(
  manifest: FailureDiagnosticManifest
): void {
  if (manifest.schemaVersion !== FAILURE_DIAGNOSTICS_SCHEMA_VERSION) {
    throw new Error("診断manifestのschemaVersionが不正です");
  }
  const generatedAtMs = Date.parse(manifest.generatedAt);
  if (
    !Number.isFinite(generatedAtMs) ||
    new Date(generatedAtMs).toISOString() !== manifest.generatedAt
  ) {
    throw new Error("診断manifestのgeneratedAtが不正です");
  }
  const scenario = manifest.scenario;
  if (
    !(
      scenario.id &&
      scenario.name &&
      scenario.browser &&
      scenario.correlationId
    )
  ) {
    throw new Error("診断manifestのscenario必須fieldがありません");
  }
  if (!Number.isInteger(scenario.repeat)) {
    throw new Error("診断manifestのrepeatが不正です");
  }
  if (
    !Object.hasOwn(scenario, "seed") ||
    (scenario.seed !== null && !Number.isSafeInteger(scenario.seed))
  ) {
    throw new Error("診断manifestのseedが不正です");
  }
  if (
    typeof scenario.hitCursor.captured !== "boolean" ||
    (scenario.hitCursor.value !== null &&
      typeof scenario.hitCursor.value !== "string")
  ) {
    throw new Error("診断manifestのHit cursorが不正です");
  }
  if (manifest.failure.errors.length === 0) {
    throw new Error("診断manifestのfailure.errorsが空です");
  }
  if (manifest.failure.errors.some((error) => !error.message)) {
    throw new Error("診断manifestのfailure.errors.messageがありません");
  }
  if (!Object.hasOwn(manifest.failure, "finalObserved")) {
    throw new Error("診断manifestのfinalObservedがありません");
  }
  if (
    manifest.failure.assertion.status === "available" &&
    !(
      manifest.failure.assertion.name &&
      Object.hasOwn(manifest.failure.assertion, "actual") &&
      Object.hasOwn(manifest.failure.assertion, "expected") &&
      Object.hasOwn(manifest.failure.assertion, "context") &&
      manifest.failure.assertion.context !== null &&
      typeof manifest.failure.assertion.context === "object" &&
      !Array.isArray(manifest.failure.assertion.context)
    )
  ) {
    throw new Error("診断manifestの構造化assertionが不正です");
  }
  if (
    manifest.failure.assertion.status === "unavailable" &&
    !manifest.failure.assertion.reason
  ) {
    throw new Error("診断manifestのassertion不存在理由がありません");
  }
  const artifactNames = [
    "hit",
    "trace",
    "screenshot",
    "stackLog",
    "console",
    "pageError",
    "video",
  ] as const;
  if (
    Object.keys(manifest.artifacts).length !== artifactNames.length ||
    artifactNames.some((name) => !Object.hasOwn(manifest.artifacts, name))
  ) {
    throw new Error("診断manifestのartifact必須fieldがありません");
  }
  for (const [name, artifact] of Object.entries(manifest.artifacts)) {
    if (artifact.status === "available" ? !artifact.path : !artifact.reason) {
      throw new Error(`診断manifestのartifactが不正です: ${name}`);
    }
  }
}

/** 一部artifactが失敗しても残りを索引化し、最後にmanifestを出力する。 */
export async function writeFailureDiagnosticManifest(
  options: WriteManifestOptions
): Promise<FailureDiagnosticManifest> {
  const operations = options.operations ?? defaultOperations;
  const outputDirectory = path.dirname(options.context.manifestPath);
  await operations.mkdir(outputDirectory);
  const errors = normalizedErrors(options.errors);
  const structuredAssertion = errors
    .map((error) => parseAssertionFailure(error.message))
    .find((item) => item !== undefined);
  const hit = await diagnosticArtifactReference(
    options.attachments,
    "correlated-hits",
    path.join(outputDirectory, "correlated-hits.json"),
    "相関Hitを取得できませんでした",
    operations
  );
  const manifest: FailureDiagnosticManifest = {
    artifacts: {
      console: await diagnosticArtifactReference(
        options.attachments,
        "console-log",
        path.join(outputDirectory, "console.json"),
        "consoleを収集できませんでした",
        operations
      ),
      hit,
      pageError: await diagnosticArtifactReference(
        options.attachments,
        "page-errors",
        path.join(outputDirectory, "page-errors.json"),
        "page errorを収集できませんでした",
        operations
      ),
      screenshot: await materializeAttachment(
        attachment(options.attachments, "screenshot"),
        path.join(outputDirectory, "screenshot.png"),
        "Playwrightがscreenshotを生成しませんでした",
        operations
      ),
      stackLog: await diagnosticArtifactReference(
        options.attachments,
        "stack-log",
        path.join(outputDirectory, "stack.log"),
        "stack logのpathが設定されていません",
        operations
      ),
      trace: await materializeAttachment(
        attachment(options.attachments, "trace"),
        path.join(outputDirectory, "trace.zip"),
        "Playwrightがtraceを生成しませんでした",
        operations
      ),
      video: await videoReference(options.context, errors, operations),
    },
    failure: {
      assertion: structuredAssertion
        ? { ...structuredAssertion, status: "available" }
        : { reason: "構造化assertion以外の失敗です", status: "unavailable" },
      errors,
      finalObserved: finalObserved(structuredAssertion, errors),
    },
    generatedAt: (options.now ?? (() => new Date()))().toISOString(),
    scenario: {
      browser: options.context.browser,
      correlationId: options.context.correlationId,
      hitCursor: options.context.hitCursor,
      id: options.context.scenarioId,
      name: options.context.scenarioName,
      repeat: options.context.repeat,
      seed: options.context.seed,
    },
    schemaVersion: FAILURE_DIAGNOSTICS_SCHEMA_VERSION,
  };
  const artifactErrorTerms: Record<
    keyof FailureDiagnosticManifest["artifacts"],
    readonly string[]
  > = {
    console: ["console-logとconsole-log-errorの添付に失敗"],
    hit: ["correlated-hitsとcorrelated-hits-errorの添付に失敗"],
    pageError: ["page-errorsとpage-errors-errorの添付に失敗"],
    screenshot: [],
    stackLog: ["stack-logとstack-log-errorの添付に失敗"],
    trace: [],
    video: ["video cleanup:"],
  };
  for (const [name, terms] of Object.entries(artifactErrorTerms) as [
    keyof FailureDiagnosticManifest["artifacts"],
    readonly string[],
  ][]) {
    const artifact = manifest.artifacts[name];
    if (artifact.status === "available" || artifact.generationError) continue;
    const generationError = errors.find((error) =>
      terms.some((term) => error.message.includes(term))
    )?.message;
    if (generationError) {
      manifest.artifacts[name] = { ...artifact, generationError };
    }
  }
  validateFailureDiagnosticManifest(manifest);
  await operations.writeFile(
    options.context.manifestPath,
    `${JSON.stringify(manifest, null, 2)}\n`
  );
  return manifest;
}
