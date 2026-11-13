/** Native 16x16 weather art shared by Pixlet and Sharp. */
export const WEATHER_PALETTE: Record<string, string> = {
  s: "#FFD15C", o: "#EFA43B", w: "#E4EDF5", c: "#A6BBD0",
  d: "#708CA8", b: "#65BFFF", m: "#D7E7FF",
};
export const WEATHER_FRAME_DELAY_MS = 250;
export const WEATHER_FRAME_COUNT = 8;
export interface ForecastDisplayInput {
  temperature?: number;
  shortForecast?: string;
  high?: number;
  low?: number;
  isDaytime?: boolean;
}
export type WeatherIcon = "sun" | "moon" | "partly" | "partly-night" | "cloud" | "rain" | "snow" | "storm" | "fog" | "wind" | "ice" | "mix" | "unknown";
export function weatherDisplay(forecast: ForecastDisplayInput) {
  const { icon, label } = condition(forecast.shortForecast ?? "", forecast.isDaytime !== false);
  const frames = weatherIconFrames(icon);
  return { temp: `${temperature(forecast.temperature)}F`, high: `HI ${temperature(forecast.high)}`,
    low: `LO ${temperature(forecast.low)}`, summary: label, iconKind: icon, icon: frames[0]!,
    iconFrames: frames, animationDelayMs: WEATHER_FRAME_DELAY_MS, palette: WEATHER_PALETTE };
}
function temperature(value: number | undefined): string {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 999 ? String(Math.round(value)) : "--";
}
function condition(summary: string, day: boolean): { icon: WeatherIcon; label: string } {
  const text = summary.toLowerCase();
  if (/thunder|t-storm/.test(text)) return { icon: "storm", label: /chance|slight/.test(text) ? "STORM CHANCE" : "T-STORMS" };
  if (/wintry|rain.*snow|snow.*rain|sleet/.test(text)) return { icon: "mix", label: "WINTRY MIX" };
  if (/freezing|ice/.test(text)) return { icon: "ice", label: "ICE" };
  if (/snow|flurr/.test(text)) return { icon: "snow", label: /chance|slight/.test(text) ? "SNOW CHANCE" : "SNOW" };
  if (/rain|shower|drizzle/.test(text)) return { icon: "rain", label: /chance|slight/.test(text) ? "RAIN CHANCE" : "RAIN" };
  if (/fog|mist|haze|smoke/.test(text)) return { icon: "fog", label: /smoke/.test(text) ? "SMOKE" : /haze/.test(text) ? "HAZE" : "FOG" };
  if (/partly|mostly sunny|mostly clear/.test(text)) return { icon: day ? "partly" : "partly-night", label: /mostly sunny/.test(text) ? "MOSTLY SUNNY" : /mostly clear/.test(text) ? "MOSTLY CLEAR" : "PARTLY CLOUDY" };
  if (/cloud|overcast/.test(text)) return { icon: "cloud", label: /mostly/.test(text) ? "MOSTLY CLOUDY" : "CLOUDY" };
  if (/sunny|clear/.test(text)) return { icon: day ? "sun" : "moon", label: /sunny/.test(text) && day ? "SUNNY" : "CLEAR" };
  if (/wind|breez/.test(text)) return { icon: "wind", label: "WINDY" };
  return { icon: "unknown", label: text && !/unavailable/.test(text) ? "FORECAST" : "UNAVAILABLE" };
}
export function weatherIconFrames(kind: WeatherIcon): string[][] {
  return Array.from({ length: kind === "unknown" ? 1 : WEATHER_FRAME_COUNT }, (_, phase) => weatherIcon(kind, phase));
}
/** Each character is exactly one LED; no scaling or antialiasing. */
export function weatherIcon(kind: WeatherIcon, phase = 0): string[] {
  const pixels = Array.from({ length: 16 }, () => Array<string>(16).fill("."));
  const stamp = (rows: string[], left: number, top: number) => {
    rows.forEach((row, y) => [...row].forEach((color, x) => {
      if (color !== "." && pixels[top + y]?.[left + x] !== undefined) pixels[top + y]![left + x] = color;
    }));
  };
  const drift = [0, 0, 1, 1, 1, 1, 0, 0][phase % WEATHER_FRAME_COUNT]!;
  const sun = ["....s....", ".s.....s.", "...sss...", "..sssss..", "s.ssoos.s", "..ssoos..", "...sss...", ".s.....s.", "....s...."];
  if (drift) {
    sun[0] = "........."; sun[1] = ".s..s..s."; sun[4] = "..ssoos.."; sun[7] = ".s..s..s."; sun[8] = ".........";
  }
  const moon = ["....mmm..", "..mmmm...", ".mmmc....", ".mmmc....", "mmmmc....", "mmmmmc...", ".mmmmmm..", "..mmmmmm.", "....mmm.."];
  const cloud = [".....cccc......", "....cwwwwc.....", "..ccwwwwwwccc..", ".cwwwwwwwwwwwc.", "cwwwwwwwwwwwwwc", "cwwwwwwwwwwwwwc", ".ddddddddddddd."];
  const rain = (bases: number[]) => {
    for (const [index, base] of bases.entries()) {
      const y = 11 + (phase + index * 2) % 4;
      stamp([".b", "b."], base - Math.floor((y - 11) / 2), y);
    }
  };
  const snow = (bases: number[], color = "w") => {
    for (const [index, base] of bases.entries()) {
      const y = 11 + (Math.floor(phase / 2) + index * 2) % 4;
      stamp(["." + color + ".", color.repeat(3), "." + color + "."], base + drift, y - 1);
    }
  };
  if (kind === "sun" || kind === "moon") {
    stamp(kind === "sun" ? sun : moon, 3, 3);
    if (kind === "moon") stamp([phase % 4 < 2 ? "m" : "d"], 13, 2);
  } else if (kind === "unknown") stamp([".cccc.", "cw..wc", "....wc", "...wc.", "..wc..", "..c...", "......", "..c..."], 5, 4);
  else if (kind === "wind") {
    stamp(["........cc..", ".......c..c.", ".cccccccccc.", "............", "cccccccc....", "........c...", "..ccccccc...", "............", ".ccccc......"], 2 + drift, 4);
  } else if (kind === "fog") {
    stamp(cloud, 0, 1);
    stamp([".cccccc.ccccc.", "..............", "ccc.ccccccc...", "..............", "..cccccc.ccccc"], drift, 10);
  } else {
    const partly = kind === "partly" || kind === "partly-night";
    if (partly) stamp(kind === "partly" ? sun : moon, 1, 0);
    stamp(cloud, kind === "cloud" || partly ? drift : 0, partly ? 7 : 2);
    if (kind === "rain") rain([3, 8, 13]);
    if (kind === "snow") snow([2, 10]);
    if (kind === "storm") {
      rain([12]);
      // Only the small bolt flashes, once per two-second loop.
      if (phase < 2) {
        const bolt = ["....sss......", "...sss.......", "..ssss.......", "....s........", "...s.........", "..s.........."];
        stamp(phase === 0 ? bolt : bolt.map((row) => row.replaceAll("s", "o")), 2, 10);
      }
    }
    if (kind === "ice") snow([3, 10], "m");
    if (kind === "mix") { rain([4]); snow([10]); }
  }
  return pixels.map((row) => row.join(""));
}
