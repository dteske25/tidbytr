import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { calendarAge, validBirthDate } from "../src/core/age.js";
import { normalizeOptions } from "../src/core/config.js";
import { buildPanels } from "../src/core/panels.js";
import { choosePanel, defaultSchedulerState, recordShown } from "../src/core/scheduler.js";
import { clockDisplay, babyAgeDisplay } from "../src/renderer/local-screens.js";
import { starfieldFrames } from "../src/renderer/starfield.js";
import { PixletRenderer } from "../src/renderer/pixlet.js";
import { SharpRenderer } from "../src/renderer/renderer.js";
import { validateDisplayFrame } from "../src/core/publisher.js";
import { testConfig } from "./helpers/fakes.js";
import { DEFAULT_SCREEN_POLICY } from "../src/core/policy.js";

const now = new Date("2026-06-28T15:07:00Z");
const options = () => testConfig({ timezone: "UTC", babyBirthDate: "2026-03-18", babyName: "BABY", starfieldEnabled: true });
const panels = (time = now) => buildPanels(options(), { forecast: null, alerts: [] }, { games: [] }, time);

describe("12-hour clock", () => {
  it.each([
    ["2026-06-28T00:00:00Z", "UTC", "12:00", "AM"],
    ["2026-06-28T12:00:00Z", "UTC", "12:00", "PM"],
    ["2026-06-28T15:07:00Z", "UTC", "3:07", "PM"],
    ["2026-06-28T23:59:00Z", "UTC", "11:59", "PM"],
    ["2026-06-28T00:00:00Z", "America/Chicago", "7:00", "PM"],
  ])("formats %s in %s", (timestamp, timezone, time, period) => {
    expect(clockDisplay(new Date(timestamp), timezone)).toMatchObject({ time, period });
  });
});

describe("calendar baby age", () => {
  it("counts exact calendar months and days with total weeks", () => {
    expect(calendarAge("2026-03-18", now, "UTC")).toMatchObject({ years: 0, months: 3, days: 10, weeks: 14, weekDays: 4 });
    expect(babyAgeDisplay("2026-03-18", "BABY", now, "UTC")).toMatchObject({ primary: "3M 10D", secondary: "14 WEEKS OLD" });
  });
  it("handles birth day, the first week, and birthdays", () => {
    expect(babyAgeDisplay("2026-06-28", "", now, "UTC")).toMatchObject({ name: "BABY", primary: "0 DAYS" });
    expect(babyAgeDisplay("2026-06-27", "", now, "UTC").primary).toBe("1 DAY");
    expect(babyAgeDisplay("2025-06-28", "", now, "UTC")).toMatchObject({ primary: "1Y 0M", secondary: "0 DAYS" });
  });
  it("clamps month-end and leap-day anniversaries", () => {
    expect(calendarAge("2026-01-31", new Date("2026-02-28T12:00:00Z"), "UTC")).toMatchObject({ months: 1, days: 0 });
    expect(calendarAge("2024-02-29", new Date("2025-02-28T12:00:00Z"), "UTC")).toMatchObject({ years: 1, months: 0, days: 0 });
    expect(calendarAge("2024-02-29", new Date("2025-02-27T12:00:00Z"), "UTC")).toMatchObject({ years: 0, months: 11, days: 29 });
  });
  it("uses the local calendar across midnight and DST", () => {
    const time = new Date("2026-06-29T00:30:00Z");
    expect(calendarAge("2026-06-28", time, "UTC")?.totalDays).toBe(1);
    expect(calendarAge("2026-06-28", time, "America/Chicago")?.totalDays).toBe(0);
    expect(calendarAge("2026-03-07", new Date("2026-03-09T05:30:00Z"), "America/Chicago")?.totalDays).toBe(2);
  });
  it("rejects invalid and future dates without inventing ages", () => {
    for (const value of ["2026-02-30", "2025-02-29", "06/28/2026", "0000-01-01"]) {
      expect(validBirthDate(value)).toBe(false);
      expect(() => normalizeOptions({ babyBirthDate: value })).toThrow("birth date");
    }
    expect(calendarAge("2027-01-01", now, "UTC")).toBeNull();
    expect(normalizeOptions({ babyBirthDate: "" }).babyBirthDate).toBe("");
  });
});

