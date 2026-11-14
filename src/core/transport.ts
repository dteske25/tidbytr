import type { FrameBundle, PublishResult } from "./types.js";
import { validateDisplayFrame } from "./publisher.js";
import { withDeadline } from "../providers/http.js";

export interface DisplayPushOptions {
  apiToken: string;
  deviceId: string;
  installationId: string;
  background: boolean;
  isCurrent?: () => boolean;
}
export interface DisplayTransport {
  push(frame: FrameBundle, options: DisplayPushOptions): Promise<PublishResult>;
  remove(options: Pick<DisplayPushOptions, "apiToken" | "deviceId" | "installationId">): Promise<void>;
}
export class TidbytCloudTransport implements DisplayTransport {
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  constructor(options: { fetchImpl?: typeof fetch; baseUrl?: string; timeoutMs?: number; maxAttempts?: number } = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.baseUrl = options.baseUrl ?? "https://api.tidbyt.com/v0";
    this.timeoutMs = options.timeoutMs ?? 4000;
    this.maxAttempts = options.maxAttempts ?? 3;
  }
  async remove({ apiToken, deviceId, installationId }: Pick<DisplayPushOptions, "apiToken" | "deviceId" | "installationId">): Promise<void> {
    const status = await withDeadline(async () => {
      const response = await this.fetchImpl(
        `${this.baseUrl}/devices/${encodeURIComponent(deviceId)}/installations/${encodeURIComponent(installationId)}`,
        { method: "DELETE", headers: { Authorization: `Bearer ${apiToken}` }, signal: AbortSignal.timeout(this.timeoutMs), redirect: "error" },
      );
      await response.body?.cancel();
      return response.status;
    }, this.timeoutMs);
    if ((status < 200 || status >= 300) && status !== 404) throw new Error(`Tidbyt API returned HTTP ${status} while clearing the display`);
  }
  async push(frame: FrameBundle, options: DisplayPushOptions): Promise<PublishResult> {
    await validateDisplayFrame(frame);
    const result = (ok: boolean, status: number, message: string, attemptCount: number): PublishResult => ({
      ok, status, message, attemptCount, publishedAt: new Date().toISOString(),
      renderedAt: frame.renderedAt, panelId: frame.panelId, delivery: "tidbyt-cloud",
      deviceId: options.deviceId, installationId: options.installationId,
    });
    if (!options.apiToken || !options.deviceId) return result(false, 0, "Configure tidbyt_api_token and tidbyt_device_id", 0);
    const body = JSON.stringify({ image: frame.webp.toString("base64"), installationID: options.installationId, background: options.background });
    let status = 0;
    let message = "Tidbyt API request failed or timed out";
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      if (options.isCurrent && !options.isCurrent()) return result(false, status, "Superseded push", attempt - 1);
      try {
        status = await withDeadline(async () => {
          const response = await this.fetchImpl(`${this.baseUrl}/devices/${encodeURIComponent(options.deviceId)}/push`, {
            method: "POST", headers: { Authorization: `Bearer ${options.apiToken}`, "Content-Type": "application/json" },
            body, signal: AbortSignal.timeout(this.timeoutMs), redirect: "error",
          });
          // Upstream response bodies and exception messages may contain secrets.
          await response.body?.cancel();
          return response.status;
        }, this.timeoutMs);
        if (status >= 200 && status < 300) return result(true, status, "Accepted by Tidbyt API", attempt);
        message = `Tidbyt API returned HTTP ${status}`;
        if (status !== 429 && status < 500) return result(false, status, message, attempt);
      } catch {
        status = 0;
        message = "Tidbyt API request failed or timed out";
      }
      if (attempt < this.maxAttempts) await new Promise((resolve) => setTimeout(resolve, 100 * 2 ** (attempt - 1) + Math.random() * 100));
    }
    return result(false, status, message, this.maxAttempts);
  }
}
