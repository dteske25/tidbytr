import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { FrameBundle, PublishResult } from "./types.js";
export interface LocalDisplayPublisherOptions { dataDir: string; }
export class LocalDisplayPublisher {
  readonly displayDir: string;
  readonly currentFramePath: string;
  constructor(options: LocalDisplayPublisherOptions) {
    this.displayDir = path.join(options.dataDir, "display");
    this.currentFramePath = path.join(this.displayDir, "current.webp");
  }
  async publish(frame: FrameBundle): Promise<PublishResult> {
    await validateDisplayFrame(frame);
    await fs.mkdir(this.displayDir, { recursive: true });
    const temporary = path.join(this.displayDir, `.current-${randomUUID()}.webp.tmp`);
    try { await fs.writeFile(temporary, frame.webp); await fs.rename(temporary, this.currentFramePath); }
    finally { await fs.rm(temporary, { force: true }); }
    return { ok: true, status: 200, message: "published", attemptCount: 1, publishedAt: new Date().toISOString(), renderedAt: frame.renderedAt, panelId: frame.panelId, framePath: this.currentFramePath };
  }
  async readCurrentFrame(): Promise<Buffer | null> {
    try { return await fs.readFile(this.currentFramePath); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  }
}
export async function validateDisplayFrame(frame: FrameBundle): Promise<void> {
  if (frame.webp.length > 512 * 1024) throw new Error("Frame exceeds HDK's 512 KiB limit");
  const metadata = await sharp(frame.webp, { animated: false }).metadata();
  if (metadata.format !== "webp" || metadata.width !== 64 || (metadata.pageHeight ?? metadata.height) !== 32) throw new Error("Frame must be a 64x32 WebP");
  await sharp(frame.webp, { animated: false }).raw().toBuffer();
}
