import { describe, expect, it } from "vitest";
import { buildApp } from "../src/server/app.js";
import { TidbytrStore } from "../src/storage/store.js";
import { FakeSportsProvider, FakeTransport, FakeWeatherProvider, testConfig } from "./helpers/fakes.js";

describe("api", () => {
  it("returns status and panels", async () => {
    const app = await makeApp();
    const status = await app.inject({ method: "GET", url: "/api/status" });
    const panels = await app.inject({ method: "GET", url: "/api/panels" });

    expect(status.statusCode).toBe(200);
    expect(status.json().display.currentPanel).toBeTruthy();
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

  it("pushes, skips, and snoozes", async () => {
    const transport = new FakeTransport();
    const app = await makeApp(transport);

    const push = await app.inject({ method: "POST", url: "/api/actions/push", payload: { panelId: "forecast" } });
    const skip = await app.inject({ method: "POST", url: "/api/actions/skip", payload: { panelId: "forecast" } });
    const snooze = await app.inject({ method: "POST", url: "/api/actions/snooze", payload: { minutes: 5 } });

    expect(push.statusCode).toBe(200);
    expect(transport.pushes).toHaveLength(1);
    expect(skip.json().result).toBe("skipped");
    expect(snooze.json().reason).toBe("Snoozed for 5 minutes");
    await app.close();
  });
});

async function makeApp(transport = new FakeTransport()) {
  return buildApp({
    config: testConfig(),
    store: new TidbytrStore(":memory:"),
    weatherProvider: new FakeWeatherProvider({
      alerts: [],
      forecast: { temperature: 72, shortForecast: "Partly Cloudy", windSpeed: "6 mph", high: 74, low: 52 },
    }),
    sportsProvider: new FakeSportsProvider({
      games: [{ id: "kc-live", team: "KC", opponent: "DEN", startsAt: "2026-06-28T18:00:00.000Z", status: "live", teamScore: 14, opponentScore: 10 }],
    }),
    transport,
  });
}
