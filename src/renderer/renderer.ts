import sharp from "sharp";
import type { FrameBundle, Panel, RuntimeConfig } from "../core/types.js";
import type { SportsGame, WeatherAlert, WeatherSnapshot } from "../core/panels.js";
import { clockDisplay, babyAgeDisplay } from "./local-screens.js";
import { starfieldFrames, STARFIELD_DELAY_MS } from "./starfield.js";
import { weatherDisplay, WEATHER_FRAME_DELAY_MS } from "./weather.js";
import { COLORS, PixelCanvas, type Rgba } from "./canvas.js";
import { glyphWidth } from "./pixelFont.js";
import type { DisplayRenderer } from "./types.js";

export class SharpRenderer implements DisplayRenderer {
  async render(panel: Panel, now: Date, _config: RuntimeConfig): Promise<FrameBundle> {
    return renderPanel(panel, now);
  }
}

export async function renderPanel(panel: Panel, now = new Date()): Promise<FrameBundle> {
  const canvas = new PixelCanvas(COLORS.black);
  let canvases = [canvas];
  let frameDelay = WEATHER_FRAME_DELAY_MS;

  switch (panel.kind) {
    case "clock":
      renderClock(canvas, now, (panel.payload as { timezone?: string } | null)?.timezone);
      break;
    case "baby-age": {
      const baby = panel.payload as { birthDate: string; name: string; timezone: string; style?: "boy" | "girl" | "neutral" };
      renderBabyAge(canvas, babyAgeDisplay(baby.birthDate, baby.name, now, baby.timezone, baby.style));
      break;
    }
    case "starfield":
      canvases = starfieldFrames();
      frameDelay = STARFIELD_DELAY_MS;
      break;
    case "nws-alert":
      renderAlert(canvas, panel.payload as unknown as WeatherAlert);
      break;
    case "forecast": {
      const forecast = panel.payload as NonNullable<WeatherSnapshot["forecast"]>;
      canvases = weatherDisplay(forecast).iconFrames.map((icon) => {
        const page = new PixelCanvas(COLORS.black);
        renderForecast(page, forecast, icon);
        return page;
      });
      break;
    }
    case "upcoming-game":
    case "live-score":
    case "final-score":
      renderGame(canvas, panel.payload as unknown as SportsGame, panel.kind);
      break;
    default:
      renderFallback(canvas, panel.title);
  }

  const webp = await sharp(Buffer.concat(canvases.map((page) => page.raw())), {
    raw: {
      width: 64,
      height: 32 * canvases.length,
      pageHeight: 32,
      channels: 4,
    },
  })
    .webp({ lossless: true, quality: 100, loop: 0, delay: Array(canvases.length).fill(frameDelay) })
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
  const display = clockDisplay(now, timezone);
  canvas.drawText(display.time, Math.floor((64 - canvas.measureText(display.time, 3)) / 2), 3, COLORS.white, 3);
  canvas.fillRect(2, 21, 60, 1, COLORS.red);
  canvas.drawText(display.date, Math.floor((64 - canvas.measureText(display.date)) / 2), 25, COLORS.white);
}

function renderBabyAge(canvas: PixelCanvas, display: ReturnType<typeof babyAgeDisplay>): void {
  const accent = hexColor(display.accent);
  canvas.drawText(display.name, 3, 2, accent);
  const heart = [".xx..xx.", "xxxxxxxx", "xxxxxxxx", ".xxxxxx.", "..xxxx..", "...xx..."];
  for (const [y, row] of heart.entries()) for (const [x, pixel] of [...row].entries()) if (pixel === "x") canvas.setPixel(53 + x, 1 + y, accent);
  canvas.drawText(display.primary, Math.floor((64 - canvas.measureText(display.primary, 2)) / 2), 11, COLORS.ink, 2);
  canvas.drawText(display.secondary, 3, 25, hexColor(display.secondaryColor));
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

function renderForecast(canvas: PixelCanvas, forecast: NonNullable<WeatherSnapshot["forecast"]>, icon: string[]): void {
  const display = weatherDisplay(forecast);
  for (const [y, row] of icon.entries()) {
    for (const [x, pixel] of [...row].entries()) {
      const hex = display.palette[pixel];
      if (hex) canvas.setPixel(3 + x, 1 + y, hexColor(hex));
    }
  }
  const digits = display.temp.slice(0, -1);
  canvas.drawText(digits, 26, 3, COLORS.ink, 2);
  canvas.drawText("F", 28 + canvas.measureText(digits, 2), 7, COLORS.ink);
  canvas.drawText(display.summary, 3, 18, hexColor("#CBD5DF"));
  canvas.drawText(display.high, 3, 25, hexColor("#FFD15C"));
  canvas.drawText(display.low, 35, 25, hexColor("#65BFFF"));
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

function hexColor(value: string): Rgba {
  return [parseInt(value.slice(1, 3), 16), parseInt(value.slice(3, 5), 16), parseInt(value.slice(5, 7), 16), 255];
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
