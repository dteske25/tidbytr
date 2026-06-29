import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { apiUrl, appBasePath } from "../src/web/src/ingress.js";

describe("Home Assistant Ingress frontend paths", () => {
  it("computes a stable base path for HA Ingress URLs", () => {
    expect(appBasePath("/api/hassio_ingress/abc123/")).toBe("/api/hassio_ingress/abc123/");
    expect(appBasePath("/api/hassio_ingress/abc123")).toBe("/api/hassio_ingress/abc123/");
    expect(appBasePath("/api/hassio_ingress/abc123/settings")).toBe("/api/hassio_ingress/abc123/");
    expect(appBasePath("/")).toBe("/");
  });

  it("builds API URLs relative to the Ingress mount", () => {
    expect(apiUrl("status", "/api/hassio_ingress/abc123/")).toBe("/api/hassio_ingress/abc123/api/status");
    expect(apiUrl("/api/panels/clock/preview.webp?v=1", "/api/hassio_ingress/abc123/")).toBe(
      "/api/hassio_ingress/abc123/api/panels/clock/preview.webp?v=1",
    );
  });

  it("keeps Vite asset URLs relative for Ingress", () => {
    const viteConfig = fs.readFileSync("vite.config.ts", "utf8");
    expect(viteConfig).toContain('base: "./"');
  });
});
