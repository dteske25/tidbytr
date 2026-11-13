import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_SCREEN_POLICY } from "../src/core/policy.js";
import { normalizeOptions } from "../src/core/config.js";
import { buildPanels } from "../src/core/panels.js";
import { choosePanel, defaultSchedulerState, recordShown, cycleRemainingMilliseconds, markSkipped } from "../src/core/scheduler.js";
import type { Panel, SchedulerState } from "../src/core/types.js";
import { TidbytrRuntime } from "../src/server/runtime.js";
import { TidbytrStore } from "../src/storage/store.js";
import { FakeCloudTransport, FakeRenderer, FakeSportsProvider, FakeWeatherProvider, testConfig } from "./helpers/fakes.js";

const now = new Date("2026-06-28T12:00:00Z");
const after = (seconds: number) => new Date(now.getTime() + seconds * 1000);
// Keep explicit custom timings to exercise support for saved rotations.
const policy = { ...structuredClone(DEFAULT_SCREEN_POLICY), clockSeconds: 60, screenSeconds: 20 };
const config = () => testConfig({ timezone: "UTC", screenPolicy: policy, starfieldEnabled: true, babyBirthDate: "2026-03-18" });
const panels = (seconds = 0, critical = false) => buildPanels(config(), {
  forecast: { temperature: 72, shortForecast: "Sunny" }, forecastObservedAt: now.toISOString(), alertsObservedAt: after(seconds).toISOString(),
  alerts: critical ? [{ id: "warning", event: "Tornado Warning", severity: "warning", headline: "Seek shelter", expiresAt: after(3600).toISOString() }] : [],
}, { games: [] }, after(seconds));
function select(state: SchedulerState, seconds: number, choices = panels(seconds)) {
  const decision = choosePanel({ panels: choices, state, now: after(seconds), policy });
  return choices.find((panel) => panel.id === decision.selectedPanelId)!;
}
const commit = (state: SchedulerState, seconds: number, choices = panels(seconds)) => recordShown(state, select(state, seconds, choices), after(seconds), policy);

