import path from "node:path";
import type { FastifyBaseLogger } from "fastify";
import { normalizeOptions, sanitizeConfig, writeRuntimeOptions } from "../core/config.js";
import { buildPanels, type SportsSnapshot, type WeatherSnapshot } from "../core/panels.js";
import { LocalDisplayPublisher } from "../core/publisher.js";
import { choosePanel, markSkipped, setSourceEnabled, snoozeUntil } from "../core/scheduler.js";
import type {
  HomeAssistantOptions,
  Panel,
  PublishResult,
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

export interface SnapshotProvider<TSnapshot> {
  getSnapshot(now?: Date): Promise<{ snapshot: TSnapshot; health: SourceHealth }>;
}

export interface TidbytrRuntimeOptions {
  config: RuntimeConfig;
  store?: TidbytrStore;
  weatherProvider?: SnapshotProvider<WeatherSnapshot>;
  sportsProvider?: SnapshotProvider<SportsSnapshot>;
  publisher?: LocalDisplayPublisher;
  renderer?: DisplayRenderer;
  logger?: FastifyBaseLogger;
}

export class TidbytrRuntime {
  private config: RuntimeConfig;
  private readonly store: TidbytrStore;
  private weatherProvider: SnapshotProvider<WeatherSnapshot>;
  private sportsProvider: SnapshotProvider<SportsSnapshot>;
  private readonly publisher: LocalDisplayPublisher;
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
    this.publisher = options.publisher ?? new LocalDisplayPublisher({ dataDir: this.config.dataDir });
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
    const candidate = input as Partial<HomeAssistantOptions>;
    const nextOptions = normalizeOptions({ ...this.config, ...candidate });

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
    const lastPublish = this.store.getLastPublish();
    const lastPull = this.store.getLastPull();

    return {
      display: {
        delivery: "hdk-local-pull",
        width: 64,
        height: 32,
        remoteUrl: this.getRemoteUrl(),
        currentFrame: this.getCurrentFrame(lastPublish),
        online: this.isDisplayOnline(lastPull, now),
        lastPublish,
        lastPull,
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

  async publish(panelId?: string, now = new Date()): Promise<{ decision: SchedulerDecision; panel: Panel | null }> {
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

    let publishedDecision: SchedulerDecision;
    try {
      const frame = await this.renderer.render(selected, now, this.config);
      const result = await this.publisher.publish(frame);
      this.store.setLastPublish(result);
      publishedDecision = {
        ...decision,
        result: result.ok ? "published" : "not-shown",
        reason: result.ok ? decision.reason : result.message,
      };
    } catch (error) {
      publishedDecision = {
        ...decision,
        result: "not-shown",
        reason: error instanceof Error ? error.message : "Render or publish failed",
      };
      this.store.addDecision(publishedDecision);
      throw error;
    }

    this.store.addDecision(publishedDecision);
    if (publishedDecision.result === "published") {
      this.currentPanel = selected;
    }

    return { decision: publishedDecision, panel: selected };
  }

  async push(panelId?: string, now = new Date()): Promise<{ decision: SchedulerDecision; panel: Panel | null }> {
    return this.publish(panelId, now);
  }

  async getCurrentFrameForPull(now = new Date()): Promise<Buffer> {
    let frame = await this.publisher.readCurrentFrame();
    if (!frame) {
      await this.publish(undefined, now);
      frame = await this.publisher.readCurrentFrame();
    }

    if (!frame) {
      throw new Error("No display frame is available");
    }

    this.recordPull(now);
    return frame;
  }

  recordPull(now = new Date()): void {
    this.store.setLastPull(now.toISOString());
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
      await this.publish();
    } catch (error) {
      this.logger?.warn(
        { error: error instanceof Error ? error.message : String(error) },
        "Scheduled Tidbytr publish failed",
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

  private getRemoteUrl(): string | null {
    return this.config.displayBaseUrl ? `${this.config.displayBaseUrl}/current.webp` : null;
  }

  private getCurrentFrame(lastPublish: PublishResult | null): { panelId: string; renderedAt: string } | null {
    if (!lastPublish?.ok) {
      return null;
    }

    return {
      panelId: lastPublish.panelId,
      renderedAt: lastPublish.renderedAt ?? lastPublish.publishedAt,
    };
  }

  private isDisplayOnline(lastPull: string | null, now: Date): boolean {
    if (!lastPull) {
      return false;
    }

    return now.getTime() - new Date(lastPull).getTime() <= this.config.displayPollingWindowSeconds * 1000;
  }
}

function cryptoRandomId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
