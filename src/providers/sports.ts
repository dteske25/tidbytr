import { requestJson } from "./http.js";
import type { SportsGame, SportsSnapshot } from "../core/panels.js";
import type { SourceHealth } from "../core/types.js";

export interface SportsProviderOptions {
  favoriteTeams: string[];
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  cacheTtlMs?: number;
  initialSnapshot?: SportsSnapshot;
  timeoutMs?: number;
}

interface EspnScoreboard {
  events?: Array<{
    id?: string;
    date?: string;
    status?: {
      type?: {
        state?: string;
        completed?: boolean;
        shortDetail?: string;
      };
    };
    competitions?: Array<{
      competitors?: Array<{
        homeAway?: "home" | "away";
        score?: string;
        team?: {
          abbreviation?: string;
          displayName?: string;
        };
      }>;
    }>;
  }>;
}

export class EspnSportsProvider {
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly cacheTtlMs: number;
  private cached: { expiresAt: number; snapshot: SportsSnapshot; health: SourceHealth } | null = null;
  private readonly leagueSnapshots = new Map<string, SportsGame[]>();

  constructor(private readonly options: SportsProviderOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.baseUrl = options.baseUrl ?? "https://site.api.espn.com/apis/site/v2/sports";
    this.cacheTtlMs = options.cacheTtlMs ?? 30_000;
    for (const game of options.initialSnapshot?.games ?? []) {
      const league = game.league ?? "legacy";
      this.leagueSnapshots.set(league, [...(this.leagueSnapshots.get(league) ?? []), game]);
    }
  }

  async getSnapshot(now = new Date()): Promise<{ snapshot: SportsSnapshot; health: SourceHealth }> {
    if (this.cached && this.cached.expiresAt > now.getTime()) {
      return {
        snapshot: this.cached.snapshot,
        health: { ...this.cached.health, detail: this.cached.health.detail ?? "cache" },
      };
    }

    if (this.options.favoriteTeams.length === 0) {
      return {
        snapshot: { games: [] },
        health: { id: "sports", label: "Favorite teams", status: "disabled", checkedAt: now.toISOString() },
      };
    }

    const favoriteSet = new Set(this.options.favoriteTeams.map((team) => team.toUpperCase()));
    const errors: string[] = [];
    await Promise.all(["football/nfl", "basketball/nba", "baseball/mlb", "hockey/nhl"].map(async (league) => {
      try {
        const scoreboard = await this.getJson<EspnScoreboard>(`${this.baseUrl}/${league}/scoreboard`);
        if (!Array.isArray(scoreboard.events)) throw new Error("Scoreboard has no events");
        const previous = this.leagueSnapshots.get(league) ?? [];
        const games = parseGames(scoreboard, favoriteSet).map((game) => ({
          ...game, league, observedAt: now.toISOString(),
          completedAt: game.status === "final" ? previous.find((old) => old.id === game.id)?.completedAt ?? now.toISOString() : undefined,
        }));
        this.leagueSnapshots.set(league, games);
        this.leagueSnapshots.delete("legacy");
      } catch (error) { errors.push(`${league}: ${error instanceof Error ? error.message : String(error)}`); }
    }));
    const snapshot = { games: [...this.leagueSnapshots.values()].flat() };
    const health: SourceHealth = { id: "sports", label: "Favorite teams", status: errors.length ? "degraded" : "ok", checkedAt: now.toISOString(),
      lastSuccessAt: snapshot.games.map((game) => game.observedAt ?? "").sort().at(-1) || undefined,
      detail: errors.join("; ") || undefined };
    this.cached = { snapshot, health, expiresAt: now.getTime() + this.cacheTtlMs };
    return { snapshot, health };
  }
  private getJson<T>(url: string): Promise<T> {
    return requestJson(this.fetchImpl, url, { Accept: "application/json" }, this.options.timeoutMs);
  }

}

function parseGames(scoreboard: EspnScoreboard, favoriteSet: Set<string>): SportsGame[] {
  return (scoreboard.events ?? [])
    .map((event): SportsGame | null => {
      const competitors = event.competitions?.[0]?.competitors ?? [];
      const favorite = competitors.find((competitor) => {
        const abbreviation = competitor.team?.abbreviation?.toUpperCase();
        const displayName = competitor.team?.displayName?.toUpperCase();
        return Boolean(
          abbreviation && favoriteSet.has(abbreviation) || displayName && favoriteSet.has(displayName),
        );
      });

      if (!favorite) {
        return null;
      }

      const opponent = competitors.find((competitor) => competitor !== favorite);
      const state = event.status?.type?.state ?? "pre";
      const completed = event.status?.type?.completed ?? false;

      const game: SportsGame = {
        id: event.id ?? `${favorite.team?.abbreviation}-${event.date}`,
        team: favorite.team?.abbreviation ?? favorite.team?.displayName ?? "TEAM",
        opponent: opponent?.team?.abbreviation ?? opponent?.team?.displayName ?? "OPP",
        startsAt: event.date ?? new Date().toISOString(),
        status: completed ? "final" : state === "in" ? "live" : "scheduled",
      };
      if (favorite.score) {
        game.teamScore = Number(favorite.score);
      }
      if (opponent?.score) {
        game.opponentScore = Number(opponent.score);
      }
      if (event.status?.type?.shortDetail) {
        game.period = event.status.type.shortDetail;
      }
      return game;
    })
    .filter((game): game is SportsGame => Boolean(game));
}
