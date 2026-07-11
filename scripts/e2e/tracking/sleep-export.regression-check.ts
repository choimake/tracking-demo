import { runCorrelationRegressionCheck } from "./correlation.regression-check.js";
/**
 * tracking barrel が sleep を再公開しないことの型レベル assert。
 * 実行時ブラウザは不要。`npm run typecheck` で検証される。
 */
import * as tracking from "./index.js";

/** sleep が tracking から再公開されると never になり typecheck が落ちる */
type _SleepNotReexported = "sleep" extends keyof typeof tracking ? never : true;

const _checks: [_SleepNotReexported] = [true];

void _checks;
void tracking;

if (process.env.E2E_RUN_CORRELATION_REGRESSION === "1") {
  await runCorrelationRegressionCheck();
}
