import type { SourceHealth } from "../core/types.js";
import type { WeatherAlert, WeatherSnapshot } from "../core/panels.js";

export interface NwsProviderOptions {
  latitude: number;
  longitude: number;
  userAgent: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}

interface NwsPointsResponse {
  properties?: {
    forecast?: string;
    forecastHourly?: string;
    forecastZone?: string;
  };
}

interface NwsForecastResponse {
  properties?: {
    periods?: Array<{
      temperature?: number;
      shortForecast?: string;
      windSpeed?: string;
      isDaytime?: boolean;
    }>;
  };
}

interface NwsAlertsResponse {
  features?: Array<{
    id?: string;
    properties?: {
      event?: string;
      headline?: string;
      severity?: string;
      expires?: string;
      ends?: string;
    };
  }>;
}

export class NwsProvider {
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;

  constructor(private readonly options: NwsProviderOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.baseUrl = options.baseUrl ?? "https://api.weather.gov";
  }

  async getSnapshot(now = new Date()): Promise<{ snapshot: WeatherSnapshot; health: SourceHealth }> {
    try {
      const points = await this.getJson<NwsPointsResponse>(
        `${this.baseUrl}/points/${this.options.latitude.toFixed(4)},${this.options.longitude.toFixed(4)}`,
      );
      const forecastUrl = points.properties?.forecast;
      const zone = points.properties?.forecastZone?.split("/").at(-1);

      const [forecast, alerts] = await Promise.all([
        forecastUrl ? this.getJson<NwsForecastResponse>(forecastUrl) : Promise.resolve({}),
        zone
          ? this.getJson<NwsAlertsResponse>(`${this.baseUrl}/alerts/active?zone=${encodeURIComponent(zone)}`)
          : Promise.resolve({ features: [] }),
      ]);

      return {
        snapshot: {
          forecast: parseForecast(forecast),
          alerts: parseAlerts(alerts, now),
        },
        health: {
          id: "nws",
          label: "NWS weather",
          status: "ok",
          checkedAt: now.toISOString(),
        },
      };
    } catch (error) {
      return {
        snapshot: { forecast: null, alerts: [] },
        health: {
          id: "nws",
          label: "NWS weather",
          status: "degraded",
          checkedAt: now.toISOString(),
          detail: error instanceof Error ? error.message : "Unknown NWS provider error",
        },
      };
    }
  }

  private async getJson<T>(url: string): Promise<T> {
    const response = await this.fetchImpl(url, {
      headers: {
        "User-Agent": this.options.userAgent,
        Accept: "application/geo+json, application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`NWS request failed ${response.status} for ${url}`);
    }

    return (await response.json()) as T;
  }
}

function parseForecast(forecast: NwsForecastResponse): WeatherSnapshot["forecast"] {
  const periods = forecast.properties?.periods ?? [];
  const current = periods[0];
  const nextNight = periods.find((period) => period.isDaytime === false);
  const nextDay = periods.find((period) => period.isDaytime === true);

  if (!current?.temperature || !current.shortForecast) {
    return null;
  }

  return {
    temperature: current.temperature,
    shortForecast: current.shortForecast,
    windSpeed: current.windSpeed,
    high: nextDay?.temperature,
    low: nextNight?.temperature,
  };
}

function parseAlerts(alerts: NwsAlertsResponse, now: Date): WeatherAlert[] {
  return (alerts.features ?? [])
    .map((feature) => {
      const props = feature.properties ?? {};
      const expiresAt = props.expires ?? props.ends;
      if (!props.event || !expiresAt || Date.parse(expiresAt) <= now.getTime()) {
        return null;
      }

      return {
        id: feature.id ?? props.event.toLowerCase().replaceAll(/\W+/g, "-"),
        event: props.event,
        severity: parseSeverity(props.severity, props.event),
        headline: props.headline ?? props.event,
        expiresAt,
      } satisfies WeatherAlert;
    })
    .filter((alert): alert is WeatherAlert => Boolean(alert));
}

function parseSeverity(input: string | undefined, event: string): WeatherAlert["severity"] {
  const normalized = `${input ?? ""} ${event}`.toLowerCase();
  if (normalized.includes("warning")) {
    return "warning";
  }

  if (normalized.includes("watch")) {
    return "watch";
  }

  return "advisory";
}
