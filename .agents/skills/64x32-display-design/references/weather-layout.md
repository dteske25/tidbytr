# Weather pixel budget

Black background, with no decorative frame. Positions are native pixels from the top-left.

| Element | Origin | Budget | Style |
| --- | --- | --- | --- |
| Animated icon | 3,1 | 16x16 | Shared hand-authored sprites |
| Forecast temperature | 26,1 | 36x15 | Pixlet 6x13, warm white |
| Condition | 3,18 | 58x6 | tom-thumb, bounded 13-character vocabulary |
| High | 3,25 | 28x6 | Amber HI label |
| Low | 35,25 | 28x6 | Blue LO label |

Sharp uses its 3x5 bitmap font, doubled temperature digits and a small F unit in the same regions. Wind and the full scrolling paragraph are intentionally omitted. Do not add another line without changing the pixel budget.

Known icons loop through eight 250 ms steps (two seconds). Only artwork moves; unknown data remains static. Sun rays shimmer, clouds shift one pixel, stars twinkle, precipitation falls, and fog/wind drift. The small lightning bolt appears once per loop; the screen never flashes. Both backends encode infinite-loop animated WebP, and Pixlet allows app changes before the loop finishes.

Use actual NWS isDaytime for night art. Preserve forecast uncertainty in short labels. Do not label a forecast-period temperature NOW. Check every decoded frame for stationary text and empty gutters. Adjacent identical frames may be coalesced: verify total duration and pixel differences, not encoded page count.
