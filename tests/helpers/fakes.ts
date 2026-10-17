import type { FrameBundle, RuntimeConfig, SourceHealth } from "../../src/core/types.js";
import type { Panel } from "../../src/core/types.js";
import type { SportsSnapshot, WeatherSnapshot } from "../../src/core/panels.js";
import type { DisplayRenderer } from "../../src/renderer/types.js";
import type { SnapshotProvider } from "../../src/server/runtime.js";
import { SharpRenderer } from "../../src/renderer/renderer.js";
import { defaultOptions } from "../../src/core/config.js";

export function testConfig(overrides: Partial<RuntimeConfig> = {}): RuntimeConfig {
  return {
    ...defaultOptions(),
    displayBaseUrl: "http://homeassistant.local:8788",
    dataDir: "/tmp/tidbytr-test",
    host: "127.0.0.1",
    port: 0,
    displayHost: "127.0.0.1",
    displayPort: 0,
    displayPollingWindowSeconds: 30,
    ...overrides,
  };
}

export class FakeWeatherProvider implements SnapshotProvider<WeatherSnapshot> {
  constructor(private readonly snapshot: WeatherSnapshot, private readonly status: SourceHealth["status"] = "ok") {}

  async getSnapshot(now = new Date()) {
    return {
      snapshot: this.snapshot,
      health: { id: "nws" as const, label: "NWS weather", status: this.status, checkedAt: now.toISOString() },
    };
  }
}

export class FakeSportsProvider implements SnapshotProvider<SportsSnapshot> {
  constructor(private readonly snapshot: SportsSnapshot, private readonly status: SourceHealth["status"] = "ok") {}

  async getSnapshot(now = new Date()) {
    return {
      snapshot: this.snapshot,
      health: { id: "sports" as const, label: "Favorite teams", status: this.status, checkedAt: now.toISOString() },
    };
  }
}

export class FakeRenderer implements DisplayRenderer {
  rendered: Panel[] = [];

  constructor(private readonly webp?: Buffer) {}

  async render(panel: Panel, now = new Date(), _config?: RuntimeConfig): Promise<FrameBundle> {
    this.rendered.push(panel);
    return {
      panelId: panel.id,
      width: 64,
      height: 32,
      mimeType: "image/webp",
      encoding: "webp",
      webp: this.webp ?? (await new SharpRenderer().render(panel, now, _config ?? testConfig())).webp,
      renderedAt: now.toISOString(),
    };
  }
}
