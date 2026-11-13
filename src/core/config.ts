import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { validBirthDate } from "./age.js";
import { DEFAULT_SCREEN_POLICY } from "./policy.js";
import type { HomeAssistantOptions, RuntimeConfig, SanitizedConfig } from "./types.js";

export const DEFAULT_INSTALLATION_ID = "tidbytrmain";

const timeStringSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected HH:mm in 24-hour time");

const kinds = ["clock", "baby-age", "starfield", "nws-alert", "forecast", "upcoming-game", "live-score", "final-score"] as const;
const prioritiesSchema = z.object(Object.fromEntries(kinds.map((kind) => [kind, z.number().int().min(0).max(100).default(DEFAULT_SCREEN_POLICY.priorities[kind])])) as Record<typeof kinds[number], z.ZodDefault<z.ZodNumber>>);
const cooldownSchema = z.object(Object.fromEntries(kinds.map((kind) => [kind, z.number().int().min(kind === "clock" ? 0 : 20).max(3600).default(DEFAULT_SCREEN_POLICY.cooldownSeconds[kind])])) as Record<typeof kinds[number], z.ZodDefault<z.ZodNumber>>);
const screenPolicySchema = z.object({
  mode: z.enum(["clock-cycle", "priority"]).default(DEFAULT_SCREEN_POLICY.mode),
  clockSeconds: z.number().int().min(20).max(3600).default(DEFAULT_SCREEN_POLICY.clockSeconds),
  screenSeconds: z.number().int().min(10).max(120).default(DEFAULT_SCREEN_POLICY.screenSeconds),
  minimumDwellSeconds: z.number().int().min(20).max(120).default(20),
  priorities: prioritiesSchema.default(DEFAULT_SCREEN_POLICY.priorities),
  cooldownSeconds: cooldownSchema.default(DEFAULT_SCREEN_POLICY.cooldownSeconds),
}).refine((policy) => policy.mode !== "clock-cycle" || policy.clockSeconds > policy.screenSeconds, { message: "Clock duration must be longer than other screens", path: ["clockSeconds"] }).default(DEFAULT_SCREEN_POLICY);

export const homeAssistantOptionsSchema = z.object({
  tidbytApiToken: z.string().trim().default(""),
  tidbytDeviceId: z.string().trim().default(""),
  installationId: z.string().trim().regex(/^[A-Za-z0-9]+$/, "Tidbyt installation ID must be alphanumeric").default(DEFAULT_INSTALLATION_ID),
  babyBirthDate: z.string().trim().refine((value) => value === "" || validBirthDate(value), "Expected a real birth date in YYYY-MM-DD format (1900 or later)").default(""),
  babyName: z.string().trim().max(40).default(""),
  starfieldEnabled: z.boolean().default(true),
  screenPolicy: screenPolicySchema,
  timezone: z.string().refine((value) => {
    try { new Intl.DateTimeFormat("en-US", { timeZone: value }); return true; } catch { return false; }
  }, "Expected a valid IANA timezone").default("America/Chicago"),
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
    installationId: DEFAULT_INSTALLATION_ID,
    screenPolicy: structuredClone(DEFAULT_SCREEN_POLICY),
    timezone: process.env.TZ || "America/Chicago",
    latitude: 39.0997,
    longitude: -94.5786,
    nwsContact: "tidbytr@example.local",
    favoriteTeams: [],
    babyBirthDate: "",
    babyName: "",
    starfieldEnabled: true,
    logLevel: "info",
    schedulerIntervalSeconds: 60,
    refreshIntervalSeconds: 600,
    quietHours: null,
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
    installationId: compactCandidate.installationId === "tidbytr-main" ? DEFAULT_INSTALLATION_ID : compactCandidate.installationId ?? DEFAULT_INSTALLATION_ID,
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
    installationId: process.env.TIDBYTR_INSTALLATION_ID,
    babyBirthDate: process.env.TIDBYTR_BABY_BIRTH_DATE,
    babyName: process.env.TIDBYTR_BABY_NAME,
    starfieldEnabled: process.env.TIDBYTR_STARFIELD_ENABLED === undefined ? undefined : z.enum(["true", "false"]).parse(process.env.TIDBYTR_STARFIELD_ENABLED) === "true",
    timezone: process.env.TZ || process.env.TIDBYTR_TIMEZONE,
    latitude: process.env.TIDBYTR_LATITUDE ? Number(process.env.TIDBYTR_LATITUDE) : undefined,
    longitude: process.env.TIDBYTR_LONGITUDE ? Number(process.env.TIDBYTR_LONGITUDE) : undefined,
    nwsContact: process.env.TIDBYTR_NWS_CONTACT,
    favoriteTeams: process.env.TIDBYTR_FAVORITE_TEAMS?.split(",").map((team) => team.trim()),
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
  const { tidbytApiToken, ...safe } = config;
  return { ...safe, apiTokenConfigured: Boolean(tidbytApiToken) };
}

export function ensureDataDir(dataDir: string): void {
  fs.mkdirSync(dataDir, { recursive: true });
}

export function configFilePath(dataDir: string): string {
  return path.join(dataDir, "config.json");
}

export function writeRuntimeOptions(dataDir: string, options: HomeAssistantOptions): void {
  ensureDataDir(dataDir);
  const destination = configFilePath(dataDir);
  const temporary = `${destination}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(options, null, 2)}${os.EOL}`, { mode: 0o600 });
  fs.chmodSync(temporary, 0o600);
  fs.renameSync(temporary, destination);
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
