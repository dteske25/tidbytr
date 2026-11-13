import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { normalizeOptions } from "../src/core/config.js";
import { configuredChildren } from "../src/core/children.js";
import { buildPanels } from "../src/core/panels.js";
import { DEFAULT_SCREEN_POLICY } from "../src/core/policy.js";
import { choosePanel, defaultSchedulerState, recordShown } from "../src/core/scheduler.js";
import { TidbytrStore } from "../src/storage/store.js";
import { TidbytrRuntime } from "../src/server/runtime.js";
import { PixletRenderer } from "../src/renderer/pixlet.js";
import { SharpRenderer } from "../src/renderer/renderer.js";
import { CHILD_STYLES } from "../src/renderer/local-screens.js";
import { FakeCloudTransport, FakeRenderer, FakeSportsProvider, FakeWeatherProvider, testConfig } from "./helpers/fakes.js";

const now = new Date("2026-06-28T15:07:00Z");
const children = [
  { id: "alex", name: "ALEXANDER", birthDate: "2026-03-18", style: "boy" as const },
  { id: "charlie", name: "CHARLOTTE", birthDate: "2024-02-29", style: "girl" as const },
];
const config = () => testConfig({ children, screenPolicy: DEFAULT_SCREEN_POLICY, timezone: "UTC", starfieldEnabled: true });
const panels = (time = now) => buildPanels(config(), { forecast: { temperature: 72, shortForecast: "Sunny" }, forecastObservedAt: now.toISOString(), alerts: [] }, { games: [] }, time);

