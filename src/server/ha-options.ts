import fs from "node:fs";
import os from "node:os";
import { normalizeOptions } from "../core/config.js";

const [inputPath = "/data/options.json", outputPath = "/data/config.json"] = process.argv.slice(2);

const raw = fs.existsSync(inputPath) ? (JSON.parse(fs.readFileSync(inputPath, "utf8")) as Record<string, unknown>) : {};
const options = normalizeOptions({
  tidbytApiToken: raw.tidbyt_api_token,
  tidbytDeviceId: raw.tidbyt_device_id,
  timezone: raw.timezone,
  latitude: raw.latitude,
  longitude: raw.longitude,
  nwsContact: raw.nws_contact,
  favoriteTeams: raw.favorite_teams,
  logLevel: raw.log_level,
  schedulerIntervalSeconds: raw.scheduler_interval_seconds,
  refreshIntervalSeconds: raw.refresh_interval_seconds,
  quietHours:
    typeof raw.quiet_hours_start === "string" && typeof raw.quiet_hours_end === "string" && raw.quiet_hours_start && raw.quiet_hours_end
      ? { start: raw.quiet_hours_start, end: raw.quiet_hours_end }
      : null,
  installationId: raw.installation_id,
});

fs.writeFileSync(outputPath, `${JSON.stringify(options, null, 2)}${os.EOL}`);
