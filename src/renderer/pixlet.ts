import { spawn } from "node:child_process";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FrameBundle, Panel, RuntimeConfig } from "../core/types.js";
import { SharpRenderer } from "./renderer.js";
import type { DisplayRenderer } from "./types.js";

export interface PixletProcessRunner {
  run(command: string, args: string[], options: { timeoutMs: number; cwd?: string }): Promise<void>;
}

export interface PixletRendererOptions {
  pixletBinary?: string;
  templatesDir?: string;
  timeoutMs?: number;
  fallbackRenderer?: DisplayRenderer;
  runner?: PixletProcessRunner;
}

const supportedPixletPanels = new Set<Panel["kind"]>(["clock", "forecast", "nws-alert"]);

export class PixletRenderer implements DisplayRenderer {
  private readonly pixletBinary: string;
  private readonly templatesDir: string;
  private readonly timeoutMs: number;
  private readonly fallbackRenderer: DisplayRenderer;
  private readonly runner: PixletProcessRunner;

  constructor(options: PixletRendererOptions = {}) {
    this.pixletBinary = options.pixletBinary ?? process.env.TIDBYTR_PIXLET_BIN ?? "pixlet";
    this.templatesDir = options.templatesDir ?? defaultTemplatesDir();
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.fallbackRenderer = options.fallbackRenderer ?? new SharpRenderer();
    this.runner = options.runner ?? new SpawnPixletRunner();
  }

  async render(panel: Panel, now: Date, config: RuntimeConfig): Promise<FrameBundle> {
    if (!supportedPixletPanels.has(panel.kind)) {
      return this.fallbackRenderer.render(panel, now, config);
    }

    const tempDir = await mkdtemp(path.join(os.tmpdir(), "tidbytr-pixlet-"));
    try {
      const payload = this.buildPayload(panel, now, config);
      const payloadPath = path.join(tempDir, "payload.json");
      const templatePath = path.join(tempDir, "app.star");
      const outputPath = path.join(tempDir, `${panel.kind}.webp`);
      await writeFile(payloadPath, JSON.stringify(payload), "utf8");
      await copyFile(path.join(this.templatesDir, `${panel.kind}.star`), templatePath);

      await this.runner.run(
        this.pixletBinary,
        [
          "render",
          "--output",
          outputPath,
          "--width",
          "64",
          "--height",
          "32",
          "--timeout",
          String(this.timeoutMs),
          "--silent",
          templatePath,
          `payload_json=${JSON.stringify(payload)}`,
          `payload_path=${payloadPath}`,
        ],
        { timeoutMs: this.timeoutMs + 500, cwd: tempDir },
      );

      const webp = await readFile(outputPath);
      return {
        panelId: panel.id,
        width: 64,
        height: 32,
        mimeType: "image/webp",
        encoding: "webp",
        webp,
        renderedAt: now.toISOString(),
      };
    } catch (error) {
      throw new Error(`Pixlet render failed for ${panel.kind}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }

  private buildPayload(panel: Panel, now: Date, config: RuntimeConfig): Record<string, unknown> {
    return {
      panelId: panel.id,
      kind: panel.kind,
      title: panel.title,
      payload: panel.payload,
      renderedAt: now.toISOString(),
      timezone: config.timezone,
    };
  }
}

export class SpawnPixletRunner implements PixletProcessRunner {
  run(command: string, args: string[], options: { timeoutMs: number; cwd?: string }): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd: options.cwd,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      let settled = false;
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        settle(new Error(`timed out after ${options.timeoutMs}ms`));
      }, options.timeoutMs);

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.on("error", (error) => settle(error));
      child.on("close", (code) => {
        if (code === 0) {
          settle();
          return;
        }

        const detail = stderr.trim() || stdout.trim() || `exit code ${code ?? "unknown"}`;
        settle(new Error(detail));
      });

      function settle(error?: Error): void {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      }
    });
  }
}

export function createDefaultRenderer(): DisplayRenderer {
  if (process.env.TIDBYTR_RENDERER === "sharp") {
    return new SharpRenderer();
  }

  return new PixletRenderer();
}

function defaultTemplatesDir(): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "pixlet", "templates");
}
