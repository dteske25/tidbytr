import type { SportsGame, SportsSnapshot } from "../core/panels.js";
import type { SourceHealth } from "../core/types.js";

export interface SportsProviderOptions {
  favoriteTeams: string[];
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  cacheTtlMs?: number;
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
  private cached: { expiresAt: number; snapshot: SportsSnapshot } | null = null;

  constructor(private readonly options: SportsProviderOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.baseUrl = options.baseUrl ?? "https://site.api.espn.com/apis/site/v2/sports";
    this.cacheTtlMs = options.cacheTtlMs ?? 60_000;
  }

  async getSnapshot(now = new Date()): Promise<{ snapshot: SportsSnapshot; health: SourceHealth }> {
    if (this.cached && this.cached.expiresAt > now.getTime()) {
      return {
        snapshot: this.cached.snapshot,
        health: { id: "sports", label: "Favorite teams", status: "ok", checkedAt: now.toISOString(), detail: "cache" },
      };
    }

    if (this.options.favoriteTeams.length === 0) {
      return {
        snapshot: { games: [] },
        health: { id: "sports", label: "Favorite teams", status: "disabled", checkedAt: now.toISOString() },
      };
    }

    try {
      const scoreboards = await Promise.all([
        this.getJson<EspnScoreboard>(`${this.baseUrl}/football/nfl/scoreboard`),
        this.getJson<EspnScoreboard>(`${this.baseUrl}/basketball/nba/scoreboard`),
        this.getJson<EspnScoreboard>(`${this.baseUrl}/baseball/mlb/scoreboard`),
        this.getJson<EspnScoreboard>(`${this.baseUrl}/hockey/nhl/scoreboard`),
      ]);
      const favoriteSet = new Set(this.options.favoriteTeams.map((team) => team.toUpperCase()));
      const games = scoreboards.flatMap((scoreboard) => parseGames(scoreboard, favoriteSet));

      const snapshot = { games };
      this.cached = { snapshot, expiresAt: now.getTime() + this.cacheTtlMs };

      return {
        snapshot,
        health: { id: "sports", label: "Favorite teams", status: "ok", checkedAt: now.toISOString() },
      };
    } catch (error) {
      return {
        snapshot: { games: [] },
        health: {
          id: "sports",
          label: "Favorite teams",
          status: "degraded",
          checkedAt: now.toISOString(),
          detail: error instanceof Error ? error.message : "Unknown sports provider error",
        },
      };
    }
  }

  private async getJson<T>(url: string): Promise<T> {
    const response = await this.fetchImpl(url, { headers: { Accept: "application/json" } });
    if (!response.ok) {
      throw new Error(`Sports request failed ${response.status} for ${url}`);
    }

    return (await response.json()) as T;
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
