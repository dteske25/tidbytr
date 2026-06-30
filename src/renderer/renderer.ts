import sharp from "sharp";
import type { FrameBundle, Panel, RuntimeConfig } from "../core/types.js";
import type { SportsGame, WeatherAlert, WeatherSnapshot } from "../core/panels.js";
import { COLORS, PixelCanvas } from "./canvas.js";
import { glyphWidth } from "./pixelFont.js";
import type { DisplayRenderer } from "./types.js";

export class SharpRenderer implements DisplayRenderer {
  async render(panel: Panel, now: Date, _config: RuntimeConfig): Promise<FrameBundle> {
    return renderPanel(panel, now);
  }
}

export async function renderPanel(panel: Panel, now = new Date()): Promise<FrameBundle> {
  const canvas = new PixelCanvas(COLORS.black);

  switch (panel.kind) {
    case "clock":
      renderClock(canvas, now, (panel.payload as { timezone?: string } | null)?.timezone);
      break;
    case "nws-alert":
      renderAlert(canvas, panel.payload as unknown as WeatherAlert);
      break;
    case "forecast":
      renderForecast(canvas, panel.payload as unknown as NonNullable<WeatherSnapshot["forecast"]>);
      break;
    case "upcoming-game":
    case "live-score":
    case "final-score":
      renderGame(canvas, panel.payload as unknown as SportsGame, panel.kind);
      break;
    default:
      renderFallback(canvas, panel.title);
  }

  const webp = await sharp(canvas.raw(), {
    raw: {
      width: 64,
      height: 32,
      channels: 4,
    },
  })
    .webp({ lossless: true, quality: 100 })
    .toBuffer();

  return {
    panelId: panel.id,
    width: 64,
    height: 32,
    mimeType: "image/webp",
    encoding: "webp",
    webp,
    renderedAt: now.toISOString(),
  };
}

function renderClock(canvas: PixelCanvas, now: Date, timezone = "UTC"): void {
  const time = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: timezone,
  }).format(now);
  const date = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    timeZone: timezone,
  })
    .format(now)
    .toUpperCase()
    .replace(",", "");

  canvas.drawText(time, 6, 7, COLORS.white, 2);
  canvas.drawText(date, 15, 23, COLORS.blue, 1);
  canvas.fillRect(2, 2, 60, 2, COLORS.green);
  canvas.fillRect(2, 29, 60, 1, COLORS.navy);
}

function renderAlert(canvas: PixelCanvas, alert: WeatherAlert): void {
  const color = alert.severity === "warning" ? COLORS.red : alert.severity === "watch" ? COLORS.orange : COLORS.yellow;
  canvas.drawFrame(color);
  canvas.drawText(alert.severity.toUpperCase(), 3, 3, color, 1);
  const lines = wrapText(`${alert.event} ${alert.headline}`, 58, 3);
  canvas.drawText(lines[0] ?? "NWS ALERT", 3, 11, COLORS.white, 1);
  canvas.drawText(lines[1] ?? "", 3, 18, COLORS.muted, 1);
  canvas.drawText(lines[2] ?? "", 3, 25, COLORS.muted, 1);
}

function renderForecast(canvas: PixelCanvas, forecast: NonNullable<WeatherSnapshot["forecast"]>): void {
  const temp = `${forecast.temperature}F`;
  canvas.drawText(temp, Math.max(31, 62 - canvas.measureText(temp, 2)), 4, COLORS.white, 2);
  drawSun(canvas, 11, 9);
  drawCloud(canvas, 12, 17);
  if (forecast.high || forecast.low) {
    canvas.drawText(`H${forecast.high ?? "-"} L${forecast.low ?? "-"}`, 34, 18, COLORS.muted, 1);
  }
  canvas.drawText(fitText(forecast.shortForecast, 58), 4, 25, COLORS.blue, 1);
}

function renderGame(canvas: PixelCanvas, game: SportsGame, kind: Panel["kind"]): void {
  const accent = kind === "live-score" ? COLORS.green : kind === "final-score" ? COLORS.blue : COLORS.yellow;
  const label = kind === "live-score" ? "LIVE" : kind === "final-score" ? "FINAL" : "NEXT";
  canvas.drawText(label, 2, 2, accent, 1);
  canvas.drawText(trim(game.team, 5), 2, 10, COLORS.white, 1);
  canvas.drawText(trim(game.opponent, 5), 39, 10, COLORS.white, 1);
  canvas.drawText(`${game.teamScore ?? 0}`, 7, 19, COLORS.white, 2);
  canvas.drawText(`${game.opponentScore ?? 0}`, 45, 19, COLORS.white, 2);
  canvas.fillRect(28, 15, 8, 2, accent);
  canvas.drawText(trim(game.period ?? formatGameTime(game.startsAt), 11), 12, 3, COLORS.muted, 1);
}

function renderFallback(canvas: PixelCanvas, title: string): void {
  canvas.drawFrame(COLORS.blue);
  canvas.drawText(trim(title, 14), 4, 13, COLORS.white, 1);
}

function drawSun(canvas: PixelCanvas, centerX: number, centerY: number): void {
  canvas.fillRect(centerX - 3, centerY - 3, 7, 7, COLORS.yellow);
  canvas.fillRect(centerX, centerY - 7, 1, 3, COLORS.yellow);
  canvas.fillRect(centerX, centerY + 5, 1, 3, COLORS.yellow);
  canvas.fillRect(centerX - 7, centerY, 3, 1, COLORS.yellow);
  canvas.fillRect(centerX + 5, centerY, 3, 1, COLORS.yellow);
}

function drawCloud(canvas: PixelCanvas, x: number, y: number): void {
  canvas.fillRect(x, y, 15, 5, COLORS.white);
  canvas.fillRect(x + 4, y - 3, 9, 5, COLORS.white);
  canvas.fillRect(x + 14, y + 1, 8, 4, COLORS.white);
}

function trim(value: string, max: number): string {
  const normalized = value.toUpperCase().replaceAll(/[^A-Z0-9:/ -]/g, "");
  return normalized.length > max ? normalized.slice(0, max) : normalized;
}

function fitText(value: string, maxPixels: number): string {
  let normalized = trim(value, 80);
  while (normalized.length > 0 && textWidth(normalized) > maxPixels) {
    normalized = normalized.slice(0, -1).trimEnd();
  }

  return normalized;
}

function wrapText(value: string, maxPixels: number, maxLines: number): string[] {
  const words = trim(value, 160).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (textWidth(candidate) <= maxPixels) {
      current = candidate;
      continue;
    }

    if (current) {
      lines.push(current);
    }

    current = fitText(word, maxPixels);
    if (lines.length === maxLines - 1) {
      break;
    }
  }

  if (current && lines.length < maxLines) {
    lines.push(fitText(current, maxPixels));
  }

  return lines;
}

function textWidth(value: string): number {
  const chars = [...value.toUpperCase()];
  return chars.reduce((total, char, index) => total + glyphWidth(char) + (index === chars.length - 1 ? 0 : 1), 0);
}

function formatGameTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "TBD";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    hour: "numeric",
    timeZone: "UTC",
  })
    .format(date)
    .toUpperCase()
    .replace(",", "");
}
