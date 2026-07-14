import { AsyncLocalStorage } from "node:async_hooks";

export const ASSERTION_FAILURE_MARKER = "E2E_ASSERTION_FAILURE=";

export interface AssertionScenarioContext {
  browser: string;
  correlationId: string;
  hitCursor: {
    captured: boolean;
    value: string | null;
  };
  repeat: number;
  scenarioId: string;
  seed: number | null;
}

export interface AssertionFailureDetails {
  actual: unknown;
  context: AssertionScenarioContext & Record<string, unknown>;
  expected: unknown;
  name: string;
}

export interface AssertionFailureInput {
  actual: unknown;
  context?: Record<string, unknown>;
  expected: unknown;
  name: string;
  summary: string;
}

const assertionContext = new AsyncLocalStorage<AssertionScenarioContext>();

function fallbackContext(): AssertionScenarioContext {
  return {
    browser: "unknown",
    correlationId: "unknown",
    hitCursor: { captured: false, value: null },
    repeat: 0,
    scenarioId: "unknown",
    seed: null,
  };
}

/** シナリオの非同期処理へ共通assertion contextを関連付ける。 */
export function runWithAssertionContext<T>(
  context: Omit<AssertionScenarioContext, "hitCursor">,
  callback: () => Promise<T>
): Promise<T> {
  return assertionContext.run(
    { ...context, hitCursor: { captured: false, value: null } },
    callback
  );
}

/** 最後に取得したHit cursorを現在のassertion contextへ記録する。 */
export function recordAssertionHitCursor(value: string | undefined): void {
  const context = assertionContext.getStore();
  if (!context) return;
  context.hitCursor = { captured: true, value: value ?? null };
}

/** actual、expected、scenario contextを機械可読な形式で整形する。 */
export function formatAssertionFailure(input: AssertionFailureInput): string {
  const details: AssertionFailureDetails = {
    actual: input.actual,
    context: {
      ...(assertionContext.getStore() ?? fallbackContext()),
      ...input.context,
    },
    expected: input.expected,
    name: input.name,
  };
  return `${input.summary}; ${ASSERTION_FAILURE_MARKER}${JSON.stringify(details)}`;
}

/** 構造化した共通assertion errorを生成する。 */
export function assertionError(
  input: AssertionFailureInput,
  cause?: unknown
): Error {
  return new Error(
    formatAssertionFailure(input),
    cause === undefined ? undefined : { cause }
  );
}
