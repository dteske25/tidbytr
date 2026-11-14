import { configuredChildren, childPanelId } from "./children.js";
import { calendarAge } from "./age.js";
import { createHash } from "node:crypto";
import type { AlertSeverity, Panel, RuntimeConfig } from "./types.js";

export interface WeatherSnapshot {
  alerts: WeatherAlert[];
  alertsObservedAt?: string;
  forecastObservedAt?: string;
  forecast: {
    temperature: number;
    shortForecast: string;
    windSpeed?: string;
    isDaytime?: boolean;
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
  timeTbd?: boolean;
  home?: boolean;
  teamScore?: number;
  opponentScore?: number;
  period?: string;
  set?: number;
  teamSetPoints?: number;
  opponentSetPoints?: number;
  scoreChangedAt?: string;
  feed?: string;
  observedAt?: string;
  completedAt?: string;
  league?: string;
}

export function buildPanels(config: RuntimeConfig, weather: WeatherSnapshot, sports: SportsSnapshot, now = new Date()): Panel[] {
  const createdAt = now.toISOString();
  const panels: Panel[] = [clockPanel(createdAt, config.timezone)];
  for (const child of configuredChildren(config)) {
    const age = calendarAge(child.birthDate, now, config.timezone);
    if (!age) continue;
    panels.push({ id: childPanelId(child), kind: "baby-age", source: "local", title: `${child.name}'s age`,
      priority: 25, createdAt, ttlSeconds: 60, expiresAt: addSeconds(now, 60),
      payload: { birthDate: child.birthDate, name: child.name, style: child.style, timezone: config.timezone, ageDays: age.totalDays } });
  }
  if (config.starfieldEnabled) panels.push({ id: "starfield", kind: "starfield", source: "local", title: "Star flight",
    priority: 10, createdAt, ttlSeconds: 60, expiresAt: addSeconds(now, 60), payload: {} });

  const forecastTime = weather.forecastObservedAt ?? createdAt;
  if (weather.forecast && Date.parse(forecastTime) + 900_000 > now.getTime()) {
    panels.push({
      id: "forecast",
      kind: "forecast",
      source: "nws",
      title: "NWS forecast",
      priority: 40,
      createdAt: forecastTime,
      ttlSeconds: 900,
      expiresAt: addSeconds(new Date(forecastTime), 900),
      payload: weather.forecast,
    });
  }

  for (const alert of weather.alerts) {
    const observedAt = weather.alertsObservedAt ?? createdAt;
    const validUntil = Math.min(Date.parse(alert.expiresAt), Date.parse(observedAt) + 900_000);
    if (!Number.isFinite(validUntil) || validUntil <= now.getTime()) continue;
    panels.push({
      id: `nws-${safeId(alert.id)}`,
      kind: "nws-alert",
      source: "nws",
      title: alert.event,
      priority: alert.severity === "warning" ? 100 : alert.severity === "watch" ? 90 : 70,
      createdAt,
      ttlSeconds: Math.max(60, Math.floor((Date.parse(alert.expiresAt) - now.getTime()) / 1000)),
      expiresAt: new Date(validUntil).toISOString(),
      critical: alert.severity === "warning" || alert.severity === "watch",
      payload: alert,
    });
  }

  for (const game of sports.games) {
    const observedAt = game.observedAt ?? createdAt;
    if (!Number.isFinite(Date.parse(game.startsAt))) continue;
    if (game.status === "scheduled" && (Date.parse(game.startsAt) - now.getTime() > 86400_000 || Date.parse(game.startsAt) < now.getTime() - 3600_000)) continue;
    const candidate = gamePanel(game, observedAt);
    if (Date.parse(candidate.expiresAt) > now.getTime()) panels.push(candidate);
  }

  return panels.map((panel) => ({ ...panel, priority: config.screenPolicy.priorities[panel.kind] - (panel.kind === "nws-alert" ? 100 - panel.priority : 0), version: panelVersion(panel) }));
}

export function clockPanel(createdAt = new Date().toISOString(), timezone = "UTC"): Panel {
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
      timezone,
    },
  };
}

function gamePanel(game: SportsGame, createdAt: string): Panel {
  const id = `sports-${game.feed && game.feed !== game.league ? safeId(game.league ?? "") + "-" : ""}${safeId(game.id)}`;
  if (game.status === "live") {
    return {
      id,
      kind: "live-score",
      source: "sports",
      title: `${game.team} live`,
      priority: 85,
      createdAt,
      scoreChangedAt: game.scoreChangedAt,
      ttlSeconds: 90,
      expiresAt: addSeconds(new Date(createdAt), 90),
      payload: game,
    };
  }

  if (game.status === "final") {
    return {
      id,
      kind: "final-score",
      source: "sports",
      title: `${game.team} final`,
      priority: 65,
      createdAt,
      scoreChangedAt: game.scoreChangedAt,
      ttlSeconds: 3600,
      expiresAt: addSeconds(new Date(game.completedAt ?? createdAt), 3600),
      payload: game,
    };
  }

  return {
    id,
    kind: "upcoming-game",
    source: "sports",
    title: `${game.team} upcoming`,
    priority: 45,
    createdAt,
    ttlSeconds: 1800,
    expiresAt: addSeconds(new Date(createdAt), 1800),
    payload: game,
  };
}

function addSeconds(date: Date, seconds: number): string {
  return new Date(date.getTime() + seconds * 1000).toISOString();
}

function safeId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
}

export function panelVersion(panel: Panel): string {
  const payload = panel.source === "sports" ? sportsVersion(panel.payload as SportsGame) : panel.payload;
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 16);
}

function sportsVersion(game: SportsGame) {
  const { id, team, opponent, startsAt, timeTbd, home, status, teamScore, opponentScore, set, teamSetPoints, opponentSetPoints, scoreChangedAt } = game;
  return { id, team, opponent, startsAt, timeTbd, home, status, teamScore, opponentScore, set, teamSetPoints, opponentSetPoints, scoreChangedAt };
}
