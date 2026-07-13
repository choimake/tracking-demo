import { DEFAULT_WAIT_TIMEOUT_MS } from "../harness/config.js";
import { assertionError } from "./assertion-formatter.js";
import { WaitTimeoutError, waitForCondition } from "./polling.js";

/** このモジュールは、tracker log の期待文字列を期限内に検証する。 */

export async function expectTrackerLogContains(
  trackerLogs: string[],
  substring: string,
  label: string,
  sinceIndex = 0,
  timeoutMs = DEFAULT_WAIT_TIMEOUT_MS
): Promise<void> {
  try {
    await waitForCondition(
      label,
      async () => {
        const logs = trackerLogs.slice(sinceIndex);
        return {
          actual: logs,
          ready: logs.some((line) => line.includes(substring)),
        };
      },
      timeoutMs
    );
  } catch (error) {
    if (error instanceof WaitTimeoutError) {
      const actualLogs = trackerLogs.slice(sinceIndex);
      throw assertionError(
        {
          actual: { logs: actualLogs },
          context: { label, sinceIndex, timeoutDiagnostic: error.message },
          expected: { substring },
          name: "tracker-log-contains",
          summary: `tracker log が期待文字列を含みません: actual=${JSON.stringify(actualLogs)} expectedSubstring=${JSON.stringify(substring)}; ${error.message}`,
        },
        error
      );
    }
    throw error;
  }
}
