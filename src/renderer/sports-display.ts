import type { SportsGame } from "../core/panels.js";
import type { PanelKind } from "../core/types.js";

export function sportsDisplay(game: SportsGame, kind: PanelKind, now: Date, timeZone: string) {
  const team = abbreviation(game.team, "HOME");
  const opponent = abbreviation(game.opponent, "AWAY");
  const sport = game.league === "football/college-football" ? "FB"
    : game.league === "basketball/mens-college-basketball" ? "BB"
    : game.league === "volleyball/womens-college-volleyball" ? "VB" : "";
  const label = kind === "live-score" ? "LIVE" : kind === "final-score" ? "FINAL" : "NEXT";
  const awayFirst = game.home === true;
  const matchup = game.home === undefined ? `${team} VS ${opponent}`
    : awayFirst ? `${opponent} @ ${team}` : `${team} @ ${opponent}`;
  const period = game.period?.toUpperCase().replace(/[^A-Z0-9: -]/g, "").slice(0, 8).trimEnd() ?? "";
  const setDetail = game.set && game.teamSetPoints !== undefined && game.opponentSetPoints !== undefined
    ? `S${game.set} ${game.teamSetPoints}-${game.opponentSetPoints}`
    : game.set ? `SET ${game.set}` : "";
  return {
    label, header: sport ? `${label} ${sport}` : label, sport,
    team, opponent, matchup,
    teamScore: game.teamScore === undefined ? "--" : String(game.teamScore),
    opponentScore: game.opponentScore === undefined ? "--" : String(game.opponentScore),
    detail: setDetail || period,
    ...gameTime(game, now, timeZone),
  };
}

function gameTime(game: SportsGame, now: Date, timeZone: string) {
  const startsAt = new Date(game.startsAt);
  if (!Number.isFinite(startsAt.getTime())) return { day: "", time: "TBD" };
  const formatDay = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone });
  const day = formatDay.format(startsAt) === formatDay.format(now) ? "TODAY" : formatDay.format(startsAt).toUpperCase();
  if (game.timeTbd) return { day, time: "TBD" };
  const minutes = Math.ceil((startsAt.getTime() - now.getTime()) / 60_000);
  if (minutes > 0 && minutes <= 60) return { day, time: `IN ${minutes} MIN` };
  const time = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone }).format(startsAt);
  return { day, time };
}

function abbreviation(value: string | undefined, fallback: string): string {
  return value?.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5) || fallback;
}
