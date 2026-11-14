import type { PanelKind, SourceId } from "./types.js";

export const SCREEN_GROUPS = [
  { label: "Everyday", screens: [
    { kind: "clock", label: "Clock", source: "clock" },
    { kind: "baby-age", label: "Baby age", source: "local" },
    { kind: "starfield", label: "Star flight", source: "local" },
  ] },
  { label: "Weather", screens: [
    { kind: "forecast", label: "Forecast", source: "nws" },
    { kind: "nws-alert", label: "Weather alerts", source: "nws" },
  ] },
  { label: "Sports", screens: [
    { kind: "upcoming-game", label: "Upcoming games", source: "sports" },
    { kind: "live-score", label: "Live scores", source: "sports" },
    { kind: "final-score", label: "Final scores", source: "sports" },
  ] },
] as const satisfies ReadonlyArray<{ label: string; screens: ReadonlyArray<{ kind: PanelKind; label: string; source: SourceId }> }>;

export const SCREENS = SCREEN_GROUPS.flatMap(({ screens }) => [...screens]);
