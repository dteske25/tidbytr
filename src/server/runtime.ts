import path from "node:path";
import type { FastifyBaseLogger } from "fastify";
import { normalizeOptions, sanitizeConfig, writeRuntimeOptions } from "../core/config.js";
import { buildPanels, type SportsSnapshot, type WeatherSnapshot } from "../core/panels.js";
import { choosePanel, markSkipped, setSourceEnabled, snoozeUntil } from "../core/scheduler.js";
import type {
  DisplayTransport,
  HomeAssistantOptions,
  Panel,
  RuntimeConfig,
  SchedulerDecision,
  SourceHealth,
  SourceId,
  TidbytrStatus,
} from "../core/types.js";
import { createDefaultRenderer } from "../renderer/pixlet.js";
import type { DisplayRenderer } from "../renderer/types.js";
import { TidbytrStore } from "../storage/store.js";
import { NwsProvider } from "../providers/nws.js";
import { EspnSportsProvider } from "../providers/sports.js";
import { TidbytCloudTransport } from "../core/transport.js";

export interface SnapshotProvider<TSnapshot> {
  getSnapshot(now?: Date): Promise<{ snapshot: TSnapshot; health: SourceHealth }>;
}

export interface TidbytrRuntimeOptions {
  config: RuntimeConfig;
  store?: TidbytrStore;
  weatherProvider?: SnapshotProvider<WeatherSnapshot>;
  sportsProvider?: SnapshotProvider<SportsSnapshot>;
  transport?: DisplayTransport;
  renderer?: DisplayRenderer;
  logger?: FastifyBaseLogger;
}

export class TidbytrRuntime {
  private config: RuntimeConfig;
  private readonly store: TidbytrStore;
  private weatherProvider: SnapshotProvider<WeatherSnapshot>;
  private sportsProvider: SnapshotProvider<SportsSnapshot>;
  private readonly transport: DisplayTransport;
  private readonly renderer: DisplayRenderer;
  private readonly logger?: FastifyBaseLogger;
  private currentPanel: Panel | null = null;
  private schedulerTimer: NodeJS.Timeout | null = null;
  private schedulerRunning = false;
  private schedulerStopped = true;
  private nextSchedulerRunAt: number | null = null;

  constructor(options: TidbytrRuntimeOptions) {
    this.config = {
      ...options.config,
      ...options.store?.getOptions(options.config),
    };
    this.store = options.store ?? new TidbytrStore(path.join(this.config.dataDir, "tidbytr.sqlite"));
    this.weatherProvider =
      options.weatherProvider ??
      new NwsProvider({
        latitude: this.config.latitude,
        longitude: this.config.longitude,
        userAgent: this.config.nwsContact,
      });
    this.sportsProvider =
      options.sportsProvider ??
      new EspnSportsProvider({
        favoriteTeams: this.config.favoriteTeams,
      });
    this.transport = options.transport ?? new TidbytCloudTransport();
    this.renderer = options.renderer ?? createDefaultRenderer();
    this.logger = options.logger;
  }

  close(): void {
    this.stopScheduler();
    this.store.close();
  }

  startScheduler(initialDelayMs = this.config.schedulerIntervalSeconds * 1000): void {
    if (this.schedulerTimer) {
      return;
    }

    this.schedulerStopped = false;
    this.scheduleNextPush(initialDelayMs);
  }

  stopScheduler(): void {
    this.schedulerStopped = true;
    if (this.schedulerTimer) {
      clearTimeout(this.schedulerTimer);
      this.schedulerTimer = null;
    }
    this.nextSchedulerRunAt = null;
  }

  getRuntimeConfig(): RuntimeConfig {
    return this.config;
  }

  getEditableConfig(): ReturnType<typeof sanitizeConfig> {
    return sanitizeConfig(this.config);
  }

  async updateConfig(input: unknown): Promise<ReturnType<typeof sanitizeConfig>> {
    const existingToken = this.config.tidbytApiToken;
    const candidate = input as Partial<HomeAssistantOptions>;
    const nextOptions = normalizeOptions({
      ...this.config,
      ...candidate,
      tidbytApiToken:
        candidate.tidbytApiToken === "configured" || candidate.tidbytApiToken === undefined
          ? existingToken
          : candidate.tidbytApiToken,
    });

    this.config = { ...this.config, ...nextOptions };
    this.store.setOptions(nextOptions);
    writeRuntimeOptions(this.config.dataDir, nextOptions);
    this.refreshProviders();

    return sanitizeConfig(this.config);
  }

