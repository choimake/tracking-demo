import crypto from "node:crypto";
import path from "node:path";

import type { Reporter, TestCase, TestResult } from "@playwright/test/reporter";

import { e2eScenarios } from "../scenarios.js";
import {
  DIAGNOSTIC_CONTEXT_ANNOTATION,
  writeFailureDiagnosticManifest,
} from "./failure-diagnostics.js";
import type { FailureDiagnosticContext } from "./failure-diagnostics.js";

function diagnosticContext(
  test: TestCase
): FailureDiagnosticContext | undefined {
  const annotation = test.annotations.find(
    (item) => item.type === DIAGNOSTIC_CONTEXT_ANNOTATION
  );
  if (!annotation?.description) return undefined;
  try {
    return JSON.parse(annotation.description) as FailureDiagnosticContext;
  } catch {
    return undefined;
  }
}

function fallbackDiagnosticContext(test: TestCase): FailureDiagnosticContext {
  const scenarioIndex = e2eScenarios.findIndex(
    (scenario) => scenario.name === test.title
  );
  const scenario = e2eScenarios[scenarioIndex];
  const browser = test.parent.project()?.name.split(":")[0] ?? "unknown";
  const runId = process.env.E2E_RUN_ID ?? "run-id-unavailable";
  const scenarioHash = crypto
    .createHash("sha256")
    .update(test.title)
    .digest("hex")
    .slice(0, 12);
  const correlationId = `${runId}/${browser}/repeat-${test.repeatEachIndex}/${scenarioIndex}-${scenarioHash}`;
  return {
    browser,
    correlationId,
    hitCursor: { captured: false, value: null },
    manifestPath: path.resolve(
      "test-results",
      "playwright",
      "failure-diagnostics",
      `${test.id}-repeat-${test.repeatEachIndex}.json`
    ),
    repeat: test.repeatEachIndex,
    scenarioId: scenario?.id ?? "scenario-unavailable",
    scenarioName: test.title,
    seed: process.env.E2E_SEED ? Number(process.env.E2E_SEED) : null,
    video: null,
  };
}

/** runtime annotationを優先し、fixture setup失敗時はtest metadataから補完する。 */
export function resolveDiagnosticContext(
  test: TestCase
): FailureDiagnosticContext {
  return diagnosticContext(test) ?? fallbackDiagnosticContext(test);
}

export default class FailureDiagnosticsReporter implements Reporter {
  async onTestEnd(test: TestCase, result: TestResult): Promise<void> {
    if (result.status === test.expectedStatus) return;
    const context = resolveDiagnosticContext(test);
    try {
      await writeFailureDiagnosticManifest({
        attachments: result.attachments,
        context,
        errors: result.errors,
      });
      console.error(`[e2e diagnostics] manifest: ${context.manifestPath}`);
    } catch (error) {
      console.error(
        `[e2e diagnostics] manifest出力に失敗しました: ${String(error)}`
      );
    }
  }
}
