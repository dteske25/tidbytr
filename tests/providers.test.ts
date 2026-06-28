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
    expect(result.snapshot.forecast?.temperature).toBe(72);
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
