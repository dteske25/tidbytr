import fs from "node:fs";
import os from "node:os";
import { DEFAULT_SCREEN_POLICY } from "../core/policy.js";
import { normalizeOptions } from "../core/config.js";

const [inputPath = "/data/options.json", outputPath = "/data/config.json"] = process.argv.slice(2);

const raw = fs.existsSync(inputPath) ? (JSON.parse(fs.readFileSync(inputPath, "utf8")) as Record<string, unknown>) : {};
const options = normalizeOptions({
  tidbytApiToken: raw.tidbyt_api_token,
  tidbytDeviceId: raw.tidbyt_device_id,
  installationId: raw.installation_id,
  timezone: raw.timezone,
  latitude: raw.latitude,
  longitude: raw.longitude,
  nwsContact: raw.nws_contact,
  favoriteTeams: raw.favorite_teams,
  // An empty list added by HA on upgrade must not hide a legacy child.
  children: Array.isArray(raw.children) && (raw.children.length > 0 || !raw.baby_birth_date)
    ? raw.children.map((entry) => { const child = entry as Record<string, unknown>; return { id: child.id, name: child.name, birthDate: child.birth_date, style: child.style }; }) : undefined,
  babyBirthDate: raw.baby_birth_date,
  babyName: raw.baby_name,
  starfieldEnabled: raw.starfield_enabled,
  screenPolicy: { ...DEFAULT_SCREEN_POLICY, mode: raw.schedule_mode, clockSeconds: raw.clock_seconds, screenSeconds: raw.screen_seconds },
  logLevel: raw.log_level,
  schedulerIntervalSeconds: raw.scheduler_interval_seconds,
  refreshIntervalSeconds: raw.refresh_interval_seconds,
  quietHours:
    typeof raw.quiet_hours_start === "string" && typeof raw.quiet_hours_end === "string" && raw.quiet_hours_start && raw.quiet_hours_end
      ? { start: raw.quiet_hours_start, end: raw.quiet_hours_end }
      : null,
});

fs.writeFileSync(outputPath, `${JSON.stringify(options, null, 2)}${os.EOL}`, { mode: 0o600 });
fs.chmodSync(outputPath, 0o600);
