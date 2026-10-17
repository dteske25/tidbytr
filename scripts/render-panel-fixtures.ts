import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { defaultOptions } from "../src/core/config.js";
import { clockPanel } from "../src/core/panels.js";
import type { Panel, RuntimeConfig } from "../src/core/types.js";
import { PixletRenderer } from "../src/renderer/pixlet.js";

const outputDir = path.join(process.cwd(), "docs", "assets", "render-fixtures");
const now = new Date("2026-06-28T12:00:00.000Z");
const renderer = new PixletRenderer();
const config: RuntimeConfig = {
  ...defaultOptions(),
  dataDir: "/tmp/tidbytr-fixtures",
  host: "127.0.0.1",
  port: 0,
  displayHost: "127.0.0.1",
  displayPort: 0,
  displayPollingWindowSeconds: 30,
  timezone: "America/Chicago",
};

const panels: Panel[] = [
  clockPanel(now.toISOString(), "America/Chicago"),
  panel("forecast", {
    temperature: 102,
    shortForecast: "Thunderstorms Likely And Breezy",
    windSpeed: "18 mph",
    high: 104,
    low: 78,
  }),
  panel("nws-alert", {
    id: "warning-1",
    event: "Severe Thunderstorm Warning",
    severity: "warning",
    headline: "Severe thunderstorm warning remains in effect for northeastern counties until 8 PM",
    expiresAt: "2026-06-28T20:00:00.000Z",
  }),
  panel("upcoming-game", {
    id: "kc-next",
    team: "KC",
    opponent: "DEN",
    startsAt: "2026-06-28T18:00:00.000Z",
    status: "scheduled",
  }),
  panel("live-score", {
    id: "kc-live",
    team: "KC",
    opponent: "DEN",
    startsAt: "2026-06-28T18:00:00.000Z",
    status: "live",
    teamScore: 14,
    opponentScore: 10,
    period: "Q2 08:41",
  }),
  panel("final-score", {
    id: "kc-final",
    team: "KC",
    opponent: "DEN",
    startsAt: "2026-06-28T18:00:00.000Z",
    status: "final",
    teamScore: 24,
    opponentScore: 17,
    period: "FINAL",
  }),
];

await mkdir(outputDir, { recursive: true });

for (const fixture of panels) {
  const frame = await renderer.render(fixture, now, config);
  const base = path.join(outputDir, fixture.kind);
  await writeFile(`${base}.webp`, frame.webp);
  await sharp(frame.webp, { animated: false }).png().toFile(`${base}.png`);
  console.log(`wrote ${path.relative(process.cwd(), base)}.{webp,png}`);
}

function panel(kind: Panel["kind"], payload: Panel["payload"]): Panel {
  return {
    id: kind,
    kind,
    source: kind === "forecast" || kind === "nws-alert" ? "nws" : kind === "clock" ? "clock" : "sports",
    title: kind,
    priority: 1,
    createdAt: now.toISOString(),
    ttlSeconds: 60,
    expiresAt: new Date(now.getTime() + 60_000).toISOString(),
    payload,
  };
}
