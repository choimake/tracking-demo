import { runAssertionsRegressionContract } from "./assertions.regression-contract.js";
import * as assertions from "./index.js";

export async function runAssertionsRegressionCheck(): Promise<void> {
  await runAssertionsRegressionContract(assertions);
  console.log("assertions regression check: PASS");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await runAssertionsRegressionCheck();
}
