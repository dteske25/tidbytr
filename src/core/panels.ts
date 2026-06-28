import type { AlertSeverity, Panel, RuntimeConfig } from "./types.js";

export interface WeatherSnapshot {
  alerts: WeatherAlert[];
  forecast: {
    temperature: number;
    shortForecast: string;
    windSpeed?: string;
    high?: number;
    low?: number;
  } | null;
}

export interface WeatherAlert {
  id: string;
  event: string;
  severity: AlertSeverity;
  headline: string;
  expiresAt: string;
}

export interface SportsSnapshot {
  games: SportsGame[];
}

export interface SportsGame {
  id: string;
  team: string;
  opponent: string;
  startsAt: string;
  status: "scheduled" | "live" | "final";
  teamScore?: number;
  opponentScore?: number;
  period?: string;
}

export function buildPanels(config: RuntimeConfig, weather: WeatherSnapshot, sports: SportsSnapshot, now = new Date()): Panel[] {
  const createdAt = now.toISOString();
  const panels: Panel[] = [clockPanel(createdAt)];

  if (weather.forecast) {
    panels.push({
      id: "forecast",
      kind: "forecast",
      source: "nws",
      title: "NWS forecast",
      priority: 40,
      createdAt,
      ttlSeconds: 900,
      expiresAt: addSeconds(now, 900),
      payload: weather.forecast,
    });
  }

  for (const alert of weather.alerts) {
    panels.push({
      id: `nws-${safeId(alert.id)}`,
      kind: "nws-alert",
      source: "nws",
      title: alert.event,
      priority: alert.severity === "warning" ? 100 : alert.severity === "watch" ? 90 : 70,
      createdAt,
      ttlSeconds: Math.max(60, Math.floor((Date.parse(alert.expiresAt) - now.getTime()) / 1000)),
      expiresAt: alert.expiresAt,
      critical: alert.severity === "warning" || alert.severity === "watch",
      payload: alert,
    });
  }

  for (const game of sports.games) {
    panels.push(gamePanel(game, createdAt, now));
  }

  return panels;
}

export function clockPanel(createdAt = new Date().toISOString()): Panel {
  return {
    id: "clock",
    kind: "clock",
    source: "clock",
    title: "Calm clock",
    priority: 0,
    createdAt,
    ttlSeconds: 60,
    expiresAt: addSeconds(new Date(createdAt), 60),
    payload: {
      timezone: "local",
    },
  };
}

function gamePanel(game: SportsGame, createdAt: string, now: Date): Panel {
  if (game.status === "live") {
    return {
      id: `sports-${safeId(game.id)}`,
      kind: "live-score",
      source: "sports",
      title: `${game.team} live`,
      priority: 85,
      createdAt,
      ttlSeconds: 90,
      expiresAt: addSeconds(now, 90),
      payload: game,
    };
  }

  if (game.status === "final") {
    return {
      id: `sports-${safeId(game.id)}`,
      kind: "final-score",
      source: "sports",
      title: `${game.team} final`,
      priority: 65,
      createdAt,
      ttlSeconds: 3600,
      expiresAt: addSeconds(now, 3600),
      payload: game,
    };
  }

  return {
    id: `sports-${safeId(game.id)}`,
    kind: "upcoming-game",
    source: "sports",
    title: `${game.team} upcoming`,
    priority: 45,
    createdAt,
    ttlSeconds: 1800,
    expiresAt: addSeconds(now, 1800),
    payload: game,
  };
}

function addSeconds(date: Date, seconds: number): string {
  return new Date(date.getTime() + seconds * 1000).toISOString();
}

function safeId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
}
