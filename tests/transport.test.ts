import { describe, expect, it } from "vitest";
import { TidbytCloudTransport, type DisplayPushOptions } from "../src/core/transport.js";
import { FakeRenderer } from "./helpers/fakes.js";
import { clockPanel } from "../src/core/panels.js";
const options: DisplayPushOptions = { apiToken: "secret-token", deviceId: "device/id", installationId: "tidbytrmain", background: true };
const frame = () => new FakeRenderer().render(clockPanel(new Date().toISOString(), "UTC"));

describe("Tidbyt API delivery", () => {
  it("sends authenticated base64 WebP to a stable installation in background or foreground", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const transport = new TidbytCloudTransport({ fetchImpl: async (url, init) => { requests.push({ url: String(url), init }); return new Response(null, { status: 200 }); } });
    const rendered = await frame();
    expect(await transport.push(rendered, options)).toMatchObject({ ok: true, delivery: "tidbyt-cloud", attemptCount: 1 });
    await transport.push(rendered, { ...options, background: false });
    expect(requests[0]!.url).toBe("https://api.tidbyt.com/v0/devices/device%2Fid/push");
    expect(requests[0]!.init?.headers).toMatchObject({ Authorization: "Bearer secret-token" });
    expect(JSON.parse(String(requests[0]!.init?.body))).toEqual({ image: rendered.webp.toString("base64"), installationID: "tidbytrmain", background: true });
    expect(JSON.parse(String(requests[1]!.init?.body))).toMatchObject({ installationID: "tidbytrmain", background: false });
  });
  it("removes only the configured installation and accepts an already absent installation", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const transport = new TidbytCloudTransport({ fetchImpl: async (url, init) => {
      requests.push({ url: String(url), init });
      return new Response(null, { status: 404 });
    } });
    await transport.remove(options);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      url: "https://api.tidbyt.com/v0/devices/device%2Fid/installations/tidbytrmain",
      init: { method: "DELETE", headers: { Authorization: "Bearer secret-token" } },
    });
  });
  it("retries transient failures but not authentication errors, without exposing response bodies", async () => {
    let calls = 0;
    const transient = new TidbytCloudTransport({ fetchImpl: async () => new Response("secret-token", { status: ++calls < 3 ? 503 : 200 }) });
    expect(await transient.push(await frame(), options)).toMatchObject({ ok: true, attemptCount: 3 });
    calls = 0;
    const unauthorized = new TidbytCloudTransport({ fetchImpl: async () => { calls++; return new Response("secret-token", { status: 401 }); } });
    expect(await unauthorized.push(await frame(), options)).toMatchObject({ ok: false, status: 401, attemptCount: 1, message: "Tidbyt API returned HTTP 401" });
    expect(calls).toBe(1);
  });
  it("bounds hangs and retry counts, including rate limits", async () => {
    const hung = new TidbytCloudTransport({ timeoutMs: 10, maxAttempts: 1, fetchImpl: () => new Promise(() => {}) });
    expect(await hung.push(await frame(), options)).toMatchObject({ ok: false, status: 0, attemptCount: 1 });
    const limited = new TidbytCloudTransport({ maxAttempts: 2, fetchImpl: async () => new Response(null, { status: 429 }) });
    expect(await limited.push(await frame(), options)).toMatchObject({ ok: false, status: 429, attemptCount: 2 });
  });
  it("does not send invalid frames, missing credentials, or obsolete work", async () => {
    let calls = 0;
    const transport = new TidbytCloudTransport({ fetchImpl: async () => { calls++; return new Response(null, { status: 503 }); } });
    const rendered = await frame();
    expect(await transport.push(rendered, { ...options, apiToken: "" })).toMatchObject({ ok: false, attemptCount: 0 });
    await expect(transport.push({ ...rendered, webp: Buffer.from("invalid") }, options)).rejects.toThrow();
    expect(await transport.push(rendered, { ...options, isCurrent: () => false })).toMatchObject({ ok: false, attemptCount: 0 });
    expect(calls).toBe(0);
    expect(await transport.push(rendered, { ...options, isCurrent: () => calls === 0 })).toMatchObject({ ok: false, attemptCount: 1, message: "Superseded push" });
    expect(calls).toBe(1);
  });
});
