import { COLLEGE_TEAMS } from "../core/college-teams.js";
import type { SportsGame, SportsSnapshot, SportsTeamArtwork, SportsTeamStanding } from "../core/panels.js";
import type { SourceHealth } from "../core/types.js";
import { requestJson } from "./http.js";

export interface SportsProviderOptions {
  favoriteTeams: string[];
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  cacheTtlMs?: number;
  initialSnapshot?: SportsSnapshot;
  timeoutMs?: number;
}

interface EspnStatus {
  period?: number;
  type?: { state?: string; completed?: boolean; name?: string; shortDetail?: string };
}

interface EspnRecord { type?: string; summary?: string; displayValue?: string }

interface EspnCompetitor {
  id?: string;
  homeAway?: "home" | "away";
  score?: string | { value?: number; displayValue?: string };
  records?: EspnRecord[];
  record?: EspnRecord[];
  rank?: number;
  curatedRank?: { current?: number };
  linescores?: Array<{ value?: number; displayValue?: string }>;
  team?: {
    id?: string;
    abbreviation?: string;
    displayName?: string;
    color?: string;
    logo?: string;
    logos?: Array<{ href?: string; rel?: string[] }>;
  };
}

interface EspnCompetition {
  date?: string;
  timeValid?: boolean;
  status?: EspnStatus;
  competitors?: EspnCompetitor[];
}

interface EspnEvent {
  id?: string;
  date?: string;
  timeValid?: boolean;
  status?: EspnStatus;
  competitions?: EspnCompetition[];
}

interface EspnScoreboard { events?: EspnEvent[] }
interface EspnSummary { header?: EspnEvent }

type CollegeTeam = typeof COLLEGE_TEAMS[number];
const PRO_LEAGUES = ["football/nfl", "basketball/nba", "baseball/mlb", "hockey/nhl"];
const VOLLEYBALL = "volleyball/womens-college-volleyball";

export class EspnSportsProvider {
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly cacheTtlMs: number;
  private cached: { expiresAt: number; snapshot: SportsSnapshot; health: SourceHealth } | null = null;
  private readonly feedSnapshots = new Map<string, SportsGame[]>();
  private readonly proFavorites: Set<string>;
  private readonly collegeFavorites: CollegeTeam[];

  constructor(private readonly options: SportsProviderOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.baseUrl = options.baseUrl ?? "https://site.api.espn.com/apis/site/v2/sports";
    this.cacheTtlMs = options.cacheTtlMs ?? 30_000;
    const favorites = new Set(options.favoriteTeams.map((team) => team.toUpperCase()));
    this.collegeFavorites = COLLEGE_TEAMS.filter(({ key, label }) => favorites.has(key.toUpperCase()) || favorites.has(label.toUpperCase()));
    for (const { key, label } of this.collegeFavorites) {
      favorites.delete(key.toUpperCase());
      favorites.delete(label.toUpperCase());
    }
    this.proFavorites = favorites;
    for (const game of options.initialSnapshot?.games ?? []) {
      const feed = game.feed ?? game.league ?? "legacy";
      this.feedSnapshots.set(feed, [...(this.feedSnapshots.get(feed) ?? []), game]);
    }
  }