  async getPanels(now = new Date()): Promise<Panel[]> {
    const { panels, health } = await this.collectPanels(now);
    this.store.setSourceHealth(health);
    return panels;
  }

  async getPanel(panelId: string, now = new Date()): Promise<Panel | null> {
    const panels = await this.getPanels(now);
    return panels.find((panel) => panel.id === panelId) ?? null;
  }

  async getStatus(now = new Date()): Promise<TidbytrStatus> {
    const { panels, health } = await this.collectPanels(now);
    const state = this.store.getSchedulerState(this.config.quietHours);
    const decision = choosePanel({
      panels,
      now,
      state,
      timeZone: this.config.timezone,
    });
    const selected = panels.find((panel) => panel.id === decision.selectedPanelId) ?? null;
    this.currentPanel = selected;
    this.store.setSourceHealth(health);

    return {
      display: {
        width: 64,
        height: 32,
        online: Boolean(this.config.tidbytDeviceId && this.config.tidbytApiToken),
        lastPush: this.store.getLastPush(),
        currentPanel: selected,
      },
      config: sanitizeConfig(this.config),
      sourceHealth: health,
      decisions: this.store.getDecisions(),
      scheduler: {
        snoozedUntil: state.snoozedUntil,
        skippedPanelIds: state.skippedPanelIds,
        disabledSources: state.disabledSources,
        nextDecisionInSeconds: this.secondsUntilNextDecision(now),
      },
    };
  }

  async preview(panelId: string, now = new Date()): Promise<Buffer | null> {
    const panel = await this.getPanel(panelId, now);
    if (!panel) {
      return null;
    }

    return (await this.renderer.render(panel, now, this.config)).webp;
  }

  async push(panelId?: string, now = new Date()): Promise<{ decision: SchedulerDecision; panel: Panel | null }> {
    this.requirePushConfig();
    const panels = await this.getPanels(now);
    const state = this.store.getSchedulerState(this.config.quietHours);
    const decision = choosePanel({
      panels,
      now,
      state,
      manualPanelId: panelId,
      timeZone: this.config.timezone,
    });
    const selected = panels.find((panel) => panel.id === decision.selectedPanelId) ?? null;

    if (!selected) {
      this.store.addDecision({ ...decision, result: "not-shown" });
      return { decision, panel: null };
    }

    let pushedDecision: SchedulerDecision;
    try {
      const frame = await this.renderer.render(selected, now, this.config);
      const result = await this.transport.push(frame, {
        apiToken: this.config.tidbytApiToken,
        deviceId: this.config.tidbytDeviceId,
        installationId: this.config.installationId,
      });
      this.store.setLastPush(result);
      pushedDecision = {
        ...decision,
        result: result.ok ? "pushed" : "not-shown",
        reason: result.ok ? decision.reason : result.message,
      };
    } catch (error) {
      pushedDecision = {
        ...decision,
        result: "not-shown",
        reason: error instanceof Error ? error.message : "Render or push failed",
      };
      this.store.addDecision(pushedDecision);
      throw error;
    }

    this.store.addDecision(pushedDecision);
    if (pushedDecision.result === "pushed") {
      this.currentPanel = selected;
    }

    return { decision: pushedDecision, panel: selected };
  }

  async skip(panelId?: string, now = new Date()): Promise<SchedulerDecision> {
    const panels = await this.getPanels(now);
    const state = this.store.getSchedulerState(this.config.quietHours);
    const current =
      (panelId ? panels.find((panel) => panel.id === panelId) : this.currentPanel) ??
      panels.find((panel) => panel.id === choosePanel({ panels, now, state, timeZone: this.config.timezone }).selectedPanelId) ??
      null;

    if (!current) {
      const decision = choosePanel({ panels, now, state, timeZone: this.config.timezone });
      this.store.addDecision({ ...decision, result: "not-shown", reason: "No panel to skip" });
      return decision;
    }

    const nextState = markSkipped(state, current.id);
    this.store.setSchedulerState(nextState);
    const decision: SchedulerDecision = {
      id: cryptoRandomId(),
      decidedAt: now.toISOString(),
      selectedPanelId: current.id,
      selectedPanelTitle: current.title,
      reason: "Manual skip",
      result: "skipped",
      skipped: [{ panelId: current.id, reason: "Manual skip" }],
    };
    this.store.addDecision(decision);
    return decision;
  }

