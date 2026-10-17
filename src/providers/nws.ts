import { requestJson } from "./http.js";
import type { SourceHealth } from "../core/types.js";
import type { WeatherAlert, WeatherSnapshot } from "../core/panels.js";

export interface NwsProviderOptions {
  latitude: number;
  longitude: number;
  userAgent: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  initialSnapshot?: WeatherSnapshot;
  forecastRefreshMs?: number;
  timeoutMs?: number;
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
    this.snapshot = options.initialSnapshot ?? { forecast: null, alerts: [] };
  }

  private points: { forecast?: string; zone?: string; expiresAt: number } | null = null;
  private snapshot: WeatherSnapshot;
  async getSnapshot(now = new Date()): Promise<{ snapshot: WeatherSnapshot; health: SourceHealth }> {
    const errors: string[] = [];
    if (!this.points || this.points.expiresAt <= now.getTime()) {
      try {
        const points = await this.getJson<NwsPointsResponse>(`${this.baseUrl}/points/${this.options.latitude.toFixed(4)},${this.options.longitude.toFixed(4)}`);
        const forecast = points.properties?.forecast;
        const zone = points.properties?.forecastZone?.split("/").at(-1);
        if (!forecast || !zone) throw new Error("NWS location metadata is incomplete");
        this.points = { forecast, zone, expiresAt: now.getTime() + 86400_000 };
      } catch (error) { errors.push(message(error)); }
    }
    if (this.points) {
      await Promise.all([
        (async () => {
          if (this.snapshot.forecastObservedAt && now.getTime() - Date.parse(this.snapshot.forecastObservedAt) < (this.options.forecastRefreshMs ?? 600_000)) return;
          try {
            const result = parseForecast(await this.getJson<NwsForecastResponse>(this.points!.forecast!));
            if (!result) throw new Error("NWS forecast has no valid periods");
            this.snapshot = { ...this.snapshot, forecast: result, forecastObservedAt: now.toISOString() };
          } catch (error) { errors.push(`forecast: ${message(error)}`); }
        })(),
        (async () => {
          try {
            const alerts = await this.getJson<NwsAlertsResponse>(`${this.baseUrl}/alerts/active?zone=${encodeURIComponent(this.points!.zone!)}`);
            if (!Array.isArray(alerts.features)) throw new Error("NWS alerts response has no features");
            this.snapshot = { ...this.snapshot, alerts: parseAlerts(alerts, now), alertsObservedAt: now.toISOString() };
          } catch (error) { errors.push(`alerts: ${message(error)}`); }
        })(),
      ]);
    }
    return { snapshot: this.snapshot, health: { id: "nws", label: "NWS weather", status: errors.length ? "degraded" : "ok", checkedAt: now.toISOString(), lastSuccessAt: this.snapshot.alertsObservedAt, detail: errors.join("; ") || undefined } };
  }
  private getJson<T>(url: string): Promise<T> {
    return requestJson(this.fetchImpl, url, { "User-Agent": this.options.userAgent, Accept: "application/geo+json, application/json" }, this.options.timeoutMs);
  }

}

function parseForecast(forecast: NwsForecastResponse): WeatherSnapshot["forecast"] {
  const periods = forecast.properties?.periods ?? [];
  const current = periods[0];
  const nextNight = periods.find((period) => period.isDaytime === false);
  const nextDay = periods.find((period) => period.isDaytime === true);

  if (typeof current?.temperature !== "number" || !Number.isFinite(current.temperature) || !current.shortForecast) {
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
      if (!props.event || !expiresAt || !Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= now.getTime()) {
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

function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
