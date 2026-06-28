import type { DisplayTransport, FrameBundle, PushResult, RuntimeConfig, SourceHealth } from "../../src/core/types.js";
import type { SportsSnapshot, WeatherSnapshot } from "../../src/core/panels.js";
import type { SnapshotProvider } from "../../src/server/runtime.js";
import { defaultOptions } from "../../src/core/config.js";

export function testConfig(overrides: Partial<RuntimeConfig> = {}): RuntimeConfig {
  return {
    ...defaultOptions(),
    tidbytApiToken: "token-123",
    tidbytDeviceId: "device-123",
    dataDir: "/tmp/tidbytr-test",
    host: "127.0.0.1",
    port: 0,
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

export class FakeTransport implements DisplayTransport {
  pushes: Array<{ frame: FrameBundle; options: Parameters<DisplayTransport["push"]>[1] }> = [];

  async push(frame: FrameBundle, options: Parameters<DisplayTransport["push"]>[1]): Promise<PushResult> {
    this.pushes.push({ frame, options });
    return {
      ok: true,
      status: 200,
      message: "ok",
      attemptCount: 1,
      pushedAt: new Date().toISOString(),
    };
  }
}
