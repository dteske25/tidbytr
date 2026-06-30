import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import type { HomeAssistantOptions, RuntimeConfig, SanitizedConfig } from "./types.js";

export const DEFAULT_INSTALLATION_ID = "tidbytrmain";
const LEGACY_DEFAULT_INSTALLATION_ID = "tidbytr-main";

const timeStringSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected HH:mm in 24-hour time");

const installationIdSchema = z
  .string()
  .min(1)
  .regex(/^[A-Za-z0-9]+$/, "Tidbyt installation ID must be alphanumeric (a-z, A-Z, 0-9)");

export const homeAssistantOptionsSchema = z.object({
  tidbytApiToken: z.string().default(""),
  tidbytDeviceId: z.string().default(""),
  timezone: z.string().min(1).default("America/Chicago"),
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  nwsContact: z.string().min(3, "NWS contact/User-Agent is required"),
  favoriteTeams: z.array(z.string().min(1)).default([]),
  logLevel: z.enum(["trace", "debug", "info", "warn", "error"]).default("info"),
  schedulerIntervalSeconds: z.coerce.number().int().min(15).max(3600).default(60),
  refreshIntervalSeconds: z.coerce.number().int().min(60).max(21600).default(600),
  quietHours: z
    .object({
      start: timeStringSchema,
      end: timeStringSchema,
    })
    .nullable()
    .default(null),
  installationId: installationIdSchema.default(DEFAULT_INSTALLATION_ID),
});

export const runtimeConfigSchema = homeAssistantOptionsSchema.extend({
  dataDir: z.string().min(1),
  host: z.string().min(1).default("0.0.0.0"),
  port: z.coerce.number().int().min(1).max(65535).default(8787),
});

export function defaultOptions(): HomeAssistantOptions {
  return {
    tidbytApiToken: "",
    tidbytDeviceId: "",
    timezone: process.env.TZ || "America/Chicago",
    latitude: 39.0997,
    longitude: -94.5786,
    nwsContact: "tidbytr@example.local",
    favoriteTeams: [],
    logLevel: "info",
    schedulerIntervalSeconds: 60,
    refreshIntervalSeconds: 600,
    quietHours: null,
    installationId: DEFAULT_INSTALLATION_ID,
  };
}

export function normalizeOptions(input: unknown): HomeAssistantOptions {
  const defaults = defaultOptions();
  const candidate = typeof input === "object" && input !== null ? input : {};
  const compactCandidate = Object.fromEntries(
    Object.entries(candidate).filter(([, value]) => value !== undefined),
  );
  const normalized = {
    ...defaults,
    ...compactCandidate,
    favoriteTeams: normalizeFavoriteTeams((compactCandidate as Partial<HomeAssistantOptions>).favoriteTeams),
    installationId: normalizeInstallationId((compactCandidate as Partial<HomeAssistantOptions>).installationId),
  };

  return homeAssistantOptionsSchema.parse(normalized);
}

export function loadRuntimeConfig(): RuntimeConfig {
  const dataDir = process.env.TIDBYTR_DATA_DIR || path.join(process.cwd(), ".tidbytr");
  const configPath = process.env.TIDBYTR_CONFIG_PATH || path.join(dataDir, "config.json");
  const fileOptions = readJsonFile(configPath);

  const envOptions: Partial<HomeAssistantOptions> = {
    tidbytApiToken: process.env.TIDBYTR_API_TOKEN,
    tidbytDeviceId: process.env.TIDBYTR_DEVICE_ID,
    timezone: process.env.TZ || process.env.TIDBYTR_TIMEZONE,
    latitude: process.env.TIDBYTR_LATITUDE ? Number(process.env.TIDBYTR_LATITUDE) : undefined,
    longitude: process.env.TIDBYTR_LONGITUDE ? Number(process.env.TIDBYTR_LONGITUDE) : undefined,
    nwsContact: process.env.TIDBYTR_NWS_CONTACT,
    favoriteTeams: process.env.TIDBYTR_FAVORITE_TEAMS?.split(",").map((team) => team.trim()),
    installationId: process.env.TIDBYTR_INSTALLATION_ID,
  };

  const compactEnvOptions = Object.fromEntries(
    Object.entries(envOptions).filter(([, value]) => value !== undefined && value !== ""),
  );

  return runtimeConfigSchema.parse({
    ...normalizeOptions({ ...fileOptions, ...compactEnvOptions }),
    dataDir,
    host: process.env.TIDBYTR_HOST || "0.0.0.0",
    port: process.env.TIDBYTR_PORT || 8787,
  });
}

export function sanitizeConfig(config: RuntimeConfig): SanitizedConfig {
  return {
    ...config,
    tidbytApiToken: config.tidbytApiToken ? "configured" : "missing",
  };
}

export function ensureDataDir(dataDir: string): void {
  fs.mkdirSync(dataDir, { recursive: true });
}

export function configFilePath(dataDir: string): string {
  return path.join(dataDir, "config.json");
}

export function writeRuntimeOptions(dataDir: string, options: HomeAssistantOptions): void {
  ensureDataDir(dataDir);
  fs.writeFileSync(configFilePath(dataDir), `${JSON.stringify(options, null, 2)}${os.EOL}`);
}

function readJsonFile(filePath: string): Record<string, unknown> {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  return JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, unknown>;
}

function normalizeFavoriteTeams(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((team) => String(team).trim()).filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((team) => team.trim())
      .filter(Boolean);
  }

  return [];
}

function normalizeInstallationId(value: unknown): string {
  if (value === undefined || value === LEGACY_DEFAULT_INSTALLATION_ID) {
    return DEFAULT_INSTALLATION_ID;
  }

  return String(value);
}
