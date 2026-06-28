import crypto from "node:crypto";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { clockPanel } from "../src/core/panels.js";
import { renderPanel } from "../src/renderer/renderer.js";

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
});

function hash(buffer: Buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}