describe("child profiles", () => {
  it("keeps legacy settings, supports explicit removal, and gives HA profiles stable IDs", () => {
    const legacy = normalizeOptions({ babyBirthDate: "2026-03-18", babyName: "BABY" });
    expect(configuredChildren(legacy)).toEqual([{ id: "legacy", name: "BABY", birthDate: "2026-03-18", style: "neutral" }]);
    expect(configuredChildren(normalizeOptions({ ...legacy, children: [] }))).toEqual([]);
    const input = { children: [{ name: "Sample", birthDate: "2026-03-18" }] };
    const first = normalizeOptions(input).children!;
    expect(first[0]?.style).toBe("neutral");
    expect(first[0]?.id).toBe(normalizeOptions(input).children?.[0]?.id);
    expect(normalizeOptions({ children: [{ ...first[0], name: "Renamed" }] }).children?.[0]?.id).toBe(first[0]?.id);
  });
  it("validates child names, real birth dates, styles, and unique IDs", () => {
    for (const change of [{ name: " " }, { birthDate: "2026-02-30" }, { style: "invalid" }, { id: "bad/id" }]) {
      expect(() => normalizeOptions({ children: [{ ...children[0], ...change }] })).toThrow();
    }
    expect(() => normalizeOptions({ children: [children[0], children[0]] })).toThrow("unique ID");
    expect(() => normalizeOptions({ children: Array.from({ length: 21 }, (_, i) => ({ ...children[0], id: `kid-${i}` })) })).toThrow();
  });
  it("builds separately named and styled panels, keeps IDs on rename, and hides future children", () => {
    const agePanels = panels().filter((panel) => panel.kind === "baby-age");
    expect(agePanels.map((panel) => panel.id)).toEqual(["baby-age-alex", "baby-age-charlie"]);
    expect(agePanels[0]).toMatchObject({ title: "ALEXANDER's age", payload: { style: "boy", ageDays: 102 } });
    expect(agePanels[1]).toMatchObject({ payload: { style: "girl" } });
    const updated = buildPanels({ ...config(), children: [{ ...children[0]!, name: "Renamed" }, { ...children[1]!, birthDate: "2027-01-01" }] }, { forecast: null, alerts: [] }, { games: [] }, now);
    expect(updated.filter((panel) => panel.kind === "baby-age").map((panel) => panel.id)).toEqual(["baby-age-alex"]);
  });
  it("alternates children across age slots while retaining 30-second clock gaps and weather/stars", () => {
    let state = defaultSchedulerState();
    const transitions: Array<[number, string]> = [];
    for (let seconds = 0; seconds <= 360; seconds += 5) {
      const time = new Date(now.getTime() + seconds * 1000);
      const choices = panels(time);
      const id = choosePanel({ panels: choices, state, now: time, policy: DEFAULT_SCREEN_POLICY }).selectedPanelId;
      if (id !== state.showing?.panelId) transitions.push([seconds, id!]);
      state = recordShown(state, choices.find((panel) => panel.id === id)!, time, DEFAULT_SCREEN_POLICY);
    }
    expect(transitions).toEqual([[0,"clock"],[30,"forecast"],[45,"clock"],[75,"baby-age-alex"],[90,"clock"],[120,"starfield"],[135,"clock"],[165,"forecast"],[180,"clock"],[210,"baby-age-charlie"],[225,"clock"],[255,"starfield"],[270,"clock"],[300,"forecast"],[315,"clock"],[345,"baby-age-alex"],[360,"clock"]]);
    const store = new TidbytrStore(":memory:");
    try {
      store.setSchedulerState(state);
      expect(store.getSchedulerState(null).history["baby-age-charlie"]).toEqual(state.history["baby-age-charlie"]);
    } finally { store.close(); }
  });
  it("does not let an HA default empty list hide saved legacy settings", () => {
    const store = new TidbytrStore(":memory:");
    try {
      store.setOptions(normalizeOptions({ babyBirthDate: "2026-03-18", babyName: "BABY" }));
      expect(configuredChildren(normalizeOptions(store.getOptions(normalizeOptions({ children: [] }))))).toHaveLength(1);
      store.setOptions(normalizeOptions({ children: [] }));
      expect(configuredChildren(store.getOptions(normalizeOptions({ babyBirthDate: "2026-03-18" })))).toEqual([]);
    } finally { store.close(); }
  });
  it("persists list edits, clears removed manual holds, and keeps an empty list empty", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "tidbytr-children-"));
    const store = new TidbytrStore(":memory:");
    const runtime = new TidbytrRuntime({ config: { ...config(), dataDir }, store, renderer: new FakeRenderer(), transport: new FakeCloudTransport(), weatherProvider: new FakeWeatherProvider({ forecast: null, alerts: [] }), sportsProvider: new FakeSportsProvider({ games: [] }) });
    try {
      await runtime.updateConfig({ children });
      await runtime.publish("baby-age-alex");
      expect(store.getSchedulerState(null).manualHold?.panelId).toBe("baby-age-alex");
      await runtime.updateConfig({ children: [children[1]] });
      expect(store.getSchedulerState(null).manualHold).toBeNull();
      expect(runtime.getRuntimeConfig().children).toEqual([children[1]]);
      await runtime.updateConfig({ children: [] });
      expect(runtime.getRuntimeConfig().babyBirthDate).toBe("");
      expect(store.getOptions(config()).children).toEqual([]);
      expect(configuredChildren(runtime.getRuntimeConfig())).toEqual([]);
    } finally { await runtime.close(); fs.rmSync(dataDir, { recursive: true, force: true }); }
  });
  it("converts HA child lists and preserves legacy upgrade settings", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tidbytr-ha-children-"));
    const input = path.join(dir, "options.json"), output = path.join(dir, "config.json");
    const convert = (raw: unknown) => {
      fs.writeFileSync(input, JSON.stringify(raw));
      execFileSync(process.execPath, ["--import", "tsx", path.resolve("src/server/ha-options.ts"), input, output]);
      return JSON.parse(fs.readFileSync(output, "utf8"));
    };
    try {
      const converted = convert({ children: [{ name: "Sample", birth_date: "2026-03-18", style: "boy" }] });
      expect(converted.children[0]).toMatchObject({ name: "Sample", birthDate: "2026-03-18", style: "boy" });
      expect(fs.statSync(output).mode & 0o777).toBe(0o600);
      expect(configuredChildren(convert({ children: [], baby_birth_date: "2026-03-18", baby_name: "BABY" }))).toHaveLength(1);
      expect(configuredChildren(convert({ children: [] }))).toEqual([]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  it("renders distinct boy, girl, and neutral accents without clipping names or ages", async () => {
    for (const renderer of [new PixletRenderer(), new SharpRenderer()]) {
      const images = [];
      for (const style of ["boy", "girl", "neutral"] as const) {
        const sample = { ...panels().find((panel) => panel.kind === "baby-age")!, payload: { name: "LONG CHILD NAME", birthDate: "2026-03-18", style, timezone: "UTC" } };
        const frame = await renderer.render(sample, now, config());
        const data = await sharp(frame.webp).removeAlpha().raw().toBuffer();
        const accent = CHILD_STYLES[style].accent;
        const color = [1,3,5].map((offset) => parseInt(accent.slice(offset, offset + 2), 16));
        let accentPixels = 0;
        for (let i = 0; i < data.length; i += 3) if (data[i] === color[0] && data[i+1] === color[1] && data[i+2] === color[2]) accentPixels++;
        expect(accentPixels).toBeGreaterThan(30);
        for (let x = 0; x < 64; x++) expect([...data.subarray((31 * 64 + x) * 3, (31 * 64 + x) * 3 + 3)]).toEqual([0,0,0]);
        for (let y = 0; y < 32; y++) expect([...data.subarray((y * 64 + 63) * 3, (y * 64 + 63) * 3 + 3)]).toEqual([0,0,0]);
        images.push(data);
      }
      expect(images[0]).not.toEqual(images[1]); expect(images[1]).not.toEqual(images[2]);
    }
  });
});
