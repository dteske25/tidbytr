import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildPanels, type WeatherSnapshot } from "../src/core/panels.js";
import { DEFAULT_SCREEN_POLICY } from "../src/core/policy.js";
import { LocalDisplayPublisher } from "../src/core/publisher.js";
import { choosePanel as selectPanel, defaultSchedulerState, recordShown } from "../src/core/scheduler.js";
import { NwsProvider } from "../src/providers/nws.js";
import { EspnSportsProvider } from "../src/providers/sports.js";
import { TidbytCloudTransport } from "../src/core/transport.js";
import { TidbytrRuntime } from "../src/server/runtime.js";
import { TidbytrStore } from "../src/storage/store.js";
import { FakeCloudTransport, FakeRenderer, FakeSportsProvider, FakeWeatherProvider, testConfig } from "./helpers/fakes.js";

const choosePanel = (request: Parameters<typeof selectPanel>[0]) => selectPanel({ ...request, policy: request.policy ?? testConfig().screenPolicy });

const now = new Date("2026-10-16T12:00:00Z");
const after = (seconds: number) => new Date(now.getTime() + seconds * 1000);
const weather: WeatherSnapshot = { alerts: [], forecast: { temperature: 0, shortForecast: "Cold" } };
const warning = { id: "tornado", event: "Tornado Warning", severity: "warning" as const, headline: "Seek shelter", expiresAt: after(3600).toISOString() };
const active: Array<{ runtime: TidbytrRuntime; dataDir: string }> = [];
function makeRuntime(options: Partial<ConstructorParameters<typeof TidbytrRuntime>[0]> = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "tidbytr-reliability-"));
  const runtime = new TidbytrRuntime({
    config: testConfig({ dataDir }), store: new TidbytrStore(":memory:"),
    weatherProvider: new FakeWeatherProvider(weather), sportsProvider: new FakeSportsProvider({ games: [] }),
    renderer: new FakeRenderer(), transport: new FakeCloudTransport(), ...options,
  });
  active.push({ runtime, dataDir });
  return runtime;
}
afterEach(async () => {
  for (const { runtime, dataDir } of active.splice(0)) {
    await runtime.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

describe("reliable display lifecycle", () => {
  it("publishes and serves a clock while a source is hung, then times out the refresh", async () => {
    const runtime = makeRuntime({ weatherProvider: { getSnapshot: () => new Promise(() => {}) }, sourceTimeoutMs: 30 });
    const refresh = runtime.refreshSources(now);
    const result = await runtime.publish(undefined, now);
    expect(result.panel?.id).toBe("clock");
    expect((await runtime.getPublishedPreview())!.length).toBeGreaterThan(20);
    await refresh;
    expect((await runtime.getStatus(now)).sourceHealth.find((health) => health.id === "nws")?.detail).toContain("timed out");
  });

  it("makes dashboard reads passive and reports the published panel rather than another candidate", async () => {
    let calls = 0;
    const runtime = makeRuntime({ weatherProvider: { async getSnapshot() { calls++; return new FakeWeatherProvider(weather).getSnapshot(now); } } });
    await runtime.refreshSources(now);
    await runtime.publish("clock", now);
    await runtime.getPanels(now);
    await runtime.preview("forecast", now);
    const status = await runtime.getStatus(now);
    expect(calls).toBe(1);
    expect(status.display.currentPanel?.id).toBe("clock");
    expect(status.display.currentFrame?.panelId).toBe("clock");
    await runtime.getPublishedPreview();
    expect((await runtime.getStatus(now)).display.apiAccepted).toBe(true);
  });

  it("prevents an old render from replacing a new critical frame", async () => {
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const entered = new Promise<void>((resolve) => { started = resolve; });
    const snapshot = { ...weather, alerts: [] as typeof warning[] };
    const fake = new FakeRenderer();
    const runtime = makeRuntime({ weatherProvider: new FakeWeatherProvider(snapshot), renderer: { async render(panel, time, config) {
      if (panel.id === "forecast") { started(); await gate; }
      return fake.render(panel, time, config);
    } } });
    await runtime.refreshSources(now);
    const older = runtime.publish(undefined, now);
    await entered;
    snapshot.alerts = [warning];
    await runtime.refreshSources(now);
    expect((await runtime.publish(undefined, now)).panel?.id).toBe("nws-tornado");
    release();
    expect((await older).decision.reason).toBe("Superseded render");
    expect((await runtime.getStatus(now)).display.currentFrame?.panelId).toBe("nws-tornado");
  });

  it("keeps a manual hold when a background publication supersedes its render", async () => {
    let release!: () => void;
    let entered!: () => void;
    let renders = 0;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const fake = new FakeRenderer();
    const runtime = makeRuntime({ renderer: { async render(panel, time, config) {
      if (++renders === 1) { entered(); await gate; }
      return fake.render(panel, time, config);
    } } });
    await runtime.refreshSources(now);
    const manual = runtime.publish("clock", now);
    await started;
    expect((await runtime.publish(undefined, now)).panel?.id).toBe("clock");
    release();
    await manual;
    expect((await runtime.getStatus(now)).scheduler.manualHold?.panelId).toBe("clock");
  });

  it("expires live data and updates clock imagery on scheduled pushes", async () => {
    const runtime = makeRuntime({ weatherProvider: new FakeWeatherProvider({ forecast: null, alerts: [] }), sportsProvider: new FakeSportsProvider({ games: [{ id: "game", team: "KC", opponent: "DEN", status: "live", startsAt: now.toISOString() }] }) });
    await runtime.refreshSources(now);
    await runtime.publish(undefined, now);
    await runtime.publish(undefined, after(91));
    expect((await runtime.getStatus(after(91))).display.currentPanel?.kind).toBe("clock");
    await runtime.publish(undefined, after(24 * 3600));
    const status = await runtime.getStatus(after(24 * 3600));
    expect(status.display.fresh).toBe(true);
    expect(status.display.currentFrame?.renderedAt).toBe(after(24 * 3600).toISOString());
  });

  it("immediately applies snooze and consumes skip after one successful replacement", async () => {
    const runtime = makeRuntime();
    await runtime.refreshSources(now);
    await runtime.publish("forecast", now);
    await runtime.skip(undefined, now);
    expect((await runtime.getStatus(now)).display.currentPanel?.id).toBe("clock");
    expect((await runtime.getStatus(now)).scheduler.skippedPanelIds).toEqual([]);
    await runtime.publish("forecast", after(30));
    await runtime.snooze(5, after(30));
    expect((await runtime.getStatus(after(30))).display.currentPanel?.id).toBe("clock");
    expect((await runtime.getStatus(after(30))).scheduler.manualHold).toBeNull();
  });

  it("does not query disabled providers and repairs the local preview on publication", async () => {
    let calls = 0;
    const runtime = makeRuntime({ weatherProvider: { async getSnapshot(time = now) { calls++; return new FakeWeatherProvider(weather).getSnapshot(time); } } });
    await runtime.refreshSources(now);
    await runtime.publish("forecast", now);
    await runtime.setSourceEnabled("nws", false, now);
    await runtime.refreshSources(after(1));
    expect(calls).toBe(1);
    expect((await runtime.getStatus(now)).display.currentPanel?.id).toBe("clock");
    fs.writeFileSync(path.join(runtime.getRuntimeConfig().dataDir, "display", "current.webp"), "mismatched file");
    expect(await runtime.getPublishedPreview()).toBeNull();
    await runtime.publish(undefined, after(1));
    expect((await runtime.getPublishedPreview())!.subarray(8, 12).toString()).toBe("WEBP");
    expect((await runtime.getStatus(after(1))).display.fresh).toBe(true);
  });

  it("falls back for invalid renderer bytes without serving a corrupt frame", async () => {
    const runtime = makeRuntime({ renderer: new FakeRenderer(Buffer.from("invalid renderer output")) });
    await runtime.publish(undefined, now);
    expect((await runtime.getPublishedPreview())!.subarray(8, 12).toString()).toBe("WEBP");
    expect((await runtime.getStatus(now)).display.degradedReason).toBeTruthy();
  });

  it("uses a fresh degraded clock when rendering fails", async () => {
    const runtime = makeRuntime({ renderer: { async render() { throw new Error("pixlet down"); } } });
    await runtime.refreshSources(now);
    await runtime.publish(undefined, now);
    const status = await runtime.getStatus(now);
    expect(status.display.currentPanel?.id).toBe("clock");
    expect(status.display.degradedReason).toBe("pixlet down");
    expect((await runtime.getPublishedPreview())!.length).toBeGreaterThan(20);
  });

  it("expires manual holds and lets critical alerts interrupt them", async () => {
    const snapshot = { ...weather, alerts: [] as typeof warning[] };
    const runtime = makeRuntime({ weatherProvider: new FakeWeatherProvider(snapshot) });
    await runtime.refreshSources(now);
    await runtime.publish("clock", now);
    expect((await runtime.publish(undefined, after(59))).panel?.id).toBe("clock");
    expect((await runtime.publish(undefined, after(60))).panel?.id).toBe("forecast");
    await runtime.publish("clock", after(61));
    snapshot.alerts = [warning];
    await runtime.refreshSources(after(62));
    expect((await runtime.publish(undefined, after(62))).panel?.id).toBe("nws-tornado");
    const current = new Date();
    snapshot.alerts = [{ ...warning, expiresAt: new Date(current.getTime() + 3600_000).toISOString() }];
    await runtime.refreshSources(current);
    await runtime.updateConfig({ screenPolicy: { ...DEFAULT_SCREEN_POLICY, minimumDwellSeconds: 30 } });
    expect((await runtime.getStatus()).display.currentPanel?.id).toBe("nws-tornado");
  });

  it("uses background rotation updates and foreground requests for manual shows and critical alerts", async () => {
    const transport = new FakeCloudTransport();
    const snapshot = { ...weather, alerts: [] as typeof warning[] };
    const runtime = makeRuntime({ transport, weatherProvider: new FakeWeatherProvider(snapshot) });
    await runtime.refreshSources(now);
    await runtime.publish(undefined, now);
    await runtime.publish("clock", after(20));
    snapshot.alerts = [warning];
    await runtime.refreshSources(after(21));
    await runtime.publish(undefined, after(21));
    expect(transport.calls.map((call) => call.options.background)).toEqual([true, false, false]);
    expect(transport.calls[2]?.frame.panelId).toBe("nws-tornado");
  });

  it("preserves selection history, preview, and previous manual hold on cloud failure", async () => {
    const transport = new FakeCloudTransport();
    const store = new TidbytrStore(":memory:");
    const runtime = makeRuntime({ transport, store });
    await runtime.refreshSources(now);
    await runtime.publish("clock", now);
    const preview = await runtime.getPublishedPreview();
    const history = store.getSchedulerState(null).history;
    transport.push = async (frame, options) => ({ ok: false, status: 401, message: "Tidbyt API returned HTTP 401", attemptCount: 1,
      publishedAt: now.toISOString(), renderedAt: frame.renderedAt, panelId: frame.panelId,
      delivery: "tidbyt-cloud", deviceId: options.deviceId, installationId: options.installationId });
    await expect(runtime.publish("forecast", after(20))).rejects.toThrow("HTTP 401");
    expect(await runtime.getPublishedPreview()).toEqual(preview);
    expect(store.getSchedulerState(null).history).toEqual(history);
    const status = await runtime.getStatus(after(20));
    expect(status.display.apiAccepted).toBe(false);
    expect(status.display.currentPanel?.id).toBe("clock");
    expect(status.display.lastPublish?.ok).toBe(false);
    expect(status.scheduler.manualHold?.panelId).toBe("clock");
  });

  it("saves settings without credentials and reports delivery failure without advancing history", async () => {
    const store = new TidbytrStore(":memory:");
    const runtime = makeRuntime({ config: testConfig({ tidbytApiToken: "", tidbytDeviceId: "" }), store, transport: new TidbytCloudTransport() });
    expect(await runtime.updateConfig({ timezone: "UTC" })).toMatchObject({ timezone: "UTC", apiTokenConfigured: false });
    const status = await runtime.getStatus();
    expect(status.display).toMatchObject({ configured: false, apiAccepted: false, currentFrame: null });
    expect(status.display.lastPublish).toMatchObject({ ok: false, attemptCount: 0 });
    expect(store.getSchedulerState(null).history).toEqual({});
    await expect(runtime.publish("clock")).rejects.toThrow("Configure tidbyt_api_token");
  });

  it("migrates HDK settings and frames without hiding baseline credentials or key rotation", async () => {
    const store = new TidbytrStore(":memory:");
    const { tidbytApiToken, tidbytDeviceId, installationId, ...legacy } = testConfig();
    store.setOptions(legacy as never);
    const oldPanel = buildPanels(testConfig(), weather, { games: [] }, now)[0]!;
    store.setPublishedFrame({ panel: oldPanel, renderedAt: now.toISOString(), validUntil: after(60).toISOString(), sha256: "legacy" });
    const runtime = makeRuntime({ config: testConfig({ tidbytApiToken: "new-secret" }), store });
    await new LocalDisplayPublisher({ dataDir: runtime.getRuntimeConfig().dataDir }).publish(await new FakeRenderer().render(oldPanel, now));
    expect(runtime.getRuntimeConfig().tidbytApiToken).toBe("new-secret");
    expect(runtime.getRuntimeConfig().installationId).toBe("tidbytrmain");
    expect(runtime.getEditableConfig()).not.toHaveProperty("tidbytApiToken");
    expect((await runtime.getStatus(now)).display.currentFrame).toBeNull();
    expect(await runtime.getPublishedPreview()).toBeNull();
    store.setOptions({ ...testConfig(), tidbytApiToken: "old-secret" });
    expect(store.getOptions(testConfig({ tidbytApiToken: "rotated-secret" })).tidbytApiToken).toBe("rotated-secret");
  });

  it("applies local-screen settings and clears a hold when its screen is hidden", async () => {
    const runtime = makeRuntime();
    await runtime.updateConfig({ starfieldEnabled: true });
    await runtime.publish("starfield");
    expect((await runtime.getStatus()).scheduler.manualHold?.panelId).toBe("starfield");
    await runtime.updateConfig({ starfieldEnabled: false });
    expect((await runtime.getPanels()).some((panel) => panel.kind === "starfield")).toBe(false);
    expect((await runtime.getStatus()).scheduler.manualHold).toBeNull();
    await runtime.updateConfig({ babyBirthDate: "2020-01-01", babyName: "BABY" });
    expect((await runtime.getPanels()).some((panel) => panel.kind === "baby-age")).toBe(true);
    await runtime.publish("baby-age");
    expect((await runtime.getStatus()).display.currentPanel?.kind).toBe("baby-age");
    await runtime.setSourceEnabled("local", false);
    expect((await runtime.getStatus()).display.currentPanel?.kind).toBe("clock");
    expect((await runtime.getStatus()).sourceHealth.find((source) => source.id === "local")?.status).toBe("disabled");
  });

  it("restores dashboard overrides and applies quiet-hours edits after saved controls", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "tidbytr-config-"));
    const config = testConfig({ dataDir });
    const runtime = makeRuntime({ config, store: undefined });
    await runtime.snooze(1, now);
    await runtime.updateConfig({ timezone: "UTC", quietHours: { start: "11:00", end: "13:00" } });
    await runtime.close();
    active.splice(active.findIndex((entry) => entry.runtime === runtime), 1);
    const restored = makeRuntime({ config, store: undefined });
    expect(restored.getRuntimeConfig().timezone).toBe("UTC");
    expect(restored.getRuntimeConfig().quietHours).toEqual({ start: "11:00", end: "13:00" });
    await expect(restored.updateConfig({ timezone: "Mars/Olympus" })).rejects.toThrow("IANA timezone");
    await restored.close();
    active.splice(active.findIndex((entry) => entry.runtime === restored), 1);
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
});

describe("priority policy over time", () => {
  it("shares time across ordinary panels and clock while limiting repeats", () => {
    let state = defaultSchedulerState();
    const selected: string[] = [];
    for (let second = 0; second < 600; second += 20) {
      const time = after(second);
      const panels = buildPanels(testConfig(), { ...weather, forecastObservedAt: now.toISOString() }, { games: [] }, time);
      const choice = choosePanel({ panels, now: time, state });
      const panel = panels.find((panel) => panel.id === choice.selectedPanelId)!;
      selected.push(panel.id);
      state = recordShown(state, panel, time);
    }
    expect(selected[0]).toBe("forecast");
    expect(selected).toContain("clock");
    expect(selected.filter((id) => id === "forecast").length).toBeLessThanOrEqual(3);
  });

  it("honors advisory quiet/snooze restrictions and rotates simultaneous critical events", () => {
    const advisory = { ...warning, id: "wind", severity: "advisory" as const, event: "Wind Advisory" };
    const quiet = defaultSchedulerState({ start: "11:00", end: "13:00" });
    const panels = buildPanels(testConfig(), { ...weather, alerts: [advisory] }, { games: [] }, now);
    expect(choosePanel({ panels, now, state: quiet, timeZone: "UTC" }).selectedPanelId).toBe("clock");
    expect(choosePanel({ panels, now, state: { ...quiet, quietHours: null, snoozedUntil: after(300).toISOString() } }).selectedPanelId).toBe("clock");
    const alerts = buildPanels(testConfig(), { ...weather, alerts: [warning, { ...warning, id: "storm" }] }, { games: [] }, now);
    const first = alerts.find((panel) => panel.id === choosePanel({ panels: alerts, now, state: quiet }).selectedPanelId)!;
    const state = recordShown(quiet, first, now);
    expect(choosePanel({ panels: alerts, now: after(20), state }).selectedPanelId).not.toBe(first.id);
  });

  it("lets a changed score earn screen time without waiting for its repeat cooldown", () => {
    const game = { id: "game", team: "KC", opponent: "DEN", status: "live" as const, teamScore: 0, opponentScore: 0, startsAt: now.toISOString() };
    const first = buildPanels(testConfig(), weather, { games: [game] }, now).find((panel) => panel.kind === "live-score")!;
    let state = recordShown(defaultSchedulerState(), first, now);
    const clock = buildPanels(testConfig(), weather, { games: [] }, after(20))[0]!;
    state = recordShown(state, clock, after(20));
    const panels = buildPanels(testConfig(), weather, { games: [{ ...game, teamScore: 7 }] }, after(40));
    expect(choosePanel({ panels, now: after(40), state }).selectedPanelId).toBe(first.id);
  });

  it("resumes the priority rotation when live coverage ends", () => {
    let state = defaultSchedulerState();
    const seen = new Set<string>();
    for (let seconds = 0; seconds < 600; seconds += 20) {
      const time = after(seconds);
      const game = { team: "KC", opponent: "DEN", startsAt: after(3600).toISOString(), observedAt: time.toISOString() };
      const panels = buildPanels(testConfig(), { ...weather, forecastObservedAt: now.toISOString(), alertsObservedAt: now.toISOString(), alerts: [{ ...warning, severity: "advisory", event: "Wind Advisory" }] }, { games: [
        ...(seconds < 120 ? [{ ...game, id: "live", status: "live" as const }] : []),
        { ...game, id: "upcoming", status: "scheduled" }, { ...game, id: "final", status: "final", completedAt: now.toISOString() },
      ] }, time);
      const policy = testConfig().screenPolicy;
      const result = choosePanel({ panels, now: time, state, policy });
      const selected = panels.find((panel) => panel.id === result.selectedPanelId)!;
      if (seconds < 120) expect(selected.kind).toBe("live-score");
      seen.add(selected.kind);
      state = recordShown(state, selected, time, policy);
    }
    expect([...seen].sort()).toEqual(["clock", "final-score", "forecast", "live-score", "nws-alert", "upcoming-game"]);
  });

  it("honors custom priorities and dwell rules", () => {
    const config = testConfig({ screenPolicy: { ...DEFAULT_SCREEN_POLICY, mode: "priority", minimumDwellSeconds: 40, priorities: { ...DEFAULT_SCREEN_POLICY.priorities, forecast: 95 } } });
    const panels = buildPanels(config, weather, { games: [{ id: "upcoming", team: "KC", opponent: "DEN", startsAt: after(3600).toISOString(), status: "scheduled" }] }, now);
    const first = choosePanel({ panels, now, state: defaultSchedulerState(), policy: config.screenPolicy });
    expect(first.selectedPanelId).toBe("forecast");
    const forecast = panels.find((panel) => panel.id === "forecast")!;
    expect(choosePanel({ panels, now: after(30), state: recordShown(defaultSchedulerState(), forecast, now), policy: config.screenPolicy }).reason).toBe("Minimum display time");
  });

  it("does not renew final-score expiration when rebuilding panels", () => {
    const game = { id: "final", team: "KC", opponent: "DEN", status: "final" as const, startsAt: now.toISOString(), observedAt: now.toISOString(), completedAt: now.toISOString() };
    expect(buildPanels(testConfig(), weather, { games: [game] }, after(3601)).some((panel) => panel.kind === "final-score")).toBe(false);
  });
});

describe("isolated providers and frame validation", () => {
  it("retains a successful warning when forecast fails and accepts zero Fahrenheit", async () => {
    let forecastFails = true;
    const provider = new NwsProvider({ latitude: 39, longitude: -94, userAgent: "test", timeoutMs: 20, fetchImpl: async (url) => {
      if (String(url).includes("/points/")) return Response.json({ properties: { forecast: "https://example.test/forecast", forecastZone: "https://example.test/zones/Z" } });
      if (String(url).includes("/forecast")) return forecastFails ? new Response("no", { status: 503 }) : Response.json({ properties: { periods: [{ temperature: 0, shortForecast: "Cold" }] } });
      return Response.json({ features: [{ id: warning.id, properties: { event: warning.event, expires: warning.expiresAt } }] });
    } });
    const partial = await provider.getSnapshot(now);
    expect(partial.snapshot.alerts[0]?.event).toBe("Tornado Warning");
    expect(partial.health.status).toBe("degraded");
    forecastFails = false;
    expect((await provider.getSnapshot(after(60))).snapshot.forecast?.temperature).toBe(0);
  });

  it("keeps a successful league when another league fails", async () => {
    const provider = new EspnSportsProvider({ favoriteTeams: ["KC"], fetchImpl: async (url) => String(url).includes("/nba/") ? new Response("no", { status: 503 }) : Response.json({ events: String(url).includes("/nfl/") ? [{ id: "game", date: now.toISOString(), status: { type: { state: "in" } }, competitions: [{ competitors: [{ team: { abbreviation: "KC" } }, { team: { abbreviation: "DEN" } }] }] }] : [] }) });
    const result = await provider.getSnapshot(now);
    expect(result.health.status).toBe("degraded");
    expect(result.snapshot.games).toHaveLength(1);
  });

  it("rejects invalid images before replacing the current frame", async () => {
    const runtime = makeRuntime();
    const publisher = new LocalDisplayPublisher({ dataDir: runtime.getRuntimeConfig().dataDir });
    await runtime.publish("clock", now);
    const original = await publisher.readCurrentFrame();
    await expect(publisher.publish({ panelId: "bad", width: 64, height: 32, encoding: "webp", mimeType: "image/webp", renderedAt: now.toISOString(), webp: Buffer.from("invalid") })).rejects.toThrow();
    expect(await publisher.readCurrentFrame()).toEqual(original);
  });
});
