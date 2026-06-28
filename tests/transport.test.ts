import { describe, expect, it } from "vitest";
import { TidbytCloudTransport } from "../src/core/transport.js";
import type { FrameBundle } from "../src/core/types.js";

describe("TidbytCloudTransport", () => {
  it("posts WebP payload with token and installation ID", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const transport = new TidbytCloudTransport({
      baseUrl: "https://fake.tidbyt.test/v0",
      fetchImpl: async (input, init) => {
        requests.push({ url: String(input), init: init ?? {} });
        return new Response("{}", { status: 200 });
      },
    });

    const result = await transport.push(frame(), {
      apiToken: "secret",
      deviceId: "dev123",
      installationId: "tidbytr-main",
    });

    expect(result.ok).toBe(true);
    expect(requests[0]?.url).toBe("https://fake.tidbyt.test/v0/devices/dev123/push");
    expect(requests[0]?.init.headers).toMatchObject({ Authorization: "Bearer secret" });
    expect(JSON.parse(String(requests[0]?.init.body))).toMatchObject({
      image: Buffer.from("webp").toString("base64"),
      installationID: "tidbytr-main",
    });
  });

  it("retries transient failures", async () => {
    let attempts = 0;
    const transport = new TidbytCloudTransport({
      maxAttempts: 2,
      fetchImpl: async () => {
        attempts += 1;
        return new Response("later", { status: attempts === 1 ? 503 : 200 });
      },
    });

    const result = await transport.push(frame(), {
      apiToken: "secret",
      deviceId: "dev123",
      installationId: "tidbytr-main",
    });

    expect(result.ok).toBe(true);
    expect(result.attemptCount).toBe(2);
  });
});

function frame(): FrameBundle {
  return {
    panelId: "clock",
    width: 64,
    height: 32,
    mimeType: "image/webp",
    webp: Buffer.from("webp"),
    renderedAt: "2026-06-28T12:00:00.000Z",
  };
}
