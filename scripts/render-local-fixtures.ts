import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { defaultOptions } from "../src/core/config.js";
import { buildPanels, clockPanel } from "../src/core/panels.js";
import type { RuntimeConfig } from "../src/core/types.js";
import { PixletRenderer } from "../src/renderer/pixlet.js";
import { SharpRenderer } from "../src/renderer/renderer.js";

const directory = path.join(process.cwd(), "docs/assets/local");
// Synthetic sample date only; personal configuration belongs in HA/dashboard settings.
const config: RuntimeConfig = { ...defaultOptions(), dataDir: "/tmp/tidbytr-local-fixtures", host: "127.0.0.1", port: 0, timezone: "UTC", babyBirthDate: "2026-03-18", babyName: "BABY" };
const now = new Date("2026-06-28T15:07:00Z");
const panels = buildPanels(config, { forecast: null, alerts: [] }, { games: [] }, now);
const cases = [
  { name: "clock-pm", panel: clockPanel(now.toISOString(), "UTC"), time: now },
  { name: "clock-midnight", panel: clockPanel(now.toISOString(), "UTC"), time: new Date("2026-06-28T00:00:00Z") },
  { name: "baby-age", panel: panels.find((panel) => panel.kind === "baby-age")!, time: now },
  { name: "starfield", panel: panels.find((panel) => panel.kind === "starfield")!, time: now },
];
await mkdir(directory, { recursive: true });
for (const [backend, renderer] of [["pixlet", new PixletRenderer()], ["sharp", new SharpRenderer()]] as const) {
  const tiles = [];
  for (const [index, fixture] of cases.entries()) {
    const frame = await renderer.render(fixture.panel, fixture.time, config);
    await writeFile(path.join(directory, `${backend}-${fixture.name}.webp`), frame.webp);
    await sharp(frame.webp).png().toFile(path.join(directory, `${backend}-${fixture.name}.png`));
    await sharp(frame.webp, { animated: true }).resize(384, 192, { kernel: "nearest" }).gif({ loop: 0 }).toFile(path.join(directory, `${backend}-${fixture.name}.gif`));
    tiles.push({ input: await sharp(frame.webp).resize(384, 192, { kernel: "nearest" }).png().toBuffer(), left: 16 + index % 2 * 400, top: 16 + Math.floor(index / 2) * 208 });
  }
  await sharp({ create: { width: 816, height: 432, channels: 4, background: "#10151e" } }).composite(tiles).png().toFile(path.join(directory, `${backend}-review.png`));
}
const stars = await new SharpRenderer().render(cases[3]!.panel, now, config);
const strip = await Promise.all([0, 13, 26, 39, 52, 65, 79, 0].map(async (page, index) => ({ input: await sharp(stars.webp, { page, pages: 1 }).resize(256, 128, { kernel: "nearest" }).png().toBuffer(), left: index % 4 * 256, top: Math.floor(index / 4) * 128 })));
await sharp({ create: { width: 1024, height: 256, channels: 4, background: "#000" } }).composite(strip).png().toFile(path.join(directory, "starfield-motion.png"));
console.log(`Rendered 12-hour clocks, a synthetic baby-age example, and animated star flight in ${directory}`);
