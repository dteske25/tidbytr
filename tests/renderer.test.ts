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

  it("falls back to the Sharp renderer for sports panels", async () => {
    const runner = new WritingPixletRunner();
    const renderer = new PixletRenderer({ runner });
    const frame = await renderer.render(
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

    expect((await sharp(frame.webp).metadata()).width).toBe(64);
    expect(runner.calls).toHaveLength(0);
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
    const frames = await Promise.all([
      renderer.render(clockPanel(now.toISOString(), "America/Chicago"), now, testConfig()),
      renderer.render(
        panel("forecast", {
          temperature: 102,
          shortForecast: "Thunderstorms Likely And Breezy",
          windSpeed: "18 mph",
          high: 104,
          low: 78,
        }),
        now,
        testConfig(),
      ),
      renderer.render(
        panel("nws-alert", {
          id: "warning-1",
          event: "Severe Thunderstorm Warning",
          severity: "warning",
          headline: "Severe thunderstorm warning remains in effect for northeastern counties until 8 PM",
          expiresAt: "2026-06-28T20:00:00.000Z",
        }),
        now,
        testConfig(),
      ),
    ]);

    for (const frame of frames) {
      const metadata = await sharp(frame.webp).metadata();
      expect(frame.webp.length).toBeGreaterThan(20);
      expect(metadata.format).toBe("webp");
      expect(metadata.width).toBe(64);
      expect(metadata.height).toBe(32);
    }
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
