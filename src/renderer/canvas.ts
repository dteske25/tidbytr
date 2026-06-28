import { glyphFor, glyphWidth } from "./pixelFont.js";

export type Rgba = [number, number, number, number];

export const COLORS = {
  black: [0, 0, 0, 255] as Rgba,
  ink: [241, 245, 249, 255] as Rgba,
  muted: [148, 163, 184, 255] as Rgba,
  green: [34, 197, 94, 255] as Rgba,
  yellow: [250, 204, 21, 255] as Rgba,
  orange: [251, 146, 60, 255] as Rgba,
  red: [239, 68, 68, 255] as Rgba,
  blue: [56, 189, 248, 255] as Rgba,
  navy: [15, 23, 42, 255] as Rgba,
  white: [255, 255, 255, 255] as Rgba,
};

export class PixelCanvas {
  readonly width = 64;
  readonly height = 32;
  private readonly pixels = Buffer.alloc(this.width * this.height * 4);

  constructor(background: Rgba = COLORS.black) {
    this.clear(background);
  }

  clear(color: Rgba): void {
    for (let index = 0; index < this.pixels.length; index += 4) {
      this.pixels[index] = color[0];
      this.pixels[index + 1] = color[1];
      this.pixels[index + 2] = color[2];
      this.pixels[index + 3] = color[3];
    }
  }

  setPixel(x: number, y: number, color: Rgba): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) {
      return;
    }

    const index = (Math.floor(y) * this.width + Math.floor(x)) * 4;
    this.pixels[index] = color[0];
    this.pixels[index + 1] = color[1];
    this.pixels[index + 2] = color[2];
    this.pixels[index + 3] = color[3];
  }

  fillRect(x: number, y: number, width: number, height: number, color: Rgba): void {
    for (let yy = y; yy < y + height; yy += 1) {
      for (let xx = x; xx < x + width; xx += 1) {
        this.setPixel(xx, yy, color);
      }
    }
  }

  drawText(text: string, x: number, y: number, color: Rgba, scale = 1): number {
    let cursor = x;
    for (const char of text.toUpperCase()) {
      const glyph = glyphFor(char);
      for (let row = 0; row < glyph.length; row += 1) {
        const line = glyph[row] ?? "";
        for (let col = 0; col < line.length; col += 1) {
          if (line[col] === "1") {
            this.fillRect(cursor + col * scale, y + row * scale, scale, scale, color);
          }
        }
      }
      cursor += (glyphWidth(char) + 1) * scale;
    }

    return cursor;
  }

  drawFrame(color: Rgba): void {
    this.fillRect(0, 0, this.width, 1, color);
    this.fillRect(0, this.height - 1, this.width, 1, color);
    this.fillRect(0, 0, 1, this.height, color);
    this.fillRect(this.width - 1, 0, 1, this.height, color);
  }

  raw(): Buffer {
    return Buffer.from(this.pixels);
  }
}
