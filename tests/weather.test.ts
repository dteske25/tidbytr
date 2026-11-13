import { describe, expect, it } from "vitest";
import { weatherDisplay, weatherIcon, weatherIconFrames, WEATHER_PALETTE } from "../src/renderer/weather.js";

describe("weather display semantics", () => {
  it("preserves zero/negative values and handles fractional, invalid, and missing values", () => {
    expect(weatherDisplay({ temperature: 0, high: 0, low: -12 })).toMatchObject({ temp: "0F", high: "HI 0", low: "LO -12" });
    expect(weatherDisplay({ temperature: 71.6, high: NaN, low: Infinity })).toMatchObject({ temp: "72F", high: "HI --", low: "LO --" });
    expect(weatherDisplay({})).toMatchObject({ temp: "--F", high: "HI --", low: "LO --", summary: "UNAVAILABLE", iconKind: "unknown" });
    expect(weatherDisplay({ temperature: 10000 }).temp).toBe("--F");
  });
  it.each([
    ["Sunny", true, "sun"], ["Clear", false, "moon"], ["Mostly Clear", false, "partly-night"],
    ["Partly Cloudy", true, "partly"], ["Mostly Cloudy", true, "cloud"], ["Chance Rain Showers", true, "rain"],
    ["Snow Showers", true, "snow"], ["Freezing Rain", true, "ice"], ["Rain And Snow", true, "mix"],
    ["Patchy Fog", true, "fog"], ["Windy", true, "wind"], ["Thunderstorms Likely And Breezy", true, "storm"],
    ["Unrecognized Condition", true, "unknown"],
  ] as const)("selects meaningful artwork for %s", (shortForecast, isDaytime, iconKind) => {
    const display = weatherDisplay({ shortForecast, isDaytime });
    expect(display.iconKind).toBe(iconKind);
    expect(display.summary.length).toBeLessThanOrEqual(13);
    expect(display.icon).toHaveLength(16);
    for (const row of display.icon) {
      expect(row.length).toBe(16);
      expect([...row].every((pixel) => pixel === "." || pixel in WEATHER_PALETTE)).toBe(true);
    }
  });
  it("keeps all animation frames on the grid and missing-data artwork static", () => {
    for (const kind of ["sun", "moon", "partly", "partly-night", "cloud", "rain", "snow", "storm", "fog", "wind", "ice", "mix"] as const) {
      const frames = weatherIconFrames(kind);
      expect(frames).toHaveLength(8);
      expect(frames).toEqual(weatherIconFrames(kind));
      expect(new Set(frames.map((rows) => rows.join(""))).size).toBeGreaterThan(1);
      for (const rows of frames) {
        expect(rows).toHaveLength(16);
        for (const row of rows) {
          expect(row.length).toBe(16);
          expect([...row].every((pixel) => pixel === "." || pixel in WEATHER_PALETTE)).toBe(true);
        }
      }
    }
    expect(weatherIconFrames("unknown")).toHaveLength(1);
  });
  it("preserves uncertainty in concise labels and differentiates day/night and precipitation", () => {
    expect(weatherDisplay({ shortForecast: "Slight Chance Thunderstorms" }).summary).toBe("STORM CHANCE");
    expect(weatherDisplay({ shortForecast: "Slight Chance Snow Showers" }).summary).toBe("SNOW CHANCE");
    expect(weatherIcon("sun")).not.toEqual(weatherIcon("rain"));
    expect(weatherIcon("partly")).not.toEqual(weatherIcon("partly-night"));
  });
});
