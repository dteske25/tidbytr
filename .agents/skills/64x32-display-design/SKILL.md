---
name: 64x32-display-design
description: Design and review Tidbytr's 64x32 LED screens, including pixel art, typography, bounded labels, and animated Pixlet/Sharp output.
---

# Design for 2,048 LEDs

Design at 64 by 32 native pixels. Inspect actual output at native size and integer nearest-neighbor zoom before and after changing it.

1. Read the template, payload adapter, provider fields, and visual tests. Render an existing representative screen.
2. Choose one primary fact. Allocate integer rectangles for art, primary and secondary text, and gaps. Budget glyph width and height. Omit secondary information before shrinking the primary fact.
3. Draw art on its final pixel grid with recognizable silhouettes, black backgrounds, hard edges, and a restrained palette. Share sprites across backends. Avoid blurry scaled illustrations, emoji, arbitrary circles, and low-contrast decoration.
4. Bind artwork to actual conditions. Use provider day/night data, preserve zero/negative values, and use neutral artwork for unknown data. A forecast-period temperature is not a current observation.
5. Keep separate text baselines and concise labels. Requested animations must keep text still and stay inside the icon rectangle. Inspect all frames and the loop boundary. Never flash the whole screen.
6. Render long text, negative/three-digit temperatures, zero, missing values, and distinct conditions in both backends. Inspect PNGs, GIF previews, and frame filmstrips for clipping, misleading icons, edge bleed, and contrast.
7. Test user-visible contracts: bounds, gaps, meaningful condition differences, preserved values, duration, and stationary text across every decoded animation frame. Do not weaken thresholds to hide visual defects.
8. Run release verification, regenerate the add-on bundle, and commit source and bundle together. Say whether physical-device testing remains outstanding.

`pnpm render:fixtures` renders the general screen set. `pnpm render:weather` produces native PNG/WebP, GIF previews, galleries, and icon filmstrips. Ensure Pixlet v0.34.0 is on PATH.

`src/renderer/weather.ts` owns weather interpretation and 16x16 sprites shared by Pixlet/Sharp. `src/renderer/pixlet/templates/forecast.star` owns the Pixlet layout. Starlark strings are not iterable: use `range(len(row))` and `row[x]`.

See [weather layout](references/weather-layout.md). Encoders may combine identical frames: test total duration rather than a fixed encoded page count. Sharp requires a delay for every input frame; a scalar applies only to the first.

Run `pnpm package:addon` and `pnpm verify:release` after source changes. Concept art can help exploration, but production sprites still need pixel-level authoring and actual renderer review.