describe("clock-led cycle", () => {
  it("is the default and repeats clock/weather/clock/age/clock/stars with longer clock slots", () => {
    expect(normalizeOptions({}).screenPolicy).toMatchObject({ mode: "clock-cycle", clockSeconds: 30, screenSeconds: 15 });
    let state = defaultSchedulerState();
    const defaults = normalizeOptions({}).screenPolicy;
    const defaultTransitions: Array<[number, string]> = [];
    for (let seconds = 0; seconds <= 270; seconds += 5) {
      const choices = panels(seconds);
      const id = choosePanel({ panels: choices, state, now: after(seconds), policy: defaults }).selectedPanelId;
      if (id !== state.showing?.panelId) defaultTransitions.push([seconds, id!]);
      state = recordShown(state, choices.find((panel) => panel.id === id)!, after(seconds), defaults);
    }
    expect(defaultTransitions).toEqual([[0,"clock"],[30,"forecast"],[45,"clock"],[75,"baby-age"],[90,"clock"],[120,"starfield"],[135,"clock"],[165,"forecast"],[180,"clock"],[210,"baby-age"],[225,"clock"],[255,"starfield"],[270,"clock"]]);
    state = defaultSchedulerState();
    const transitions: Array<[number, string]> = [];
    for (let seconds = 0; seconds <= 480; seconds += 5) {
      const panel = select(state, seconds);
      if (panel.id !== state.showing?.panelId) transitions.push([seconds, panel.id]);
      state = recordShown(state, panel, after(seconds), policy);
    }
    expect(transitions).toEqual([[0,"clock"],[60,"forecast"],[80,"clock"],[140,"baby-age"],[160,"clock"],[220,"starfield"],[240,"clock"],[300,"forecast"],[320,"clock"],[380,"baby-age"],[400,"clock"],[460,"starfield"],[480,"clock"]]);
  });
  it("skips expired, missing, and disabled items while keeping clock gaps", () => {
    const choices = (seconds: number) => panels(seconds).filter((panel) => panel.kind !== "baby-age");
    let state = defaultSchedulerState();
    state = commit(state, 0, choices(0)); state = commit(state, 60, choices(60)); state = commit(state, 80, choices(80));
    expect(select(state, 140, choices(140)).id).toBe("starfield");
    const noWeather = panels(60).map((panel) => panel.kind === "forecast" ? { ...panel, expiresAt: after(59).toISOString() } : panel);
    expect(select(commit(defaultSchedulerState(), 0), 60, noWeather).id).toBe("baby-age");
    const disabled = { ...commit(defaultSchedulerState(), 0), disabledSources: ["nws" as const] };
    expect(select(disabled, 60).id).toBe("baby-age");
  });
  it("stays on clock when no cycle items are available and excludes ordinary sports/advisories", () => {
    let state = commit(defaultSchedulerState(), 0);
    const clock = panels(60).filter((panel) => panel.kind === "clock");
    const advisory: Panel = { ...panels(60)[1]!, id: "advisory", kind: "nws-alert", priority: 100, source: "nws", critical: false };
    expect(select(state, 60, [...clock, advisory]).id).toBe("clock");
    state = recordShown(state, clock[0]!, after(60), policy);
    expect(select(state, 1000, panels(1000).filter((panel) => panel.kind === "clock")).id).toBe("clock");
  });
  it("lets critical alerts interrupt, then resumes with a full clock interval and the pending item", () => {
    let state = commit(defaultSchedulerState(), 0); state = commit(state, 60); state = commit(state, 80);
    expect(select(state, 100, panels(100, true)).critical).toBe(true);
    state = commit(state, 100, panels(100, true));
    expect(state.cycleNextIndex).toBe(1);
    state = commit(state, 101);
    expect(select(state, 160).id).toBe("clock");
    expect(select(state, 161).id).toBe("baby-age");
  });
  it("honors manual holds and returns through clock before cycling again", () => {
    let state = commit(defaultSchedulerState(), 0);
    state = { ...state, manualHold: { panelId: "starfield", until: after(70).toISOString() } };
    state = commit(state, 10);
    expect(select(state, 50).id).toBe("starfield");
    expect(select(state, 50, panels(50, true)).critical).toBe(true);
    state = commit(state, 70);
    expect(state.showing?.panelId).toBe("clock");
    expect(select(state, 130).id).toBe("forecast");
  });
  it("applies skip, snooze, and quiet hours without advancing on status reads", () => {
    let state = commit(defaultSchedulerState(), 0);
    expect(select(state, 60).id).toBe("forecast"); expect(select(state, 60).id).toBe("forecast"); expect(state.cycleNextIndex).toBe(0);
    state = commit(state, 60); state = markSkipped(state, "forecast"); state = commit(state, 65);
    expect(state.showing?.panelId).toBe("clock"); expect(state.skippedPanelIds).toEqual([]);
    expect(select(state, 125).id).toBe("baby-age");
    expect(select({ ...state, snoozedUntil: after(300).toISOString() }, 125).id).toBe("clock");
    expect(choosePanel({ panels: panels(125), state: { ...state, quietHours: { start: "12:00", end: "13:00" } }, now: after(125), timeZone: "UTC", policy }).selectedPanelId).toBe("clock");
  });
  it("keeps a slot's start time through data changes and clock refreshes", () => {
    let state = commit(defaultSchedulerState(), 0); state = commit(state, 20); expect(state.showing?.startedAt).toBe(now.toISOString());
    state = commit(state, 60);
    const changed = { ...panels(70).find((panel) => panel.id === "forecast")!, version: "updated" };
    state = recordShown(state, changed, after(70), policy);
    expect(state.showing?.startedAt).toBe(after(60).toISOString());
    expect(select(state, 80).id).toBe("clock");
  });
  it("preserves the cursor through persistence and supplies a default for legacy state", () => {
    const store = new TidbytrStore(":memory:");
    try {
      const state = commit(commit(defaultSchedulerState(), 0), 60); store.setSchedulerState(state);
      const restored = store.getSchedulerState(null); expect(restored.cycleNextIndex).toBe(1);
      const clock = commit(restored, 80); expect(select(clock, 140).id).toBe("baby-age");
      const { cycleNextIndex, ...legacy } = state; store.setSchedulerState(legacy as never); expect(store.getSchedulerState(null).cycleNextIndex).toBe(0);
    } finally { store.close(); }
  });
  it("calculates precise remaining slot time for 90/15 timings across minute-aligned refreshes", () => {
    const timing = { ...policy, clockSeconds: 90, screenSeconds: 15 };
    let state = recordShown(defaultSchedulerState(), panels()[0]!, after(10), timing);
    const request = (seconds: number) => ({ panels: panels(seconds), state, now: after(seconds), policy: timing });
    expect(cycleRemainingMilliseconds(request(60))).toBe(40000);
    expect(cycleRemainingMilliseconds(request(90))).toBe(10000);
    expect(choosePanel(request(100)).selectedPanelId).toBe("forecast");
    state = recordShown(state, panels(100).find((panel) => panel.id === "forecast")!, after(100), timing);
    expect(cycleRemainingMilliseconds(request(110))).toBe(5000);
    expect(choosePanel(request(115)).selectedPanelId).toBe("clock");
  });
  it("validates durations and migrates old policy objects into the new default mode", () => {
    expect(normalizeOptions({ screenPolicy: { minimumDwellSeconds: 40 } }).screenPolicy).toMatchObject({ mode: "clock-cycle", clockSeconds: 30, screenSeconds: 15, minimumDwellSeconds: 40 });
    expect(() => normalizeOptions({ screenPolicy: { clockSeconds: 20, screenSeconds: 30 } })).toThrow("longer");
    expect(normalizeOptions({ screenPolicy: { mode: "priority", clockSeconds: 20, screenSeconds: 30 } }).screenPolicy.mode).toBe("priority");
  });
});

