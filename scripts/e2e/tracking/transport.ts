import {
  DEFAULT_WAIT_TIMEOUT_MS,
  getTrackingOrigin,
  registeredAbortSignal,
} from "../harness/config.js";
import { parseJsonResponse } from "./response-parser.js";

/** このモジュールは、計測 API への HTTP 要求と応答期限を管理する。 */

export class TrackingTransport {
  constructor(
    private readonly trackingOrigin = getTrackingOrigin(),
    private readonly requestTimeoutMs = DEFAULT_WAIT_TIMEOUT_MS
  ) {}

  async fetchTracking<T = unknown>(
    path: string,
    opts: RequestInit = {}
  ): Promise<T> {
    const method = opts.method ?? "GET";
    const timeoutSignal = registeredAbortSignal(
      "tracking-fetch-deadline",
      this.requestTimeoutMs
    );
    const signal = opts.signal
      ? AbortSignal.any([opts.signal, timeoutSignal])
      : timeoutSignal;
    let res: Response;
    let text: string;
    try {
      res = await fetch(this.trackingOrigin + path, {
        headers: { "Content-Type": "application/json" },
        ...opts,
        signal,
      });
      if (!res.ok) {
        throw new Error(`${method} ${path} -> HTTP ${res.status}`);
      }
      text = await res.text();
    } catch (error) {
      if (timeoutSignal.aborted) {
        throw new Error(
          `${method} ${path} が timeout: expected=${this.requestTimeoutMs}ms以内のHTTP応答 actual=応答なし`,
          { cause: error }
        );
      }
      throw error;
    }
    return parseJsonResponse<T>(text, method, path);
  }
}
