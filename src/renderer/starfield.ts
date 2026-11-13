import { PixelCanvas, type Rgba } from "./canvas.js";

export const STARFIELD_FRAMES = 50;
export const STARFIELD_DELAY_MS = 80;

/** Perspective stars accelerate outward; each wraps dimly back into the distance. */
export function starfieldFrames(): PixelCanvas[] {
  const noise = (seed: number) => {
    let value = seed ^ 0x9e3779b9;
    value = Math.imul(value ^ (value >>> 16), 0x21f0aaad);
    value = Math.imul(value ^ (value >>> 15), 0x735a2d97);
    return ((value ^ (value >>> 15)) >>> 0) / 4294967296;
  };
  const stars = Array.from({ length: 48 }, (_, index) => {
    const angle = index * 2.399963229728653;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    return { dx, dy, phase: noise(index + 41),
      edge: Math.min(31 / Math.max(0.001, Math.abs(dx)), 15 / Math.max(0.001, Math.abs(dy))),
      cool: index % 5 === 0 };
  });
  return Array.from({ length: STARFIELD_FRAMES }, (_, frame) => {
    const canvas = new PixelCanvas();
    for (const star of stars) {
      const depth = (star.phase + frame / STARFIELD_FRAMES) % 1;
      const radius = 1.4 * (star.edge / 1.4) ** depth;
      const brightness = Math.round(25 + 220 * depth ** 1.7);
      const trail = depth > 0.62 ? Math.max(1, Math.floor(1 + 4 * (depth - 0.62) / 0.38)) : 0;
      for (let offset = trail; offset >= 0; offset--) {
        const distance = radius - offset;
        if (distance < 1) continue;
        const glow = Math.round(brightness * (offset === 0 ? 1 : (1 - offset / (trail + 1)) * 0.6));
        const color: Rgba = star.cool || offset > 0 ? [Math.round(glow * 0.65), Math.round(glow * 0.82), glow, 255] : [glow, glow, glow, 255];
        canvas.setPixel(Math.round(31.5 + star.dx * distance), Math.round(15.5 + star.dy * distance), color);
      }
    }
    return canvas;
  });
}
