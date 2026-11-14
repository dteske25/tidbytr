import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { clockPanel } from "../src/core/panels.js";
import type { Panel, RuntimeConfig } from "../src/core/types.js";
import { PixletRenderer, type PixletProcessRunner } from "../src/renderer/pixlet.js";
import { renderPanel, SharpRenderer } from "../src/renderer/renderer.js";
import { sportsDisplay } from "../src/renderer/sports-display.js";
import { SportsLogoCache } from "../src/renderer/sports-logos.js";
import { validateDisplayFrame } from "../src/core/publisher.js";
import { testConfig } from "./helpers/fakes.js";

describe("renderer", () => {
  it("emits a valid 64x32 WebP bundle", async () => {
    const frame = await renderPanel(clockPanel("2026-06-28T12:00:00.000Z"), new Date("2026-06-28T12:00:00.000Z"));
    const metadata = await sharp(frame.webp).metadata();

    expect(frame.width).toBe(64);
    expect(frame.height).toBe(32);
    expect(frame.mimeType).toBe("image/webp");
    expect(metadata.width).toBe(64);
    expect(metadata.height).toBe(32);
    expect(metadata.format).toBe("webp");
  });

  it("is deterministic for fixed input", async () => {
    const input = clockPanel("2026-06-28T12:00:00.000Z");
    const first = await renderPanel(input, new Date("2026-06-28T12:00:00.000Z"));
    const second = await renderPanel(input, new Date("2026-06-28T12:00:00.000Z"));

    expect(hash(first.webp)).toBe(hash(second.webp));
  });

  it("uses the clock panel timezone", async () => {
    const now = new Date("2026-06-28T12:00:00.000Z");
    const utc = await renderPanel(clockPanel(now.toISOString(), "UTC"), now);
    const chicago = await renderPanel(clockPanel(now.toISOString(), "America/Chicago"), now);

    expect(hash(utc.webp)).not.toBe(hash(chicago.webp));
  });

  it("renders long weather text without failing", async () => {
    const now = new Date("2026-06-28T12:00:00.000Z");
    const forecast = await renderPanel(
      panel("forecast", {
        temperature: 102,
        shortForecast: "Thunderstorms Likely And Breezy",
        windSpeed: "18 mph",
        high: 104,
        low: 78,
      }),
      now,
    );
    const warning = await renderPanel(
      panel("nws-alert", {
        id: "warning-1",
        event: "Severe Thunderstorm Warning",
        severity: "warning",
        headline: "Severe thunderstorm warning remains in effect for northeastern counties until 8 PM",
        expiresAt: "2026-06-28T20:00:00.000Z",
      }),
      now,
    );

    expect((await sharp(forecast.webp).metadata()).width).toBe(64);
    expect((await sharp(warning.webp).metadata()).height).toBe(32);
  });
});

