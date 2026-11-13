import { PixelCanvas, type Rgba } from "./canvas.js";

export const STARFIELD_FRAMES = 80;
export const STARFIELD_DELAY_MS = 50;

/** Perspective stars accelerate outward; each wraps dimly back into the distance.
 * Speed-linked tails reference the motion design of gabe565's Starfield:
 * https://github.com/tidbyt/community/blob/main/apps/starfield/starfield.star
 * This renderer keeps independently phased, deterministic seamless orbits.
 */
export function starfieldFrames(): PixelCanvas[] {
  const noise = (seed: number) => {
    let value = seed ^ 0x9e3779b9;
    value = Math.imul(value ^ (value >>> 16), 0x21f0aaad);
    value = Math.imul(value ^ (value >>> 15), 0x735a2d97);
    return ((value ^ (value >>> 15)) >>> 0) / 4294967296;
  };
  const stars = Array.from({ length: 64 }, (_, index) => {
    const angle = index * 2.399963229728653;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    return { dx, dy, phase: noise(index + 41),
      // Travel beyond the display before wrapping so the entire tail exits.
      edge: Math.min(31.5 / Math.max(0.001, Math.abs(dx)), 15.5 / Math.max(0.001, Math.abs(dy))) + 11,
      cycles: index % 4 === 0 ? 2 : 3,
      cool: index % 5 === 0 };
  });
  return Array.from({ length: STARFIELD_FRAMES }, (_, frame) => {
    const canvas = new PixelCanvas();
    for (const star of stars) {
      const depth = (star.phase + star.cycles * frame / STARFIELD_FRAMES) % 1;
      const radius = 3 * (star.edge / 3) ** depth;
      const brightness = Math.round(40 + 205 * depth ** 1.3);
      // Cover roughly three frames of travel: faster, nearer stars leave longer streaks.
      const previousRadius = radius / (star.edge / 3) ** (star.cycles * 3 / STARFIELD_FRAMES);
      const trail = Math.min(10, Math.max(1, Math.round(radius - previousRadius)));
      for (let offset = trail; offset >= 0; offset--) {
        const distance = radius - offset;
        if (distance < 3) continue;
        const glow = Math.round(brightness * (offset === 0 ? 1 : (1 - offset / (trail + 1)) * 0.8));
        const color: Rgba = star.cool || offset > 0 ? [Math.round(glow * 0.85), Math.round(glow * 0.82), glow, 255] : [glow, glow, glow, 255];
        canvas.setPixel(Math.round(31.5 + star.dx * distance), Math.round(15.5 + star.dy * distance), color);
      }
    }
    return canvas;
  });
}
