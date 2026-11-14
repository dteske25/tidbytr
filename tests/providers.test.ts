import { COLLEGE_TEAMS } from "../src/core/college-teams.js";
import { describe, expect, it } from "vitest";
import { NwsProvider } from "../src/providers/nws.js";
import { EspnSportsProvider } from "../src/providers/sports.js";

describe("providers", () => {
  it("parses NWS forecast and active alerts", async () => {
    const fetchImpl = async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/points/")) {
        return jsonResponse({
          properties: {
            forecast: "https://api.weather.gov/gridpoints/EAX/39,55/forecast",
            forecastZone: "https://api.weather.gov/zones/forecast/MOZ037",
          },
        });
      }
      if (url.includes("/forecast")) {
        return jsonResponse({
          properties: {
            periods: [
              { temperature: 72, shortForecast: "Partly Cloudy", windSpeed: "6 mph", isDaytime: true },
              { temperature: 52, shortForecast: "Clear", isDaytime: false },
            ],
          },
        });
      }
      return jsonResponse({
        features: [
          {
            id: "alert-1",
            properties: {
              event: "Severe Thunderstorm Warning",
              severity: "Severe",
              headline: "Storm warning",
              expires: "2026-06-28T13:00:00.000Z",
            },
          },
        ],
      });
    };

    const provider = new NwsProvider({ latitude: 39.0997, longitude: -94.5786, userAgent: "test", fetchImpl });
    const result = await provider.getSnapshot(new Date("2026-06-28T12:00:00.000Z"));

    expect(result.health.status).toBe("ok");
    expect(result.snapshot.forecast).toMatchObject({ temperature: 72, isDaytime: true, high: 72, low: 52 });
    expect(result.snapshot.alerts[0]?.severity).toBe("warning");
  });

  it("marks NWS failures as degraded", async () => {
    const provider = new NwsProvider({
      latitude: 39,
      longitude: -94,
      userAgent: "test",
      fetchImpl: async () => new Response("nope", { status: 503 }),
    });
    const result = await provider.getSnapshot();

    expect(result.health.status).toBe("degraded");
    expect(result.snapshot.alerts).toEqual([]);
  });

  it("parses favorite-team games from ESPN-style scoreboards", async () => {
    const provider = new EspnSportsProvider({
      favoriteTeams: ["KC"],
      fetchImpl: async () =>
        jsonResponse({
          events: [
            {
              id: "game-1",
              date: "2026-06-28T18:00:00.000Z",
              status: { type: { state: "in", shortDetail: "Q2 4:11" } },
              competitions: [
                {
                  competitors: [
                    { score: "14", team: { abbreviation: "KC", displayName: "Kansas City" } },
                    { score: "10", team: { abbreviation: "DEN", displayName: "Denver" } },
                  ],
                },
              ],
            },
          ],
        }),
    });
    const result = await provider.getSnapshot(new Date("2026-06-28T12:00:00.000Z"));

    expect(result.health.status).toBe("ok");
    expect(result.snapshot.games[0]).toMatchObject({ team: "KC", opponent: "DEN", status: "live" });
  });

  it("loads the six college favorites by team and hydrates a volleyball set score", async () => {
    const now = new Date("2026-11-14T18:00:00Z");
    const paths: string[] = [];
    const provider = new EspnSportsProvider({
      favoriteTeams: COLLEGE_TEAMS.map(({ key }) => key),
      fetchImpl: async (url) => {
        const endpoint = String(url).split("/sports/")[1]!;
        paths.push(endpoint);
        const team = COLLEGE_TEAMS.find(({ league, teamId }) => endpoint === `${league}/teams/${teamId}/schedule`);
        if (team) {
          const live = team.key === "nebraska-volleyball";
          return jsonResponse({ events: [{
            id: team.key, date: live ? now.toISOString() : "2026-11-14T21:30:00Z", timeValid: team.teamId !== "66",
            competitions: [{ status: { type: { state: live ? "in" : "pre" } }, competitors: [
              { homeAway: "home", team: { id: team.teamId, abbreviation: team.teamId === "158" ? "NEB" : "OTHER" } },
              { team: { id: "10", abbreviation: "OPP" } },
            ] }],
          }] });
        }
        if (endpoint === "volleyball/womens-college-volleyball/summary?event=nebraska-volleyball") {
          return jsonResponse({ header: { competitions: [{ status: { period: 2, type: { state: "in", shortDetail: "2nd" } }, competitors: [
            { id: "158", team: { abbreviation: "NEB" }, score: "1", linescores: [{ displayValue: "25" }, { displayValue: "0" }] },
            { id: "10", team: { abbreviation: "IOWA" }, score: "0", linescores: [{ displayValue: "19" }, { displayValue: "7" }] },
          ] }] } });
        }
        throw new Error(`Unexpected endpoint ${endpoint}`);
      },
    });
    const { snapshot, health } = await provider.getSnapshot(now);
    expect(paths).toHaveLength(7);
    expect(health.status).toBe("ok");
    expect(snapshot.games).toHaveLength(6);
    expect(snapshot.games.find(({ id }) => id === "nebraska-volleyball")).toMatchObject({
      status: "live", teamScore: 1, opponentScore: 0, set: 2, teamSetPoints: 0, opponentSetPoints: 7,
    });
    expect(snapshot.games.find(({ id }) => id === "iowa-state-football")).toMatchObject({
      status: "scheduled", timeTbd: true, startsAt: "2026-11-14T21:30:00Z",
    });
  });

  it("marks sports provider failures as degraded", async () => {
    const provider = new EspnSportsProvider({
      favoriteTeams: ["KC"],
      fetchImpl: async () => new Response("nope", { status: 500 }),
    });
    const result = await provider.getSnapshot();

    expect(result.health.status).toBe("degraded");
    expect(result.snapshot.games).toEqual([]);
  });
});

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
