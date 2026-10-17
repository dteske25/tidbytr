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
      ports: Record<string, unknown>;
      options: Record<string, unknown>;
      schema: Record<string, unknown>;
    };

    expect(config.ingress).toBe(true);
    expect(config.ingress_port).toBe(8787);
    expect(config.ports["8788/tcp"]).toBe(8788);
    expect(config).toHaveProperty("version", packageJson.version);
    for (const key of ["display_base_url", "timezone", "latitude", "longitude", "nws_contact"]) {
      expect(config.options).toHaveProperty(key);
      expect(config.schema).toHaveProperty(key);
    }
    expect(config.options).not.toHaveProperty("tidbyt_api_token");
    expect(config.options).not.toHaveProperty("tidbyt_device_id");
    expect(config.options).not.toHaveProperty("installation_id");
  });

  it("uses /data persistence and the built server entrypoint", () => {
    const run = fs.readFileSync("tidbytr/run.sh", "utf8");
    const dockerfile = fs.readFileSync("tidbytr/Dockerfile", "utf8");

    expect(run).toContain("/data/options.json");
    expect(run).toContain("TIDBYTR_DATA_DIR");
    expect(dockerfile).toContain("COPY source.tar.gz /tmp/tidbytr.tar.gz");
    expect(dockerfile).not.toContain("codeload.github.com");
    expect(dockerfile).toContain("TIDBYTR_DATA_DIR=/data");
    expect(dockerfile).toContain("TIDBYTR_DISPLAY_PORT=8788");
    expect(dockerfile).toContain("EXPOSE 8787 8788");
    expect(dockerfile).toContain("COPY run.sh /run.sh");
    expect(dockerfile).toContain("CMD [\"/run.sh\"]");
  });

  it("bundles pinned Pixlet for supported Linux add-on architectures", () => {
    const dockerfile = fs.readFileSync("tidbytr/Dockerfile", "utf8");

    expect(dockerfile).toContain("ARG PIXLET_VERSION=0.34.0");
    expect(dockerfile).toContain("pixlet_${PIXLET_VERSION}_linux_${PIXLET_ARCH}.tar.gz");
    expect(dockerfile).toContain("checksums.txt");
    expect(dockerfile).toContain("sha256sum -c -");
    expect(dockerfile).toContain("amd64) PIXLET_ARCH=\"amd64\"");
    expect(dockerfile).toContain("arm64|aarch64) PIXLET_ARCH=\"arm64\"");
    expect(dockerfile).toContain("/usr/local/bin/pixlet");
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
      displayBaseUrl: undefined,
      latitude: undefined,
      longitude: undefined,
      nwsContact: undefined,
    });

    expect(options.displayBaseUrl).toBe("");
    expect(options.latitude).toBe(39.0997);
    expect(options.longitude).toBe(-94.5786);
    expect(options.nwsContact).toBe("tidbytr@example.local");
  });

  it("normalizes the HDK display base URL", () => {
    const options = normalizeOptions({ displayBaseUrl: " http://homeassistant.local:8788/// " });

    expect(options.displayBaseUrl).toBe("http://homeassistant.local:8788");
  });
});