  async getSnapshot(now = new Date()): Promise<{ snapshot: SportsSnapshot; health: SourceHealth }> {
    if (this.cached && this.cached.expiresAt > now.getTime()) {
      return { snapshot: this.cached.snapshot, health: { ...this.cached.health, detail: this.cached.health.detail ?? "cache" } };
    }
    if (this.options.favoriteTeams.length === 0) {
      return { snapshot: { games: [] }, health: { id: "sports", label: "Favorite teams", status: "disabled", checkedAt: now.toISOString() } };
    }

    const errors: string[] = [];
    const summaries = new Map<string, Promise<EspnSummary>>();
    const refresh = async (feed: string, league: string, load: () => Promise<SportsGame[]>) => {
      try {
        const previous = this.feedSnapshots.get(feed) ?? [];
        const games = (await load()).map((game) => ({
          ...game, league, feed,
          observedAt: game.observedAt ?? now.toISOString(),
          completedAt: game.status === "final" ? previous.find((old) => old.id === game.id)?.completedAt ?? now.toISOString() : undefined,
        }));
        this.feedSnapshots.set(feed, games);
        this.feedSnapshots.delete("legacy");
      } catch (error) { errors.push(`${feed}: ${error instanceof Error ? error.message : String(error)}`); }
    };

    await Promise.all([
      ...(this.proFavorites.size ? PRO_LEAGUES.map((league) => refresh(league, league, async () => {
        const events = await this.getEvents(`${league}/scoreboard`);
        return events.flatMap((event) => {
          const game = parseGame(event, (team) => [team.team?.abbreviation, team.team?.displayName].some((name) => name && this.proFavorites.has(name.toUpperCase())), league);
          return game ? [game] : [];
        });
      })) : []),
      ...this.collegeFavorites.map((team) => refresh(team.key, team.league, () => this.getCollegeGames(team, now, summaries, errors))),
    ]);

    // A game between two favorites appears in both team schedules. Keep the freshest observation.
    const games = new Map<string, SportsGame>();
    for (const observations of this.feedSnapshots.values()) {
      for (const observation of observations) {
        const key = `${observation.league ?? ""}/${observation.id}`;
        const previous = games.get(key);
        if (!previous || (observation.observedAt ?? "") > (previous.observedAt ?? "") ||
          (observation.observedAt === previous.observedAt && (observation.feed ?? "") < (previous.feed ?? ""))) games.set(key, observation);
      }
    }
    const snapshot = { games: [...games.values()] };
    const health: SourceHealth = { id: "sports", label: "Favorite teams", status: errors.length ? "degraded" : "ok", checkedAt: now.toISOString(),
      lastSuccessAt: snapshot.games.map((game) => game.observedAt ?? "").sort().at(-1) || undefined, detail: errors.join("; ") || undefined };
    this.cached = { snapshot, health, expiresAt: now.getTime() + this.cacheTtlMs };
    return { snapshot, health };
  }

  private async getCollegeGames(team: CollegeTeam, now: Date, summaries: Map<string, Promise<EspnSummary>>, errors: string[]): Promise<SportsGame[]> {
    const events = await this.getEvents(`${team.league}/teams/${team.teamId}/schedule`);
    const matches = (competitor: EspnCompetitor) => (competitor.team?.id ?? competitor.id) === team.teamId;
    const previous = this.feedSnapshots.get(team.key) ?? [];
    const relevant = events.flatMap((event) => {
      const game = parseGame(event, matches, team.league);
      if (!game) return [];
      const untilStart = Date.parse(game.startsAt) - now.getTime();
      // Season schedules return old finals on every poll. Bound discovery to recent games.
      const lookback = game.status === "scheduled" ? 3600_000 : 6 * 3600_000;
      return untilStart <= 86400_000 && (game.status === "live" || untilStart >= -lookback) ? [game] : [];
    });
    return Promise.all(relevant.map(async (game) => {
      const needsPregameDetails = game.status === "scheduled" &&
        (!game.teamStanding?.record || !game.opponentStanding?.record);
      if (game.status !== "live" && !needsPregameDetails) return game;
      const endpoint = `${team.league}/summary?event=${encodeURIComponent(game.id)}`;
      let summary = summaries.get(endpoint);
      if (!summary) {
        summary = this.getJson<EspnSummary>(endpoint);
        summaries.set(endpoint, summary);
      }
      try {
        const { header } = await summary;
        const details = header && parseGame({ ...header, id: game.id, date: game.startsAt }, matches, team.league);
        if (needsPregameDetails) {
          if (!details) return game;
          return {
            ...game,
            teamStanding: { ...game.teamStanding, ...details.teamStanding },
            opponentStanding: { ...game.opponentStanding, ...details.opponentStanding },
          };
        }
        const live = details;
        if (!live || live.status === "scheduled") throw new Error("Game summary has no current scores");
        return {
          ...live,
          home: live.home ?? game.home,
          teamArtwork: { ...game.teamArtwork, ...live.teamArtwork },
          opponentArtwork: { ...game.opponentArtwork, ...live.opponentArtwork },
        };
      } catch (error) {
        if (needsPregameDetails) return game;
        errors.push(`${team.key}: ${error instanceof Error ? error.message : String(error)}`);
        return previous.find((old) => old.id === game.id && old.status === "live") ?? game;
      }
    }));
  }

