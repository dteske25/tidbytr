import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { DisplayRenderer } from "../src/renderer/types.js";
import { LocalDisplayPublisher } from "../src/core/publisher.js";
import { buildApp, buildDisplayApp } from "../src/server/app.js";
import { TidbytrStore } from "../src/storage/store.js";
import { FakeRenderer, FakeSportsProvider, FakeWeatherProvider, testConfig } from "./helpers/fakes.js";

describe("api", () => {
  it("returns status and panels", async () => {
    const app = await makeApp();
    const status = await app.inject({ method: "GET", url: "/api/status" });
    const panels = await app.inject({ method: "GET", url: "/api/panels" });

    expect(status.statusCode).toBe(200);
    expect(status.json().scheduler.nextPanel).toBeTruthy();
    expect(panels.json().panels.length).toBeGreaterThan(1);
    await app.close();
  });

  it("validates config updates", async () => {
    const app = await makeApp();
    const bad = await app.inject({
      method: "PUT",
      url: "/api/config",
      payload: { latitude: 999 },
    });
    expect(bad.statusCode).toBe(400);

    const good = await app.inject({
      method: "PUT",
      url: "/api/config",
      payload: { latitude: 40, longitude: -95, nwsContact: "test@example.com" },
    });
    expect(good.statusCode).toBe(200);
    expect(good.json().latitude).toBe(40);
    await app.close();
  });

  it("serves a WebP preview", async () => {
    const app = await makeApp();
    const preview = await app.inject({ method: "GET", url: "/api/panels/forecast/preview.webp" });

    expect(preview.statusCode).toBe(200);
    expect(preview.headers["content-type"]).toContain("image/webp");
    expect(preview.rawPayload.length).toBeGreaterThan(20);
    await app.close();
  });

  it("returns a concise 500 when preview rendering fails", async () => {
    const app = await makeApp({}, new FailingRenderer("pixlet missing"));
    const preview = await app.inject({ method: "GET", url: "/api/panels/forecast/preview.webp" });

    expect(preview.statusCode).toBe(500);
    expect(preview.json()).toMatchObject({
      error: "Render failed",
      message: "pixlet missing",
    });
    await app.close();
  });

  it("publishes, skips, and snoozes", async () => {
    const app = await makeApp();

    const push = await app.inject({ method: "POST", url: "/api/actions/push", payload: { panelId: "forecast" } });
    const skip = await app.inject({ method: "POST", url: "/api/actions/skip", payload: { panelId: "forecast" } });
    const snooze = await app.inject({ method: "POST", url: "/api/actions/snooze", payload: { minutes: 5 } });

    expect(push.statusCode).toBe(200);
    expect(push.json().decision.result).toBe("published");
    expect(fs.existsSync(path.join(app.dataDir, "display", "current.webp"))).toBe(true);
    expect(skip.json().result).toBe("skipped");
    expect(snooze.json().reason).toBe("Snoozed for 5 minutes");
    await app.close();
  });

  it("runs scheduled publishes in the background", async () => {
    const app = await makeApp({ schedulerIntervalSeconds: 0.01 });

    await waitFor(() => fs.existsSync(path.join(app.dataDir, "display", "current.webp")));

    const status = await app.inject({ method: "GET", url: "/api/status" });
    expect(status.json().display.lastPublish.panelId).toBeTruthy();
    await app.close();
  });

  it("records scheduled render failures as not shown", async () => {
    const app = await makeApp({ schedulerIntervalSeconds: 0.01 }, new FailingRenderer("render timeout"));

    await waitFor(async () => {
      const status = await app.inject({ method: "GET", url: "/api/status" });
      return status.json().decisions.some((decision: { result: string; reason: string }) => decision.result === "not-shown" && decision.reason === "render timeout");
    });

    await app.close();
  });

  it("serves the current WebP on the display listener and records pulls", async () => {
    const app = await makeApp();
    const displayApp = await buildDisplayApp(app.runtime);
    const current = await displayApp.inject({ method: "GET", url: "/current.webp" });
    const hiddenApi = await displayApp.inject({ method: "GET", url: "/api/status" });
    const status = await app.inject({ method: "GET", url: "/api/status" });

    expect(current.statusCode).toBe(200);
    expect(current.headers["content-type"]).toContain("image/webp");
    expect(current.headers["cache-control"]).toBe("no-store");
    expect(current.rawPayload.length).toBeGreaterThan(20);
    expect(hiddenApi.statusCode).toBe(404);
    expect(status.json().display.lastPull).toBeTruthy();
    expect(status.json().display.online).toBe(true);
    await displayApp.close();
    await app.close();
  });

  it("keeps the previous current frame when a later publish fails", async () => {
    const renderer = new FlakyRenderer();
    const app = await makeApp({}, renderer);

    const first = await app.inject({ method: "POST", url: "/api/actions/push", payload: { panelId: "forecast" } });
    expect(first.statusCode).toBe(200);
    const framePath = path.join(app.dataDir, "display", "current.webp");
    const original = fs.readFileSync(framePath);

    const second = await app.inject({ method: "POST", url: "/api/actions/push", payload: { panelId: "forecast" } });
    expect(second.statusCode).toBe(400);
    expect(fs.readFileSync(framePath)).toEqual(original);
    await app.close();
  });
});

async function makeApp(configOverrides = {}, renderer: DisplayRenderer = new FakeRenderer()) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "tidbytr-api-test-"));
  const app = await buildApp({
    startScheduler: "schedulerIntervalSeconds" in configOverrides,
    config: testConfig({ dataDir, ...configOverrides }),
    store: new TidbytrStore(":memory:"),
    weatherProvider: new FakeWeatherProvider({
      alerts: [],
      forecast: { temperature: 72, shortForecast: "Partly Cloudy", windSpeed: "6 mph", high: 74, low: 52 },
    }),
    sportsProvider: new FakeSportsProvider({
      games: [{ id: "kc-live", team: "KC", opponent: "DEN", startsAt: "2026-06-28T18:00:00.000Z", status: "live", teamScore: 14, opponentScore: 10 }],
    }),
    publisher: new LocalDisplayPublisher({ dataDir }),
    renderer,
  });
  await app.runtime.refreshSources();
  return Object.assign(app, { dataDir });
}

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 500): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for condition");
}

class FailingRenderer implements DisplayRenderer {
  constructor(private readonly message: string) {}

  async render(): Promise<never> {
    throw new Error(this.message);
  }
}

class FlakyRenderer extends FakeRenderer {
  private calls = 0;

  override async render(...args: Parameters<DisplayRenderer["render"]>) {
    this.calls += 1;
    if (this.calls > 1) {
      throw new Error("render timeout");
    }

    return super.render(...args);
  }
}