async function runtimeFixture(renderer = new FakeRenderer(), transport = new FakeCloudTransport()) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "tidbytr-cycle-"));
  const store = new TidbytrStore(":memory:");
  const runtime = new TidbytrRuntime({ config: { ...config(), dataDir }, store, renderer, transport,
    weatherProvider: new FakeWeatherProvider({ alerts: [], forecast: { temperature: 72, shortForecast: "Sunny" } }), sportsProvider: new FakeSportsProvider({ games: [] }) });
  await runtime.refreshSources(now);
  return { runtime, store, transport, async close() { await runtime.close(); fs.rmSync(dataDir, { recursive: true, force: true }); } };
}

describe("clock-cycle publication", () => {
  it("foregrounds transitions while refreshing clock content in the background", async () => {
    const fixture = await runtimeFixture();
    try {
      for (const second of [0,20,40,60,80,100,140]) await fixture.runtime.publish(undefined, after(second));
      expect(fixture.transport.calls.map((call) => call.options.background)).toEqual([false,true,true,false,false,true,false]);
      expect((await fixture.runtime.getStatus(after(140))).display.currentPanel?.id).toBe("baby-age");
    } finally { await fixture.close(); }
  });
  it("does not advance the cycle on upload failure", async () => {
    const fixture = await runtimeFixture();
    try {
      await fixture.runtime.publish(undefined, now);
      const original = fixture.transport.push.bind(fixture.transport);
      fixture.transport.push = async (frame, options) => ({ ...await original(frame, options), ok: false, status: 503, message: "HTTP 503" });
      await expect(fixture.runtime.publish(undefined, after(60))).rejects.toThrow("503");
      expect(fixture.store.getSchedulerState(null).cycleNextIndex).toBe(0);
      fixture.transport.push = original;
      expect((await fixture.runtime.publish(undefined, after(61))).panel?.id).toBe("forecast");
      expect(fixture.store.getSchedulerState(null).cycleNextIndex).toBe(1);
    } finally { await fixture.close(); }
  });
  it("skips an unrenderable item after successfully publishing a clock fallback", async () => {
    const renderer = new FakeRenderer(); const render = renderer.render.bind(renderer);
    renderer.render = async (...args) => { if (args[0].kind === "forecast") throw new Error("weather template failed"); return render(...args); };
    const fixture = await runtimeFixture(renderer);
    try {
      await fixture.runtime.publish(undefined, now);
      expect((await fixture.runtime.publish(undefined, after(60))).panel?.id).toBe("clock");
      expect(fixture.store.getSchedulerState(null).cycleNextIndex).toBe(1);
      expect((await fixture.runtime.publish(undefined, after(120))).panel?.id).toBe("baby-age");
    } finally { await fixture.close(); }
  });
  it("preserves mode and other policy fields on partial config updates", async () => {
    const fixture = await runtimeFixture();
    try {
      await fixture.runtime.updateConfig({ screenPolicy: { clockSeconds: 120 } });
      expect(fixture.runtime.getRuntimeConfig().screenPolicy).toMatchObject({ mode: "clock-cycle", clockSeconds: 120, screenSeconds: 20 });
      await fixture.runtime.updateConfig({ screenPolicy: { mode: "priority" } });
      expect(fixture.runtime.getRuntimeConfig().screenPolicy).toMatchObject({ mode: "priority", clockSeconds: 120, screenSeconds: 20 });
    } finally { await fixture.close(); }
  });
});