  private async getEvents(endpoint: string): Promise<EspnEvent[]> {
    const scoreboard = await this.getJson<EspnScoreboard>(endpoint);
    if (!Array.isArray(scoreboard.events)) throw new Error("Sports feed has no events");
    return scoreboard.events;
  }

  private getJson<T>(endpoint: string): Promise<T> {
    return requestJson(this.fetchImpl, `${this.baseUrl}/${endpoint}`, { Accept: "application/json" }, this.options.timeoutMs);
  }
}

function parseGame(event: EspnEvent, matches: (competitor: EspnCompetitor) => boolean, league: string): SportsGame | null {
  const competition = event.competitions?.[0];
  const competitors = competition?.competitors ?? [];
  const favorite = competitors.find(matches);
  const opponent = competitors.find((competitor) => competitor !== favorite);
  const startsAt = event.date ?? competition?.date;
  const status = event.status ?? competition?.status;
  const type = status?.type;
  if (!favorite || !opponent || !startsAt || !Number.isFinite(Date.parse(startsAt)) ||
    /CANCEL|POSTPON|SUSPEND|ABANDON|FORFEIT/.test(type?.name ?? "")) return null;
  const team = favorite.team?.abbreviation ?? favorite.team?.displayName ?? "TEAM";
  const inProgress = type?.state === "in";
  const set = inProgress && league === VOLLEYBALL ? status?.period : undefined;
  return {
    id: event.id ?? `${team}-${startsAt}`,
    team, opponent: opponent.team?.abbreviation ?? opponent.team?.displayName ?? "OPP", startsAt,
    teamArtwork: teamArtwork(favorite.team),
    opponentArtwork: teamArtwork(opponent.team),
    teamStanding: teamStanding(favorite),
    opponentStanding: teamStanding(opponent),
    timeTbd: event.timeValid === false || competition?.timeValid === false || type?.shortDetail === "TBD",
    home: favorite.homeAway === "home" ? true : favorite.homeAway === "away" ? false : undefined,
    status: type?.completed ? "final" : inProgress ? "live" : "scheduled",
    teamScore: parseScore(favorite.score), opponentScore: parseScore(opponent.score),
    period: type?.shortDetail, set,
    teamSetPoints: set ? parseScore(favorite.linescores?.[set - 1]) : undefined,
    opponentSetPoints: set ? parseScore(opponent.linescores?.[set - 1]) : undefined,
  };
}

function teamStanding(competitor: EspnCompetitor): SportsTeamStanding | undefined {
  const overall = (competitor.records ?? competitor.record)?.find(({ type }) => type === "total");
  const record = overall?.summary ?? overall?.displayValue;
  const rank = competitor.curatedRank?.current ?? competitor.rank;
  const standing: SportsTeamStanding = {};
  if (record && /^\d{1,3}-\d{1,3}(?:-\d{1,3})?$/.test(record)) standing.record = record;
  if (typeof rank === "number" && Number.isInteger(rank) && rank >= 1 && rank <= 25) standing.rank = rank;
  return standing.record || standing.rank ? standing : undefined;
}

function teamArtwork(team: EspnCompetitor["team"]): SportsTeamArtwork | undefined {
  const logo = team?.logos?.find(({ href, rel }) => href && rel?.includes("dark"))?.href
    ?? team?.logo ?? team?.logos?.find(({ href }) => href)?.href;
  const color = team?.color;
  if (!logo && !color) return undefined;
  return { ...(logo ? { logo } : {}), ...(color ? { color } : {}) };
}

function parseScore(score?: string | { value?: number; displayValue?: string }): number | undefined {
  const value = typeof score === "object" ? score.value ?? score.displayValue : score;
  if (value === undefined || value === "") return undefined;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : undefined;
}