  snooze(minutes: number, now = new Date()): SchedulerDecision {
    const state = this.store.getSchedulerState(this.config.quietHours);
    const until = new Date(now.getTime() + minutes * 60_000);
    this.store.setSchedulerState(snoozeUntil(state, until));
    const decision: SchedulerDecision = {
      id: cryptoRandomId(),
      decidedAt: now.toISOString(),
      selectedPanelId: null,
      selectedPanelTitle: null,
      reason: `Snoozed for ${minutes} minutes`,
      result: "skipped",
      skipped: [],
    };
    this.store.addDecision(decision);
    return decision;
  }

  setSourceEnabled(sourceId: SourceId, enabled: boolean): SchedulerDecision {
    const state = this.store.getSchedulerState(this.config.quietHours);
    this.store.setSchedulerState(setSourceEnabled(state, sourceId, enabled));
    const decision: SchedulerDecision = {
      id: cryptoRandomId(),
      decidedAt: new Date().toISOString(),
      selectedPanelId: null,
      selectedPanelTitle: null,
      reason: `${sourceId} ${enabled ? "enabled" : "disabled"}`,
      result: "skipped",
      skipped: [],
    };
    this.store.addDecision(decision);
    return decision;
  }

  private async collectPanels(now: Date): Promise<{ panels: Panel[]; health: SourceHealth[] }> {
    const [weather, sports] = await Promise.all([
      this.weatherProvider.getSnapshot(now),
      this.sportsProvider.getSnapshot(now),
    ]);
    const panels = buildPanels(this.config, weather.snapshot, sports.snapshot, now);
    const health: SourceHealth[] = [
      { id: "clock", label: "Clock baseline", status: "ok", checkedAt: now.toISOString() },
      weather.health,
      sports.health,
    ];
    return { panels, health };
  }

  private refreshProviders(): void {
    this.weatherProvider = new NwsProvider({
      latitude: this.config.latitude,
      longitude: this.config.longitude,
      userAgent: this.config.nwsContact,
    });
    this.sportsProvider = new EspnSportsProvider({
      favoriteTeams: this.config.favoriteTeams,
    });
  }

  private requirePushConfig(): void {
    if (!this.config.tidbytApiToken || !this.config.tidbytDeviceId) {
      throw new Error("Tidbyt API token and device ID are required to push");
    }
  }

  private scheduleNextPush(delayMs: number): void {
    if (this.schedulerStopped) {
      return;
    }

    const safeDelayMs = Math.max(0, delayMs);
    this.nextSchedulerRunAt = Date.now() + safeDelayMs;
    this.schedulerTimer = setTimeout(() => {
      this.schedulerTimer = null;
      void this.runScheduledPush();
    }, safeDelayMs);
  }

  private async runScheduledPush(): Promise<void> {
    if (this.schedulerRunning) {
      this.scheduleNextPush(this.config.schedulerIntervalSeconds * 1000);
      return;
    }

    this.schedulerRunning = true;
    try {
      await this.push();
    } catch (error) {
      this.logger?.warn(
        { error: error instanceof Error ? error.message : String(error) },
        "Scheduled Tidbyt push failed",
      );
    } finally {
      this.schedulerRunning = false;
      if (!this.schedulerStopped && !this.schedulerTimer) {
        this.scheduleNextPush(this.config.schedulerIntervalSeconds * 1000);
      }
    }
  }

  private secondsUntilNextDecision(now: Date): number {
    if (!this.nextSchedulerRunAt) {
      return this.config.schedulerIntervalSeconds;
    }

    return Math.max(0, Math.ceil((this.nextSchedulerRunAt - now.getTime()) / 1000));
  }
}

function cryptoRandomId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
