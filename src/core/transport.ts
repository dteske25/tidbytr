import type { DisplayPushOptions, DisplayTransport, FrameBundle, PushResult } from "./types.js";

export interface TidbytCloudTransportOptions {
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  maxAttempts?: number;
}

export class TidbytCloudTransport implements DisplayTransport {
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly maxAttempts: number;

  constructor(options: TidbytCloudTransportOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.baseUrl = options.baseUrl ?? "https://api.tidbyt.com/v0";
    this.maxAttempts = options.maxAttempts ?? 3;
  }

  async push(frame: FrameBundle, options: DisplayPushOptions): Promise<PushResult> {
    const endpoint = `${this.baseUrl}/devices/${encodeURIComponent(options.deviceId)}/push`;
    const body = JSON.stringify({
      image: frame.webp.toString("base64"),
      installationID: options.installationId,
      background: false,
    });
    let lastStatus = 0;
    let lastMessage = "No response";
    let attemptsMade = 0;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      attemptsMade = attempt;
      try {
        const response = await this.fetchImpl(endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${options.apiToken}`,
            "Content-Type": "application/json",
          },
          body,
        });
        lastStatus = response.status;

        if (response.ok) {
          return {
            ok: true,
            status: response.status,
            message: "Pushed",
            attemptCount: attempt,
            pushedAt: new Date().toISOString(),
          };
        }

        lastMessage = await response.text().catch(() => response.statusText);
        if (response.status < 500 && response.status !== 429) {
          break;
        }
      } catch (error) {
        lastMessage = error instanceof Error ? error.message : "Unknown transport error";
      }
    }

    return {
      ok: false,
      status: lastStatus,
      message: lastMessage,
      attemptCount: attemptsMade,
      pushedAt: new Date().toISOString(),
    };
  }
}