describe("pixlet renderer", () => {
  it("invokes pixlet with a temp payload and render timeout", async () => {
    const runner = new WritingPixletRunner();
    const renderer = new PixletRenderer({ runner, templatesDir: "src/renderer/pixlet/templates", timeoutMs: 10_000 });
    const frame = await renderer.render(clockPanel("2026-06-28T12:00:00.000Z", "America/Chicago"), new Date("2026-06-28T12:00:00.000Z"), testConfig());

    expect(frame.encoding).toBe("webp");
    expect(runner.calls).toHaveLength(1);
    expect(runner.calls[0]?.command).toBe("pixlet");
    expect(runner.calls[0]?.args).toContain("--timeout");
    expect(runner.calls[0]?.args).toContain("10000");
    expect(runner.calls[0]?.args.some((arg) => arg.startsWith("payload_json="))).toBe(true);
    expect(runner.calls[0]?.options.timeoutMs).toBe(10_500);
  });

  it("passes deterministic display fields into Pixlet templates", async () => {
    const runner = new WritingPixletRunner();
    const renderer = new PixletRenderer({ runner, templatesDir: "src/renderer/pixlet/templates" });
    await renderer.render(clockPanel("2026-06-28T12:00:00.000Z", "America/Chicago"), new Date("2026-06-28T12:00:00.000Z"), testConfig());

    const payload = pixletPayload(runner.calls[0]?.args ?? []);

    expect(payload).toMatchObject({
      timezone: "America/Chicago",
      display: {
        time: "7:00",
        blinkTime: "7 00",
        period: "AM",
        date: "JUN 28",
      },
    });
  });

  it("surfaces pixlet process failures", async () => {
    const renderer = new PixletRenderer({
      templatesDir: "src/renderer/pixlet/templates",
      runner: {
        async run() {
          throw new Error("starlark exploded");
        },
      },
    });

    await expect(renderer.render(clockPanel("2026-06-28T12:00:00.000Z"), new Date("2026-06-28T12:00:00.000Z"), testConfig())).rejects.toThrow(
      /Pixlet render failed.*starlark exploded/,
    );
  });

  it("shares the native sports scoreboard across renderer modes", async () => {
    const runner = new WritingPixletRunner();
    const renderer = new PixletRenderer({ runner });
    const input = panel("live-score", {
      team: "KC", opponent: "DEN", startsAt: "2026-06-28T18:00:00Z",
      status: "live", home: true, teamScore: 14, opponentScore: 10,
    });
    const now = new Date("2026-06-28T12:00:00Z");
    const frame = await renderer.render(input, now, testConfig());
    expect(frame.webp).toEqual((await new SharpRenderer().render(input, now, testConfig())).webp);
    expect(runner.calls).toHaveLength(0);
  });

  it("puts volleyball set points in the main score and sets won under each team", () => {
    const now = new Date("2026-06-28T12:00:00Z");
    const game = {
      id: "volleyball", team: "NEB", opponent: "IOWA", startsAt: now.toISOString(), home: true,
      status: "live" as const, league: "volleyball/womens-college-volleyball", set: 4,
      teamScore: 2, opponentScore: 1, teamSetPoints: 24, opponentSetPoints: 0,
    };
    expect(sportsDisplay(game, "live-score", now, "UTC")).toMatchObject({
      rows: [{ name: "IOWA", score: "0", sets: "1 SET" }, { name: "NEB", score: "24", sets: "2 SETS" }],
      status: "SET 4",
    });
    expect(sportsDisplay({ ...game, teamSetPoints: undefined }, "live-score", now, "UTC").rows[1]?.score).toBe("--");
    expect(sportsDisplay(game, "final-score", now, "UTC")).toMatchObject({
      rows: [{ score: "1", sets: "" }, { score: "2", sets: "" }], status: "FINAL SETS",
    });
  });

  it("fits the sport, next-day time, overall records, and ranks on the upcoming screen", async () => {
    const now = new Date("2026-11-14T18:00:00Z");
    const game = {
      id: "match", team: "NEB", opponent: "IOWA", startsAt: "2026-11-15T12:30:00Z", home: true,
      status: "scheduled" as const, league: "volleyball/womens-college-volleyball",
      teamStanding: { record: "26-0", rank: 1 }, opponentStanding: { record: "13-16" },
    };
    expect(sportsDisplay(game, "upcoming-game", now, "UTC")).toMatchObject({
      sport: "VB", status: "NOV15 12:30P",
      rows: [{ name: "IOWA", standing: { record: "13-16" } }, { name: "NEB", standing: { record: "26-0", rank: 1 } }],
    });
    const { webp } = await renderPanel(panel("upcoming-game", game), now);
    const { data, info } = await sharp(webp).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const yellowPixels = (x: number, y: number, width: number) => {
      let count = 0;
      for (let row = y; row < y + 5; row++) {
        for (let col = x; col < x + width; col++) {
          if (data[(row * info.width + col) * 4] === 250) count++;
        }
      }
      return count;
    };
    expect(yellowPixels(3, 26, 7)).toBeGreaterThan(10);
    expect(yellowPixels(57, 26, 4)).toBeGreaterThan(5);
    expect(yellowPixels(49, 12, 12)).toBeGreaterThan(10);
    expect(yellowPixels(49, 0, 12)).toBe(0);
  });

  it("draws right-aligned three-digit scores and keeps the rows and footer distinct", async () => {
    const input = panel("live-score", {
      team: "NEB", opponent: "ISU", home: true, teamScore: 103, opponentScore: 98, period: "1:42 - 2ND",
      league: "basketball/mens-college-basketball",
    });
    const frame = await renderPanel(input);
    const image = await firstFramePixels(frame.webp);
    for (const y of [1, 13]) {
      expect(litPixels(image, { x: 17, y, width: 16, height: 10 })).toBeGreaterThan(10);
      expect(litPixels(image, { x: 39, y, width: 22, height: 10 })).toBeGreaterThan(45);
      expect(litPixels(image, { x: 61, y, width: 3, height: 10 })).toBe(0);
    }
  });

  it("renders while logos are pending and caches one bounded CDN download per URL", async () => {
    const png = await sharp({ create: { width: 20, height: 20, channels: 4, background: "#e31937" } }).png().toBuffer();
    let requests = 0;
    const cache = new SportsLogoCache(async () => {
      requests++;
      return new Response(new Uint8Array(png));
    });
    const url = "https://a.espncdn.com/i/teamlogos/ncaa/500-dark/158.png";
    expect(cache.get("https://example.org/i/teamlogos/ncaa/500-dark/158.png")).toBeUndefined();
    expect(cache.get(url)).toBeUndefined();
    expect(cache.get(url)).toBeUndefined();
    await expect.poll(() => cache.get(url)?.length).toBe(400);
    expect(requests).toBe(1);
  });

  it("uses Pixlet Marquee for NWS alert text", () => {
    const template = fs.readFileSync("src/renderer/pixlet/templates/nws-alert.star", "utf8");

    expect(template).toContain("render.Marquee");
  });
});

