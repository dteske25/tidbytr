import type { SportsGame } from "../core/panels.js";
import type { PanelKind } from "../core/types.js";
import { COLORS, PixelCanvas, type Rgba } from "./canvas.js";
import { sportsDisplay } from "./sports-display.js";
import { SPORTS_LOGO_SIZE, sportsLogos } from "./sports-logos.js";

const DIVIDER: Rgba = [39, 48, 62, 255];
const FOOTER: Rgba = [13, 18, 26, 255];

export function renderScoreboard(canvas: PixelCanvas, game: SportsGame, kind: PanelKind, now: Date, timeZone: string): void {
  const display = sportsDisplay(game, kind, now, timeZone);
  const accent = kind === "live-score" ? COLORS.green : kind === "final-score" ? COLORS.blue : COLORS.yellow;
  for (const [index, row] of display.rows.entries()) {
    const y = index * 12;
    const logo = sportsLogos.get(row.artwork?.logo);
    const identity = identityColor(row.artwork?.color);
    if (logo) drawLogo(canvas, logo, 3, y);
    else canvas.fillRect(3, y + 2, 2, 7, identity);

    const detail = row.sets || row.standing?.record || "";
    const nameY = y + (detail ? 0 : 3);
    canvas.drawText(row.name, 17, nameY, logo ? COLORS.ink : identity);
    if (detail) canvas.drawText(detail, 17, y + 6, COLORS.muted);
    if (row.standing?.rank) {
      const rank = `#${row.standing.rank}`;
      canvas.drawText(rank, 61 - canvas.measureText(rank), nameY, accent);
    }
    const scale = canvas.measureText(row.score, 2) <= 26 ? 2 : 1;
    canvas.drawText(row.score, 61 - canvas.measureText(row.score, scale), y + (scale === 2 ? 1 : 3), COLORS.white, scale);
  }

  canvas.fillRect(2, 11, 60, 1, DIVIDER);
  canvas.fillRect(0, 24, 64, 8, FOOTER);
  canvas.fillRect(0, 24, 64, 1, DIVIDER);
  const statusWidth = canvas.measureText(display.status);
  const showSport = display.sport && statusWidth + canvas.measureText(display.sport) + 4 <= 58;
  if (showSport) canvas.drawText(display.sport, 3, 26, accent);
  let status = display.status;
  while (canvas.measureText(status) > 58) status = status.slice(0, -1).trimEnd();
  const start = showSport ? 61 - statusWidth : Math.floor((64 - canvas.measureText(status)) / 2);
  canvas.drawText(status, start, 26, kind === "live-score" ? COLORS.ink : accent);
}

function identityColor(value?: string): Rgba {
  if (!value || !/^[0-9a-f]{6}$/i.test(value)) return COLORS.muted;
  const channel = (offset: number) => Math.round(80 + parseInt(value.slice(offset, offset + 2), 16) * 175 / 255);
  return [channel(0), channel(2), channel(4), 255];
}

function drawLogo(canvas: PixelCanvas, pixels: Buffer, left: number, top: number): void {
  for (let y = 0; y < SPORTS_LOGO_SIZE; y++) {
    for (let x = 0; x < SPORTS_LOGO_SIZE; x++) {
      const i = (y * SPORTS_LOGO_SIZE + x) * 4;
      const alpha = pixels[i + 3]! / 255;
      if (alpha >= 0.28) {
        canvas.setPixel(left + x, top + y, [
          Math.round(pixels[i]! * alpha), Math.round(pixels[i + 1]! * alpha), Math.round(pixels[i + 2]! * alpha), 255,
        ]);
      }
    }
  }
}
