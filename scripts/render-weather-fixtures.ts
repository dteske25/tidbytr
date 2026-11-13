import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { defaultOptions } from "../src/core/config.js";
import type { Panel, RuntimeConfig } from "../src/core/types.js";
import { PixletRenderer } from "../src/renderer/pixlet.js";
import { SharpRenderer } from "../src/renderer/renderer.js";
import { WEATHER_FRAME_COUNT, WEATHER_FRAME_DELAY_MS, type ForecastDisplayInput } from "../src/renderer/weather.js";

const destination = path.join(process.cwd(), "docs/assets/weather");
const config: RuntimeConfig = { ...defaultOptions(), dataDir: "/tmp/tidbytr-weather", host: "127.0.0.1", port: 0 };
const now = new Date("2026-06-28T12:00:00Z");
const cases: Array<[string, ForecastDisplayInput]> = [
  ["sunny", { temperature: 86, high: 90, low: 68, shortForecast: "Sunny", isDaytime: true }],
  ["partly-cloudy", { temperature: 72, high: 74, low: 52, shortForecast: "Partly Cloudy" }],
  ["cloudy", { temperature: 54, high: 61, low: 42, shortForecast: "Mostly Cloudy" }],
  ["rain", { temperature: 63, high: 67, low: 55, shortForecast: "Slight Chance Rain Showers And Breezy" }],
  ["snow-zero", { temperature: 0, high: 0, low: -12, shortForecast: "Snow" }],
  ["thunderstorms", { temperature: 102, high: 104, low: 78, shortForecast: "Thunderstorms Likely And Breezy" }],
  ["clear-night", { temperature: 48, high: 67, low: 42, shortForecast: "Clear", isDaytime: false }],
  ["negative", { temperature: -12, high: -2, low: -24, shortForecast: "Partly Cloudy", isDaytime: false }],
  ["fog", { temperature: 54, high: 61, low: 42, shortForecast: "Fog" }],
  ["wind", { temperature: 61, high: 68, low: 52, shortForecast: "Windy" }],
  ["ice", { temperature: 27, high: 32, low: 18, shortForecast: "Freezing Rain" }],
  ["mix", { temperature: 33, high: 37, low: 28, shortForecast: "Rain And Snow" }],
  ["unavailable", {}],
];
type Tile = { input: Buffer; left: number; top: number };
const reviewHeight = 16 + Math.ceil(cases.length / 3) * 144;
const image = (width: number, height: number) => sharp({ create: { width, height, channels: 4, background: "#10151e" } });
async function gif(frames: Buffer[], width: number, height: number, file: string) {
  await sharp(Buffer.concat(frames), { raw: { width, height: height * frames.length, pageHeight: height, channels: 4 } })
    .gif({ loop: 0, delay: Array(frames.length).fill(WEATHER_FRAME_DELAY_MS) }).toFile(path.join(destination, file));
}
await mkdir(destination, { recursive: true });
for (const [backend, renderer] of [["pixlet", new PixletRenderer()], ["sharp", new SharpRenderer()]] as const) {
  const animatedTiles = Array.from({ length: WEATHER_FRAME_COUNT }, () => [] as Tile[]);
  for (const [index, [name, payload]] of cases.entries()) {
    const panel: Panel = { id: name, kind: "forecast", source: "nws", title: name, priority: 40, createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + 60000).toISOString(), ttlSeconds: 60, payload };
    const frame = await renderer.render(panel, now, config);
    await writeFile(path.join(destination, `${backend}-${name}.webp`), frame.webp);
    await sharp(frame.webp).png().toFile(path.join(destination, `${backend}-${name}.png`));
    await sharp(frame.webp, { animated: true }).resize(256, 128, { kernel: "nearest" }).gif({ loop: 0 }).toFile(path.join(destination, `${backend}-${name}.gif`));
    const metadata = await sharp(frame.webp, { animated: true }).metadata();
    for (let phase = 0; phase < WEATHER_FRAME_COUNT; phase++) {
      let time = phase * WEATHER_FRAME_DELAY_MS;
      let page = 0;
      const delays = metadata.delay ?? [WEATHER_FRAME_COUNT * WEATHER_FRAME_DELAY_MS];
      while (page < delays.length - 1 && time >= delays[page]!) time -= delays[page++]!;
      animatedTiles[phase]!.push({ input: await sharp(frame.webp, { page, pages: 1 }).resize(256, 128, { kernel: "nearest" }).png().toBuffer(), left: 16 + index % 3 * 272, top: 16 + Math.floor(index / 3) * 144 });
    }
  }
  await image(832, reviewHeight).composite(animatedTiles[0]!).png().toFile(path.join(destination, `${backend}-review.png`));
  await gif(await Promise.all(animatedTiles.map((tiles) => image(832, reviewHeight).composite(tiles).raw().toBuffer())), 832, reviewHeight, `${backend}-review.gif`);
  await gif(await Promise.all(animatedTiles.map((tiles) => image(832, 160).composite([0, 3, 5].map((index, column) => ({ ...tiles[index]!, left: 16 + column * 272, top: 16 }))).raw().toBuffer())), 832, 160, `${backend}-preview.gif`);
  const strip: Tile[] = [];
  for (const [phase, tiles] of animatedTiles.entries()) for (const [index, tile] of tiles.entries()) {
    strip.push({ input: await sharp(tile.input).extract({ left: 12, top: 4, width: 64, height: 64 }).png().toBuffer(), left: phase * 64, top: index * 64 });
  }
  await image(WEATHER_FRAME_COUNT * 64, cases.length * 64).composite(strip).png().toFile(path.join(destination, `${backend}-icon-motion.png`));
  console.log(`Rendered ${cases.length} ${backend} weather screens, GIF previews, and filmstrip`);
}
