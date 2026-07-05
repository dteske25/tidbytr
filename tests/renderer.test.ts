import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { clockPanel } from "../src/core/panels.js";
import type { Panel, RuntimeConfig } from "../src/core/types.js";
import { PixletRenderer, type PixletProcessRunner } from "../src/renderer/pixlet.js";
import { renderPanel } from "../src/renderer/renderer.js";
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
        time: "07:00",
        blinkTime: "07 00",
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

  it("routes sports panels through Pixlet templates", async () => {
    const runner = new WritingPixletRunner();
    const renderer = new PixletRenderer({ runner });
    await renderer.render(
      panel("live-score", {
        id: "kc-live",
        team: "KC",
        opponent: "DEN",
        startsAt: "2026-06-28T18:00:00.000Z",
        status: "live",
        teamScore: 14,
        opponentScore: 10,
      }),
      new Date("2026-06-28T12:00:00.000Z"),
      testConfig(),
    );

    expect(runner.calls).toHaveLength(1);
    expect(runner.calls[0]?.args.some((arg) => arg.endsWith("app.star"))).toBe(true);
    expect(pixletPayload(runner.calls[0]?.args ?? [])).toMatchObject({
      kind: "live-score",
      display: {
        label: "LIVE",
        team: "KC",
        opponent: "DEN",
        teamScore: "14",
        opponentScore: "10",
      },
    });
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

    expect(litPixels(image, { x: 0, y: 0, width: 64, height: 3 })).toBeGreaterThan(40);
    expect(litPixels(image, { x: 5, y: 4, width: 54, height: 15 })).toBeGreaterThan(80);
    expect(litPixels(image, { x: 12, y: 21, width: 40, height: 8 })).toBeGreaterThan(20);
    expect(litPixels(image, { x: 0, y: 30, width: 64, height: 2 })).toBeGreaterThan(40);
  });

  it("keeps forecast icon, temperature, metadata, and summary regions distinct", async () => {
    const renderer = new PixletRenderer();
    const frame = await renderer.render(
      panel("forecast", {
        temperature: 102,
        shortForecast: "Thunderstorms Likely And Breezy",
        windSpeed: "18 mph",
        high: 104,
        low: 78,
      }),
      new Date("2026-06-28T12:00:00.000Z"),
      testConfig(),
    );
    const image = await firstFramePixels(frame.webp);

    expect(litPixels(image, { x: 2, y: 3, width: 27, height: 17 })).toBeGreaterThan(40);
    expect(litPixels(image, { x: 30, y: 2, width: 34, height: 14 })).toBeGreaterThan(55);
    expect(litPixels(image, { x: 30, y: 16, width: 34, height: 8 })).toBeGreaterThan(25);
    expect(litPixels(image, { x: 2, y: 24, width: 60, height: 8 })).toBeGreaterThan(20);
    expect(litPixels(image, { x: 28, y: 3, width: 2, height: 17 })).toBeLessThan(8);
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

  it("keeps live score teams and scores in stable regions", async () => {
    const renderer = new PixletRenderer();
    const frame = await renderer.render(
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
      new Date("2026-06-28T12:00:00.000Z"),
      testConfig(),
    );
    const image = await firstFramePixels(frame.webp);

    expect(litPixels(image, { x: 0, y: 0, width: 64, height: 3 })).toBeGreaterThan(40);
    expect(litPixels(image, { x: 2, y: 2, width: 27, height: 8 })).toBeGreaterThan(20);
    expect(litPixels(image, { x: 2, y: 10, width: 24, height: 9 })).toBeGreaterThan(10);
    expect(litPixels(image, { x: 38, y: 10, width: 24, height: 9 })).toBeGreaterThan(15);
    expect(litPixels(image, { x: 5, y: 19, width: 18, height: 13 })).toBeGreaterThan(20);
    expect(litPixels(image, { x: 43, y: 19, width: 18, height: 13 })).toBeGreaterThan(20);
    expect(litPixels(image, { x: 28, y: 19, width: 8, height: 5 })).toBeGreaterThan(10);
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
