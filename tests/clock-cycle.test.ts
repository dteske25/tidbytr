import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_SCREEN_POLICY } from "../src/core/policy.js";
import { normalizeOptions } from "../src/core/config.js";
import { buildPanels, type SportsSnapshot } from "../src/core/panels.js";
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
  it("stays on clock when no cycle items are available and excludes ordinary advisories", () => {
    let state = commit(defaultSchedulerState(), 0);
    const clock = panels(60).filter((panel) => panel.kind === "clock");
    const advisory: Panel = { ...panels(60)[1]!, id: "advisory", kind: "nws-alert", priority: 100, source: "nws", critical: false };
    expect(select(state, 60, [...clock, advisory]).id).toBe("clock");
    state = recordShown(state, clock[0]!, after(60), policy);
    expect(select(state, 1000, panels(1000).filter((panel) => panel.kind === "clock")).id).toBe("clock");
  });
  it("rotates one upcoming or final game at a time after the regular screens", () => {
    const state = { ...commit(defaultSchedulerState(), 0), cycleNextIndex: 3 };
    const choices = (seconds: number) => [...panels(seconds),
      ...buildPanels(config(), { alerts: [], forecast: null }, { games: [
        { id: "nebraska", startsAt: after(1800).toISOString(), team: "NEB", opponent: "IOWA", status: "scheduled" },
        { id: "kansas", startsAt: now.toISOString(), team: "KU", opponent: "KSU", status: "final", teamScore: 90, opponentScore: 80 },
      ] }, after(seconds)).filter((panel) => panel.source === "sports"),
    ];
    expect(select(state, 20, choices(20)).id).toBe("clock");
    let current = commit(state, 60, choices(60));
    expect(current.showing?.panelId).toBe("sports-nebraska");
    for (const second of [80, 140, 160, 220, 240, 300, 320, 380]) current = commit(current, second, choices(second));
    expect(current.showing?.panelId).toBe("sports-kansas");
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

async function runtimeFixture(renderer = new FakeRenderer(), transport = new FakeCloudTransport(), sports: SportsSnapshot = { games: [] }) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "tidbytr-cycle-"));
  const store = new TidbytrStore(":memory:");
  const runtime = new TidbytrRuntime({ config: { ...config(), dataDir }, store, renderer, transport,
    weatherProvider: new FakeWeatherProvider({ alerts: [], forecast: { temperature: 72, shortForecast: "Sunny" } }), sportsProvider: new FakeSportsProvider(sports) });
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
  it("foregrounds live coverage and score changes, then resumes the clock after play ends", async () => {
    const game = { id: "husker-vb", team: "NEB", opponent: "IOWA", startsAt: now.toISOString(),
      status: "live" as const, teamScore: 0, opponentScore: 0, set: 1, teamSetPoints: 0, opponentSetPoints: 0 };
    const sports: SportsSnapshot = { games: [] };
    const fixture = await runtimeFixture(undefined, undefined, sports);
    try {
      await fixture.runtime.publish(undefined, now);
      sports.games = [game];
      await fixture.runtime.refreshSources(after(5));
      expect((await fixture.runtime.publish(undefined, after(5))).decision.reason).toBe("Live game display");

      game.teamSetPoints = 1;
      await fixture.runtime.refreshSources(after(10));
      const original = fixture.transport.push.bind(fixture.transport);
      fixture.transport.push = async (frame, options) => ({ ...await original(frame, options), ok: false, status: 503, message: "HTTP 503" });
      await expect(fixture.runtime.publish(undefined, after(10))).rejects.toThrow("503");
      fixture.transport.push = original;
      expect((await fixture.runtime.publish(undefined, after(11))).decision.reason).toBe("Score change interrupt");
      const originalStart = fixture.store.getSchedulerState(null).showing?.startedAt;

      await fixture.runtime.refreshSources(after(12));
      expect((await fixture.runtime.publish(undefined, after(12))).decision.reason).toBe("Live game display");
      expect(fixture.transport.calls.at(-1)?.options.background).toBe(true);
      expect(fixture.store.getSchedulerState(null).showing?.startedAt).toBe(originalStart);

      game.opponentSetPoints = 1;
      await fixture.runtime.refreshSources(after(15));
      expect((await fixture.runtime.publish(undefined, after(15))).decision.reason).toBe("Score change interrupt");
      expect(fixture.transport.calls.at(-1)?.options.background).toBe(false);
      expect(fixture.store.getSchedulerState(null)).toMatchObject({ cycleNextIndex: 0, showing: { startedAt: after(15).toISOString() } });
      expect((await fixture.runtime.publish(undefined, after(34))).panel?.id).toBe("sports-husker-vb");
      expect((await fixture.runtime.publish(undefined, after(35))).panel?.id).toBe("sports-husker-vb");
      game.teamSetPoints = 2;
      await fixture.runtime.refreshSources(after(35));
      await fixture.runtime.publish(undefined, after(35));
      sports.games = [{ ...game, status: "final" }];
      await fixture.runtime.refreshSources(after(36));
      expect((await fixture.runtime.publish(undefined, after(36))).panel?.id).toBe("clock");
      expect(fixture.store.getSchedulerState(null).cycleNextIndex).toBe(0);
    } finally { await fixture.close(); }
  });

  it("alternates simultaneous live games without showing clock between them", () => {
    const sports = (seconds: number) => buildPanels(config(), { alerts: [], forecast: null }, { games: [
      { id: "nebraska", startsAt: now.toISOString(), team: "NEB", opponent: "IOWA", status: "live" },
      { id: "iowa-state", startsAt: now.toISOString(), team: "ISU", opponent: "KU", status: "live" },
    ] }, after(seconds));
    let state = commit(defaultSchedulerState(), 0, sports(0));
    expect(state.showing?.panelId).toBe("sports-nebraska");
    state = commit(state, 19, sports(19));
    expect(state.showing?.panelId).toBe("sports-nebraska");
    state = commit(state, 20, sports(20));
    expect(state.showing?.panelId).toBe("sports-iowa-state");
    state = commit(state, 40, sports(40));
    expect(state.showing?.panelId).toBe("sports-nebraska");
    expect(state.cycleNextIndex).toBe(0);
  });

  it("prioritizes critical alerts and manual holds, and respects quiet hours, snooze, and freshness", () => {
    const state = commit(defaultSchedulerState(), 0);
    const choices = panels(10, true);
    const live: Panel = { ...choices[0]!, id: "sports-husker", kind: "live-score", source: "sports",
      scoreChangedAt: after(10).toISOString(), expiresAt: after(200).toISOString() };
    expect(select(state, 10, [...choices, live]).critical).toBe(true);
    const normal = () => [...panels(10), live];
    expect(select(state, 10, normal()).id).toBe(live.id);
    expect(select({ ...state, manualHold: { panelId: "clock", until: after(99).toISOString() } }, 10, normal()).id).toBe("clock");
    expect(select({ ...state, snoozedUntil: after(99).toISOString() }, 10, normal()).id).toBe("clock");
    expect(select({ ...state, quietHours: { start: "12:00", end: "13:00" } }, 10, normal()).id).toBe("clock");
    expect(select({ ...state, disabledSources: ["sports"] }, 10, normal()).id).toBe("clock");
    expect(select(state, 100, [...panels(100), live]).id).toBe(live.id);
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
