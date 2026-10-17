import type { PanelKind } from "./types.js";
export interface ScreenPolicy {
  minimumDwellSeconds: number;
  priorities: Record<PanelKind, number>;
  cooldownSeconds: Record<PanelKind, number>;
}
export const DEFAULT_SCREEN_POLICY: ScreenPolicy = {
  minimumDwellSeconds: 20,
  priorities: { clock: 0, "nws-alert": 100, forecast: 40, "upcoming-game": 45, "live-score": 85, "final-score": 65 },
  cooldownSeconds: { clock: 0, "nws-alert": 120, forecast: 300, "upcoming-game": 300, "live-score": 60, "final-score": 600 },
};