describe.runIf(hasPixlet())("pixlet integration", () => {
  it("renders clock, forecast, and NWS alert panels as 64x32 WebP", async () => {
    const renderer = new PixletRenderer();
    const now = new Date("2026-06-28T12:00:00.000Z");
    const frames = await Promise.all(renderFixturePanels(now).map((fixture) => renderer.render(fixture, now, testConfig())));

    for (const frame of frames) {
      const metadata = await sharp(frame.webp).metadata();
      expect(frame.webp.length).toBeGreaterThan(20);
      expect(metadata.format).toBe("webp");
      expect(metadata.width).toBe(64);
      expect(metadata.height).toBe(32);
    }
  });

  it("keeps the clock content in stable display regions", async () => {
    const renderer = new PixletRenderer();
    const frame = await renderer.render(clockPanel("2026-06-28T12:00:00.000Z", "America/Chicago"), new Date("2026-06-28T12:00:00.000Z"), testConfig());
    const image = await firstFramePixels(frame.webp);

    expect(litPixels(image, { x: 0, y: 0, width: 64, height: 3 })).toBe(0);
    expect(litPixels(image, { x: 5, y: 4, width: 54, height: 15 })).toBeGreaterThan(80);
    expect(litPixels(image, { x: 2, y: 21, width: 60, height: 1 })).toBe(60);
    expect(litPixels(image, { x: 12, y: 24, width: 40, height: 7 })).toBeGreaterThan(20);
    expect(litPixels(image, { x: 0, y: 31, width: 64, height: 1 })).toBe(0);
  });

  it("keeps weather readable for long text, zero, negative, three-digit, and missing values", async () => {
    for (const renderer of [new PixletRenderer(), new SharpRenderer()]) {
      for (const payload of [
        { temperature: 102, high: 104, low: 78, shortForecast: "Thunderstorms Likely And Breezy", windSpeed: "18 to 35 mph" },
        { temperature: 0, high: 0, low: -12, shortForecast: "Snow" },
        { temperature: -12, high: -2, low: -24, shortForecast: "Partly Cloudy", isDaytime: false },
        { temperature: -999, high: -999, low: -999, shortForecast: "Mostly Cloudy" }, {},
      ]) {
        const frame = await renderer.render(panel("forecast", payload), new Date("2026-06-28T12:00:00Z"), testConfig());
        const image = await firstFramePixels(frame.webp);
        expect(image.width).toBe(64);
        expect(image.height).toBe(32);
        expect(litPixels(image, { x: 3, y: 1, width: 16, height: 16 })).toBeGreaterThan(5);
        expect(litPixels(image, { x: 26, y: 1, width: 36, height: 15 })).toBeGreaterThan(20);
        expect(litPixels(image, { x: 3, y: 18, width: 58, height: 5 })).toBeGreaterThan(15);
        expect(litPixels(image, { x: 3, y: 25, width: 28, height: 6 })).toBeGreaterThan(10);
        expect(litPixels(image, { x: 35, y: 25, width: 28, height: 6 })).toBeGreaterThan(10);
        for (const y of [0, 17, 23, 24, 31]) expect(litPixels(image, { x: 0, y, width: 64, height: 1 })).toBe(0);
        expect(litPixels(image, { x: 19, y: 1, width: 7, height: 16 })).toBe(0);
        expect(litPixels(image, { x: 63, y: 0, width: 1, height: 32 })).toBe(0);
      }
    }
  });

  it("animates all known weather icons for two seconds with stationary text and no motion outside the icon", async () => {
    for (const renderer of [new PixletRenderer(), new SharpRenderer()]) {
      for (const [shortForecast, isDaytime] of [
        ["Sunny", true], ["Clear", false], ["Partly Cloudy", true], ["Mostly Clear", false],
        ["Cloudy", true], ["Rain", true], ["Snow", true], ["Thunderstorms", true],
        ["Fog", true], ["Windy", true], ["Freezing Rain", true], ["Rain And Snow", true], ["Unavailable", true],
      ] as const) {
        const frame = await renderer.render(panel("forecast", { temperature: 72, high: 80, low: 52, shortForecast, isDaytime }), new Date("2026-06-28T12:00:00Z"), testConfig());
        await validateDisplayFrame(frame);
        const metadata = await sharp(frame.webp, { animated: true }).metadata();
        const pages = metadata.pages ?? 1;
        if (shortForecast === "Unavailable") { expect(pages).toBe(1); continue; }
        expect(pages).toBeGreaterThan(1);
        expect(metadata.pageHeight).toBe(32);
        expect(metadata.loop).toBe(0);
        expect(metadata.delay?.reduce((sum, delay) => sum + delay, 0)).toBe(2000);
        expect(frame.webp.length).toBeLessThan(512 * 1024);
        const raw = await sharp(frame.webp, { animated: true }).ensureAlpha().raw().toBuffer();
        const motion = new Set<string>();
        const stationary = new Set<string>();
        for (let page = 0; page < pages; page++) {
          const pixels = raw.subarray(page * 64 * 32 * 4, (page + 1) * 64 * 32 * 4);
          motion.add(hash(pixels));
          const masked = Buffer.from(pixels);
          for (let y = 1; y < 17; y++) masked.fill(0, (y * 64 + 3) * 4, (y * 64 + 19) * 4);
          stationary.add(hash(masked));
        }
        expect(motion.size).toBeGreaterThan(1);
        expect(stationary.size).toBe(1);
      }
    }
  });

  it("uses different actual artwork for sunny, rain, snow, and clear nights", async () => {
    const renderer = new PixletRenderer();
    const icons = [];
    for (const payload of [{ shortForecast: "Sunny" }, { shortForecast: "Rain" }, { shortForecast: "Snow" }, { shortForecast: "Clear", isDaytime: false }]) {
      const frame = await renderer.render(panel("forecast", { temperature: 72, ...payload }), new Date("2026-06-28T12:00:00Z"), testConfig());
      icons.push(hash(await sharp(frame.webp).extract({ left: 3, top: 1, width: 16, height: 16 }).raw().toBuffer()));
    }
    expect(new Set(icons).size).toBe(4);
  });

  it("keeps NWS alert chrome, severity, marquee, and detail text visible", async () => {
    const renderer = new PixletRenderer();
    const frame = await renderer.render(
      panel("nws-alert", {
        id: "warning-1",
        event: "Severe Thunderstorm Warning",
        severity: "warning",
        headline: "Severe thunderstorm warning remains in effect for northeastern counties until 8 PM",
        expiresAt: "2026-06-28T20:00:00.000Z",
      }),
      new Date("2026-06-28T12:00:00.000Z"),
      testConfig(),
    );
    const metadata = await sharp(frame.webp).metadata();
    const image = await firstFramePixels(frame.webp);

    expect((metadata.pages ?? 1)).toBeGreaterThan(1);
    expect(litPixels(image, { x: 0, y: 0, width: 64, height: 2 })).toBeGreaterThan(50);
    expect(litPixels(image, { x: 2, y: 2, width: 36, height: 8 })).toBeGreaterThan(25);
    expect(litPixels(image, { x: 39, y: 2, width: 23, height: 8 })).toBeGreaterThan(12);
    expect(litPixels(image, { x: 2, y: 10, width: 60, height: 10 })).toBeGreaterThan(30);
    expect(litPixels(image, { x: 2, y: 21, width: 60, height: 9 })).toBeGreaterThan(20);
  });


});

