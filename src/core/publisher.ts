import fs from "node:fs/promises";
import path from "node:path";
import type { FrameBundle, PublishResult } from "./types.js";

export interface LocalDisplayPublisherOptions {
  dataDir: string;
}

export class LocalDisplayPublisher {
  readonly displayDir: string;
  readonly currentFramePath: string;

  constructor(options: LocalDisplayPublisherOptions) {
    this.displayDir = path.join(options.dataDir, "display");
    this.currentFramePath = path.join(this.displayDir, "current.webp");
  }

  async publish(frame: FrameBundle): Promise<PublishResult> {
    await fs.mkdir(this.displayDir, { recursive: true });
    const tempPath = path.join(this.displayDir, `.current-${process.pid}-${Date.now()}.webp.tmp`);
    await fs.writeFile(tempPath, frame.webp);
    await fs.rename(tempPath, this.currentFramePath);

    return {
      ok: true,
      status: 200,
      message: "published",
      attemptCount: 1,
      publishedAt: new Date().toISOString(),
      renderedAt: frame.renderedAt,
      panelId: frame.panelId,
      framePath: this.currentFramePath,
    };
  }

  async readCurrentFrame(): Promise<Buffer | null> {
    try {
      return await fs.readFile(this.currentFramePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }
}
