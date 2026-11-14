import type { SportsGame } from "../core/panels.js";
import type { PanelKind } from "../core/types.js";

export function sportsDisplay(game: SportsGame, kind: PanelKind, now: Date, timeZone: string) {
  const volleyball = game.league === "volleyball/womens-college-volleyball" || game.set !== undefined;
  const liveVolleyball = kind === "live-score" && volleyball;
  const upcoming = kind === "upcoming-game";
  const team = {
    name: abbreviation(game.team, "TEAM"),
    artwork: game.teamArtwork,
    score: upcoming ? "" : scoreText(liveVolleyball ? game.teamSetPoints : game.teamScore),
    sets: liveVolleyball ? setCount(game.teamScore) : "",
  };
  const opponent = {
    name: abbreviation(game.opponent, "OPP"),
    artwork: game.opponentArtwork,
    score: upcoming ? "" : scoreText(liveVolleyball ? game.opponentSetPoints : game.opponentScore),
    sets: liveVolleyball ? setCount(game.opponentScore) : "",
  };

  const sport = volleyball ? "VB"
    : game.league === "football/college-football" || game.league === "football/nfl" ? "FB"
    : game.league?.startsWith("basketball/") ? "BB"
    : game.league === "baseball/mlb" ? "MLB"
    : game.league === "hockey/nhl" ? "NHL" : "";
  const liveStatus = liveVolleyball && game.set ? `SET ${game.set}`
    : game.period?.toUpperCase().replace(/[^A-Z0-9: -]/g, "").trim();
  const status = upcoming ? gameTime(game, now, timeZone)
    : kind === "final-score" ? (volleyball ? "FINAL SETS" : "FINAL")
    : liveStatus || "LIVE";
  return { rows: game.home ? [opponent, team] : [team, opponent], sport, status };
}

function gameTime(game: SportsGame, now: Date, timeZone: string): string {
  const startsAt = new Date(game.startsAt);
  if (!Number.isFinite(startsAt.getTime())) return "TBD";
  const formatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone });
  const date = formatter.format(startsAt).toUpperCase();
  const day = date === formatter.format(now).toUpperCase() ? "" : date;
  if (game.timeTbd) return [day, "TBD"].filter(Boolean).join(" ");
  const minutes = Math.ceil((startsAt.getTime() - now.getTime()) / 60_000);
  if (minutes > 0 && minutes <= 60) return `IN ${minutes} MIN`;
  const time = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone }).format(startsAt);
  return day ? `${day} ${time}` : time;
}

function scoreText(score?: number): string {
  return score !== undefined && Number.isSafeInteger(score) && score >= 0 ? String(score) : "--";
}

function setCount(sets?: number): string {
  return `${scoreText(sets)} ${sets === 1 ? "SET" : "SETS"}`;
}

function abbreviation(value: string | undefined, fallback: string): string {
  return value?.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5) || fallback;
}