describe("local panel integration", () => {
  it("creates configured panels, omits missing/future birth dates, and allows the stars to be disabled", () => {
    expect(panels().map((panel) => panel.kind)).toEqual(["clock", "baby-age", "starfield"]);
    expect(buildPanels(testConfig({ babyBirthDate: "2027-01-01", starfieldEnabled: false }), { forecast: null, alerts: [] }, { games: [] }, now).map((panel) => panel.kind)).toEqual(["clock"]);
    expect(normalizeOptions({}).starfieldEnabled).toBe(true);
  });
  it("migrates old screen policy keys and preserves existing rules", () => {
    const { ["baby-age"]: agePriority, starfield: starPriority, ...priorities } = DEFAULT_SCREEN_POLICY.priorities;
    const { ["baby-age"]: ageCooldown, starfield: starCooldown, ...cooldownSeconds } = DEFAULT_SCREEN_POLICY.cooldownSeconds;
    const result = normalizeOptions({ screenPolicy: { minimumDwellSeconds: 40, priorities: { ...priorities, forecast: 88 }, cooldownSeconds } });
    expect(result.screenPolicy.priorities).toMatchObject({ forecast: 88, "baby-age": agePriority, starfield: starPriority });
    expect(result.screenPolicy.cooldownSeconds).toMatchObject({ "baby-age": ageCooldown, starfield: starCooldown });
  });
  it("respects quiet hours, snooze, and local-source toggles", () => {
    const quiet = defaultSchedulerState({ start: "14:00", end: "16:00" });
    const snoozed = { ...defaultSchedulerState(), snoozedUntil: new Date(now.getTime() + 60000).toISOString() };
    const disabled = { ...defaultSchedulerState(), disabledSources: ["local" as const] };
    for (const state of [quiet, snoozed, disabled]) expect(choosePanel({ panels: panels(), now, state, timeZone: "UTC" }).selectedPanelId).toBe("clock");
  });
  it("shares time with the clock and versions age when the local day changes", () => {
    const seen = new Set<string>();
    let state = defaultSchedulerState();
    for (let seconds = 0; seconds < 900; seconds += 20) {
      const time = new Date(now.getTime() + seconds * 1000);
      const choices = panels(time);
      const choice = choosePanel({ panels: choices, now: time, state });
      const selected = choices.find((panel) => panel.id === choice.selectedPanelId)!;
      seen.add(selected.kind);
      state = recordShown(state, selected, time);
    }
    expect([...seen].sort()).toEqual(["baby-age", "clock", "starfield"]);
    expect(panels()[1]?.version).not.toBe(panels(new Date("2026-06-29T00:01:00Z"))[1]?.version);
  });
});

describe("native local artwork", () => {
  it("renders a deterministic, bounded four-second star flight through both renderer paths", async () => {
    const source = starfieldFrames();
    expect(source).toHaveLength(50);
    expect(source[0]!.raw()).toEqual(starfieldFrames()[0]!.raw());
    expect(source[0]!.raw()).not.toEqual(source[25]!.raw());
    const images = [];
    for (const renderer of [new PixletRenderer(), new SharpRenderer()]) {
      const frame = await renderer.render(panels()[2]!, now, options());
      await validateDisplayFrame(frame);
      const metadata = await sharp(frame.webp, { animated: true }).metadata();
      expect(metadata.width).toBe(64);
      expect(metadata.pageHeight).toBe(32);
      expect(metadata.pages).toBeGreaterThan(20);
      expect(metadata.loop).toBe(0);
      expect(metadata.delay?.reduce((sum, delay) => sum + delay, 0)).toBe(4000);
      expect(frame.webp.length).toBeLessThan(512 * 1024);
      images.push(frame.webp);
    }
    expect(images[0]).toEqual(images[1]);
  });
  it("renders baby-age labels and artwork within 64x32 bounds in both backends", async () => {
    for (const renderer of [new PixletRenderer(), new SharpRenderer()]) {
      for (const birthDate of ["2026-06-28", "2026-06-27", "2026-03-18", "2025-06-28", "2020-06-01"]) {
        const sample = buildPanels({ ...options(), babyBirthDate: birthDate, babyName: "A VERY LONG BABY NAME" }, { forecast: null, alerts: [] }, { games: [] }, now)[1]!;
        const frame = await renderer.render(sample, now, options());
        await validateDisplayFrame(frame);
        const { data, info } = await sharp(frame.webp).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        expect(info.width).toBe(64); expect(info.height).toBe(32);
        // Reserve a black last row and right edge so no glyph is clipped.
        for (let x = 0; x < 64; x++) expect([...data.subarray((31 * 64 + x) * 4, (31 * 64 + x) * 4 + 3)]).toEqual([0, 0, 0]);
        for (let y = 0; y < 32; y++) expect([...data.subarray((y * 64 + 63) * 4, (y * 64 + 63) * 4 + 3)]).toEqual([0, 0, 0]);
      }
    }
  });
});