function hash(buffer: Buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function panel(kind: Panel["kind"], payload: Panel["payload"]): Panel {
  return {
    id: kind,
    kind,
    source: kind === "forecast" || kind === "nws-alert" ? "nws" : "clock",
    title: kind,
    priority: 1,
    createdAt: "2026-06-28T12:00:00.000Z",
    ttlSeconds: 60,
    expiresAt: "2026-06-28T12:01:00.000Z",
    payload,
  };
}

function renderFixturePanels(now: Date): Panel[] {
  return [
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
}

class WritingPixletRunner implements PixletProcessRunner {
  calls: Array<{ command: string; args: string[]; options: { timeoutMs: number; cwd?: string } }> = [];

  async run(command: string, args: string[], options: { timeoutMs: number; cwd?: string }): Promise<void> {
    this.calls.push({ command, args, options });
    const output = outputPath(args);
    await sharp({
      create: {
        width: 64,
        height: 32,
        channels: 4,
        background: "#000000ff",
      },
    })
      .webp({ lossless: true })
      .toFile(output);
  }
}

function outputPath(args: string[]): string {
  const outputFlag = args.indexOf("--output");
  const output = args[outputFlag + 1];
  if (outputFlag === -1 || !output) {
    throw new Error("Missing --output argument");
  }

  return output;
}

function hasPixlet(): boolean {
  return spawnSync("pixlet", ["--help"], { stdio: "ignore" }).status === 0;
}

function pixletPayload(args: string[]): Record<string, unknown> {
  const payloadArg = args.find((arg) => arg.startsWith("payload_json="));
  if (!payloadArg) {
    throw new Error("Missing payload_json argument");
  }

  return JSON.parse(payloadArg.slice("payload_json=".length)) as Record<string, unknown>;
}

interface DecodedFrame {
  data: Buffer;
  width: number;
  height: number;
}

interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function firstFramePixels(webp: Buffer): Promise<DecodedFrame> {
  const decoded = await sharp(webp, { animated: false }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return {
    data: decoded.data,
    width: decoded.info.width,
    height: decoded.info.height,
  };
}

function litPixels(image: DecodedFrame, region: Region): number {
  let count = 0;
  const endX = Math.min(image.width, region.x + region.width);
  const endY = Math.min(image.height, region.y + region.height);

  for (let y = Math.max(0, region.y); y < endY; y += 1) {
    for (let x = Math.max(0, region.x); x < endX; x += 1) {
      const offset = (y * image.width + x) * 4;
      const brightness = (image.data[offset] ?? 0) + (image.data[offset + 1] ?? 0) + (image.data[offset + 2] ?? 0);
      if (brightness > 30) {
        count += 1;
      }
    }
  }

  return count;
}
