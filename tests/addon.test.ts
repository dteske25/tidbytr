import fs from "node:fs";
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import { normalizeOptions } from "../src/core/config.js";
import packageJson from "../package.json" with { type: "json" };

describe("Home Assistant add-on package", () => {
  it("has repository metadata", () => {
    const repository = YAML.parse(fs.readFileSync("repository.yaml", "utf8")) as Record<string, unknown>;
    expect(repository.name).toBe("Tidbytr Add-ons");
  });

  it("enables Ingress and declares required options", () => {
    const config = YAML.parse(fs.readFileSync("tidbytr/config.yaml", "utf8")) as {
      ingress: boolean;
      ingress_port: number;
      options: Record<string, unknown>;
      schema: Record<string, unknown>;
    };

    expect(config.ingress).toBe(true);
    expect(config.ingress_port).toBe(8787);
    expect(config).toHaveProperty("version", packageJson.version);
    for (const key of ["tidbyt_api_token", "tidbyt_device_id", "timezone", "latitude", "longitude", "nws_contact"]) {
      expect(config.options).toHaveProperty(key);
      expect(config.schema).toHaveProperty(key);
    }
  });

  it("uses /data persistence and the built server entrypoint", () => {
    const run = fs.readFileSync("tidbytr/run.sh", "utf8");
    const dockerfile = fs.readFileSync("tidbytr/Dockerfile", "utf8");

    expect(run).toContain("/data/options.json");
    expect(run).toContain("TIDBYTR_DATA_DIR");
    expect(dockerfile).toContain(`codeload.github.com/dteske25/tidbytr/tar.gz/refs/tags/v${packageJson.version}`);
    expect(dockerfile).toContain("TIDBYTR_DATA_DIR=/data");
    expect(dockerfile).toContain("COPY run.sh /run.sh");
    expect(dockerfile).toContain("CMD [\"/run.sh\"]");
  });

  it("includes add-on docs and PNG assets", () => {
    for (const file of ["README.md", "DOCS.md", "CHANGELOG.md", "icon.png", "logo.png"]) {
      expect(fs.existsSync(`tidbytr/${file}`)).toBe(true);
    }
    expect(fs.statSync("tidbytr/icon.png").size).toBeGreaterThan(100);
    expect(fs.statSync("tidbytr/logo.png").size).toBeGreaterThan(100);
  });

  it("keeps runtime defaults when add-on options are absent", () => {
    const options = normalizeOptions({
      tidbytApiToken: undefined,
      tidbytDeviceId: undefined,
      latitude: undefined,
      longitude: undefined,
      nwsContact: undefined,
    });

    expect(options.latitude).toBe(39.0997);
    expect(options.longitude).toBe(-94.5786);
    expect(options.nwsContact).toBe("tidbytr@example.local");
  });
});
