import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import type { FastifyBaseLogger } from "fastify";
import { normalizeOptions, sanitizeConfig } from "../core/config.js";
import { buildPanels, clockPanel, type SportsSnapshot, type WeatherSnapshot } from "../core/panels.js";
import { LocalDisplayPublisher, validateDisplayFrame } from "../core/publisher.js";
import { TidbytCloudTransport, type DisplayTransport } from "../core/transport.js";
import { CLOCK_CYCLE_KINDS, cycleRemainingMilliseconds, choosePanel, isExpired, markSkipped, recordShown, setSourceEnabled, snoozeUntil } from "../core/scheduler.js";
import type { Panel, PublishedFrame, RuntimeConfig, SchedulerDecision, SourceHealth, SourceId, TidbytrStatus, SanitizedConfig } from "../core/types.js";
import { createDefaultRenderer } from "../renderer/pixlet.js";
import { SharpRenderer } from "../renderer/renderer.js";
import type { DisplayRenderer } from "../renderer/types.js";
import { TidbytrStore } from "../storage/store.js";
import { NwsProvider } from "../providers/nws.js";
import { EspnSportsProvider } from "../providers/sports.js";
import { withDeadline } from "../providers/http.js";

export interface SnapshotProvider<TSnapshot> {
  getSnapshot(now?: Date): Promise<{ snapshot: TSnapshot; health: SourceHealth }>;
}
export interface TidbytrRuntimeOptions {
  config: RuntimeConfig;
  store?: TidbytrStore;
  weatherProvider?: SnapshotProvider<WeatherSnapshot>;
  sportsProvider?: SnapshotProvider<SportsSnapshot>;
  publisher?: LocalDisplayPublisher;
  transport?: DisplayTransport;
  renderer?: DisplayRenderer;
  logger?: FastifyBaseLogger;
  sourceTimeoutMs?: number;
}

export class TidbytrRuntime {
  private config: RuntimeConfig;
  private readonly store: TidbytrStore;
  private weatherProvider: SnapshotProvider<WeatherSnapshot>;
  private sportsProvider: SnapshotProvider<SportsSnapshot>;
  private readonly publisher: LocalDisplayPublisher;
  private readonly transport: DisplayTransport;
  private readonly renderer: DisplayRenderer;
  private readonly fallback = new SharpRenderer();
  private readonly logger?: FastifyBaseLogger;
  private readonly sourceTimeoutMs: number;
  private weather: WeatherSnapshot;
  private sports: SportsSnapshot;
  private health = new Map<SourceId, SourceHealth>();
  private schedulerTimer: NodeJS.Timeout | null = null;
  private sourceTimers = new Map<SourceId, NodeJS.Timeout>();
  private refreshes = new Map<SourceId, Promise<void>>();
  private stopped = true;
  private closed = false;
  private generation = 0;
  private configGeneration = 0;
  private nextSchedulerRunAt: number | null = null;
  private commitTail: Promise<unknown> = Promise.resolve();
  private publications = new Set<Promise<unknown>>();

  constructor(options: TidbytrRuntimeOptions) {
    this.store = options.store ?? new TidbytrStore(path.join(options.config.dataDir, "tidbytr.sqlite"));
    this.config = { ...options.config, ...normalizeOptions(this.store.getOptions(options.config)) };
    this.weather = this.store.getSnapshot<WeatherSnapshot>("nws") ?? { forecast: null, alerts: [] };
    this.sports = this.store.getSnapshot<SportsSnapshot>("sports") ?? { games: [] };
    this.weatherProvider = options.weatherProvider ?? this.makeWeatherProvider();
    this.sportsProvider = options.sportsProvider ?? this.makeSportsProvider();
    this.publisher = options.publisher ?? new LocalDisplayPublisher({ dataDir: this.config.dataDir });
    this.transport = options.transport ?? new TidbytCloudTransport();
    this.renderer = options.renderer ?? createDefaultRenderer();
    this.logger = options.logger;
    this.sourceTimeoutMs = options.sourceTimeoutMs ?? 20_000;
    for (const health of this.store.getSourceHealth()) this.health.set(health.id, health);
  }
  async close(): Promise<void> {
    if (this.closed) return;
    this.stopScheduler();
    this.closed = true;
    this.configGeneration++;
    this.generation++;
    await Promise.allSettled([...this.publications]);
    this.store.close();
  }
  startScheduler(initialDelayMs = 0): void {
    if (!this.stopped || this.closed) return;
    this.stopped = false;
    this.scheduleNextPush(initialDelayMs);
    void this.refreshSources();
  }
  stopScheduler(): void {
    this.stopped = true;
    if (this.schedulerTimer) clearTimeout(this.schedulerTimer);
    this.schedulerTimer = null;
    for (const timer of this.sourceTimers.values()) clearTimeout(timer);
    this.sourceTimers.clear();
    this.nextSchedulerRunAt = null;
  }
  getRuntimeConfig(): RuntimeConfig { return this.config; }
  getEditableConfig(): SanitizedConfig { return sanitizeConfig(this.config); }

  async updateConfig(input: unknown): Promise<SanitizedConfig> {
    const changes = input as Partial<RuntimeConfig>;
    const policyChanges = changes?.screenPolicy;
    const next = normalizeOptions({ ...this.config, ...changes,
      ...(policyChanges && typeof policyChanges === "object" && !Array.isArray(policyChanges)
        ? { screenPolicy: { ...this.config.screenPolicy, ...policyChanges } } : {}),
    });
    const weatherChanged = next.latitude !== this.config.latitude || next.longitude !== this.config.longitude || next.nwsContact !== this.config.nwsContact || next.refreshIntervalSeconds !== this.config.refreshIntervalSeconds;
    const sportsChanged = JSON.stringify(next.favoriteTeams) !== JSON.stringify(this.config.favoriteTeams);
    const modeChanged = next.screenPolicy.mode !== this.config.screenPolicy.mode;
    this.store.setOptions(next);
    this.config = { ...this.config, ...next };
    this.configGeneration++;
    this.generation++;
    if (modeChanged) this.store.setSchedulerState({ ...this.state(), showing: null, cycleNextIndex: 0, manualHold: null });
    const state = this.state();
    if (state.manualHold && !this.panels(new Date()).some((panel) => panel.id === state.manualHold!.panelId)) {
      this.store.setSchedulerState({ ...state, manualHold: null });
    }
    if (weatherChanged) {
      this.weather = { forecast: null, alerts: [] };
      this.store.setSnapshot("nws", this.weather);
      this.health.delete("nws");
      this.weatherProvider = this.makeWeatherProvider();
    }
    if (sportsChanged) {
      this.sports = { games: [] };
      this.store.setSnapshot("sports", this.sports);
      this.health.delete("sports");
      this.sportsProvider = this.makeSportsProvider();
    }
    this.refreshes.clear();
    for (const timer of this.sourceTimers.values()) clearTimeout(timer);
    this.sourceTimers.clear();
    await this.publish().catch((error: unknown) => this.logger?.warn({ error: message(error) }, "Settings saved; cloud push failed"));
    if (!this.stopped) void this.refreshSources();
    return sanitizeConfig(this.config);
  }

  /** Source I/O is independent of status reads and screen publication. */
  async refreshSources(now = new Date()): Promise<void> {
    await Promise.allSettled([this.refreshSource("nws", now), this.refreshSource("sports", now)]);
  }
  private refreshSource(source: "nws" | "sports", now: Date): Promise<void> {
    const existing = this.refreshes.get(source);
    if (existing) return existing;
    if (this.closed) return Promise.resolve();
    const timer = this.sourceTimers.get(source);
    if (timer) clearTimeout(timer);
    this.sourceTimers.delete(source);
    const revision = this.configGeneration;
    if (this.state().disabledSources.includes(source)) {
      this.health.set(source, { id: source, label: source, status: "disabled", checkedAt: now.toISOString() });
      return Promise.resolve();
    }
    const job = (async () => {
      try {
        const result = await withDeadline<{ snapshot: WeatherSnapshot | SportsSnapshot; health: SourceHealth }>(() => source === "nws" ? this.weatherProvider.getSnapshot(now) : this.sportsProvider.getSnapshot(now), this.sourceTimeoutMs);
        if (this.closed || revision !== this.configGeneration || this.state().disabledSources.includes(source)) return;
        const before = JSON.stringify(this.panels(now).map(({ id, version }) => ({ id, version })));
        if (source === "nws") {
          const snapshot = result.snapshot as WeatherSnapshot;
          this.weather = { ...snapshot,
            forecastObservedAt: snapshot.forecastObservedAt ?? (result.health.status === "ok" ? now.toISOString() : this.weather.forecastObservedAt),
            alertsObservedAt: snapshot.alertsObservedAt ?? (result.health.status === "ok" ? now.toISOString() : this.weather.alertsObservedAt),
          };
          this.store.setSnapshot(source, this.weather);
        } else {
          const previous = this.sports;
          this.sports = { games: (result.snapshot as SportsSnapshot).games.map((game) => ({
            ...game,
            observedAt: game.observedAt ?? (result.health.status === "ok" ? now.toISOString() : previous.games.find((old) => old.id === game.id)?.observedAt),
            completedAt: game.status === "final" ? previous.games.find((old) => old.id === game.id)?.completedAt ?? game.completedAt ?? now.toISOString() : undefined,
          })) };
          this.store.setSnapshot(source, this.sports);
        }
        this.health.set(source, { ...result.health, lastSuccessAt: result.health.lastSuccessAt ?? (result.health.status === "ok" ? now.toISOString() : this.health.get(source)?.lastSuccessAt) });
        if (before !== JSON.stringify(this.panels(now).map(({ id, version }) => ({ id, version })))) this.generation++;
      } catch (error) {
        if (this.closed || revision !== this.configGeneration) return;
        this.health.set(source, { id: source, label: source, status: "degraded", checkedAt: now.toISOString(), lastSuccessAt: this.health.get(source)?.lastSuccessAt, detail: message(error) });
      } finally {
        if (!this.closed && revision === this.configGeneration) {
          try { this.store.setSourceHealth([...this.health.values()]); }
          catch (error) { this.logger?.warn({ error: message(error) }, "Could not persist source health"); }
          this.wake();
          if (!this.stopped) {
            const interval = source === "nws" ? Math.min(60, this.config.refreshIntervalSeconds)
              : this.sports.games.some((game) => game.status === "live" || game.status === "scheduled" && Date.parse(game.startsAt) - now.getTime() < 900_000) ? 30 : this.config.refreshIntervalSeconds;
            this.sourceTimers.set(source, setTimeout(() => { void this.refreshSource(source, new Date()); }, interval * 1000));
          }
        }
      }
    })().catch((error: unknown) => { this.logger?.warn({ error: message(error) }, "Source refresh failed"); });
    this.refreshes.set(source, job);
    void job.finally(() => { if (this.refreshes.get(source) === job) this.refreshes.delete(source); });
    return job;
  }

  async getPanels(now = new Date()): Promise<Panel[]> { return this.panels(now); }
  async getPanel(panelId: string, now = new Date()): Promise<Panel | null> { return this.panels(now).find((panel) => panel.id === panelId) ?? null; }
  async getStatus(now = new Date()): Promise<TidbytrStatus> {
    const panels = this.panels(now);
    const state = this.state();
    const next = choosePanel({ panels, now, state, policy: this.config.screenPolicy, timeZone: this.config.timezone });
    const frame = this.store.getPublishedFrame();
    const lastPublish = this.store.getLastPublish();
    const configured = Boolean(this.config.tidbytApiToken && this.config.tidbytDeviceId);
    const accepted = Boolean(configured && lastPublish?.ok && lastPublish.deviceId === this.config.tidbytDeviceId && lastPublish.installationId === this.config.installationId);
    const acceptedFrame = Boolean(configured && frame?.delivery === "tidbyt-cloud" && frame.deviceId === this.config.tidbytDeviceId && frame.installationId === this.config.installationId);
    return {
      display: {
        delivery: "tidbyt-cloud", width: 64, height: 32, configured,
        currentFrame: acceptedFrame && frame ? { panelId: frame.panel.id, renderedAt: frame.renderedAt } : null,
        currentPanel: acceptedFrame ? frame?.panel ?? null : null,
        fresh: acceptedFrame && this.isFrameFresh(frame, now), degradedReason: acceptedFrame ? frame?.degradedReason ?? null : null,
        apiAccepted: accepted, lastPublish,
      },
      config: sanitizeConfig(this.config),
      sourceHealth: (["clock", "nws", "sports", "local"] as const).map((id) => state.disabledSources.includes(id)
        ? { id, label: id, status: "disabled", checkedAt: now.toISOString() }
        : id === "clock" || id === "local" ? { id, label: id === "clock" ? "Clock baseline" : "Personal & ambient", status: "ok", checkedAt: now.toISOString() }
        : this.health.get(id) ?? { id, label: id, status: "degraded", checkedAt: now.toISOString(), detail: "Awaiting first refresh" }),
      decisions: this.store.getDecisions(),
      scheduler: {
        snoozedUntil: state.snoozedUntil, skippedPanelIds: state.skippedPanelIds, disabledSources: state.disabledSources,
        nextDecisionInSeconds: this.nextSchedulerRunAt ? Math.max(0, Math.ceil((this.nextSchedulerRunAt - now.getTime()) / 1000)) : this.decisionInterval(),
        nextPanel: panels.find((panel) => panel.id === next.selectedPanelId) ?? null, nextReason: next.reason,
        manualHold: state.manualHold && Date.parse(state.manualHold.until) > now.getTime() ? state.manualHold : null,
      },
    };
  }
  async preview(panelId: string, now = new Date()): Promise<Buffer | null> {
    const panel = await this.getPanel(panelId, now);
    return panel ? (await this.renderer.render(panel, now, this.config)).webp : null;
  }

  publish(panelId?: string, now = new Date(), holdSeconds = 60): Promise<{ decision: SchedulerDecision; panel: Panel | null }> {
    const work = this.publishFrame(panelId, now, holdSeconds);
    this.publications.add(work);
    void work.then(() => this.publications.delete(work), () => this.publications.delete(work));
    return work;
  }
  private async publishFrame(panelId: string | undefined, now: Date, holdSeconds: number): Promise<{ decision: SchedulerDecision; panel: Panel | null }> {
    if (this.closed) throw new Error("Runtime is closed");
    const startedAt = performance.now();
    const generation = ++this.generation;
    const candidates = this.panels(now);
    if (panelId && !candidates.some((panel) => panel.id === panelId && !isExpired(panel, now) && !this.state().disabledSources.includes(panel.source))) throw new Error("Requested panel is unavailable");
    const previousHold = this.state().manualHold;
    const reservedHold = panelId ? { panelId, until: new Date(now.getTime() + holdSeconds * 1000).toISOString() } : null;
    if (reservedHold) this.store.setSchedulerState({ ...this.state(), manualHold: reservedHold });
    const rollbackHold = () => {
      if (!this.closed && generation === this.generation && reservedHold && this.state().manualHold?.until === reservedHold.until) this.store.setSchedulerState({ ...this.state(), manualHold: previousHold });
    };
    const decision = choosePanel({ panels: candidates, now, state: this.state(), manualPanelId: panelId, policy: this.config.screenPolicy, timeZone: this.config.timezone });
    let panel = candidates.find((panel) => panel.id === decision.selectedPanelId) ?? null;
    if (!panel) {
      this.store.setSchedulerState({ ...this.state(), skippedPanelIds: [] });
      this.store.addDecision(decision);
      return { decision, panel: null };
    }
    let degradedReason: string | undefined;
    let frame;
    try {
      frame = await withDeadline(() => this.renderer.render(panel!, now, this.config), 11_000);
      await validateDisplayFrame(frame);
    } catch (error) {
      if (this.closed || generation !== this.generation) return { decision: { ...decision, result: "not-shown", reason: "Superseded render" }, panel: null };
      this.store.addDecision({ ...decision, result: "not-shown", reason: message(error) });
      if (panelId) { rollbackHold(); throw error; }
      degradedReason = message(error);
      panel = clockPanel(now.toISOString(), this.config.timezone);
      frame = await this.fallback.render(panel, now, this.config);
    }
    const selected = panel;
    const rendered = frame;
    const commit = this.commitTail.then(async () => {
      if (this.closed || generation !== this.generation || isExpired(selected, new Date(now.getTime() + performance.now() - startedAt))) return { decision: { ...decision, result: "not-shown" as const, reason: "Superseded render" }, panel: null };
      try {
        const hold = this.state().manualHold;
        const result = await this.transport.push(rendered, {
          apiToken: this.config.tidbytApiToken, deviceId: this.config.tidbytDeviceId,
          installationId: this.config.installationId,
          isCurrent: () => !this.closed && generation === this.generation && !isExpired(selected, new Date(now.getTime() + performance.now() - startedAt)),
          background: !selected.critical && !panelId && !(hold && Date.parse(hold.until) > now.getTime())
            && !(this.config.screenPolicy.mode === "clock-cycle" && this.state().showing?.panelId !== selected.id),
        });
        this.store.setLastPublish(result);
        if (!result.ok) throw new Error(result.message);
        if (this.closed || generation !== this.generation) return { decision: { ...decision, result: "not-shown" as const, reason: "Superseded commit" }, panel: null };
        await this.publisher.publish(rendered);
        if (this.closed || generation !== this.generation) return { decision: { ...decision, result: "not-shown" as const, reason: "Superseded commit" }, panel: null };
        this.store.setPublishedFrame({ panel: selected, renderedAt: rendered.renderedAt,
          delivery: "tidbyt-cloud", deviceId: result.deviceId, installationId: result.installationId,
          validUntil: new Date(Math.min(Date.parse(selected.expiresAt), now.getTime() + 60_000)).toISOString(),
          sha256: createHash("sha256").update(rendered.webp).digest("hex"), degradedReason });
        let state = recordShown(this.state(), selected, now, this.config.screenPolicy);
        if (degradedReason && this.config.screenPolicy.mode === "clock-cycle") {
          const failedKind = candidates.find((candidate) => candidate.id === decision.selectedPanelId)?.kind;
          const failedIndex = failedKind ? CLOCK_CYCLE_KINDS.indexOf(failedKind) : -1;
          if (failedIndex >= 0) state = { ...state, cycleNextIndex: (failedIndex + 1) % CLOCK_CYCLE_KINDS.length,
            showing: { panelId: selected.id, startedAt: now.toISOString(), version: selected.version ?? "" }, manualHold: null };
        }
        if (panelId && selected.id === panelId && !degradedReason) state = { ...state, manualHold: { panelId, until: new Date(now.getTime() + holdSeconds * 1000).toISOString() } };
        this.store.setSchedulerState(state);
        const published: SchedulerDecision = { ...decision, selectedPanelId: selected.id, selectedPanelTitle: selected.title, result: "published", reason: degradedReason ? `Degraded clock fallback: ${degradedReason}` : decision.reason };
        this.store.addDecision(published);
        return { decision: published, panel: selected };
      } catch (error) {
        this.store.addDecision({ ...decision, result: "not-shown", reason: message(error) });
        rollbackHold();
        throw error;
      }
    });
    this.commitTail = commit.catch(() => undefined);
    return commit;
  }
  push(panelId?: string, now = new Date()) { return this.publish(panelId, now); }
  async getPublishedPreview(): Promise<Buffer | null> {
    const metadata = this.store.getPublishedFrame();
    if (metadata?.delivery !== "tidbyt-cloud" || metadata.deviceId !== this.config.tidbytDeviceId || metadata.installationId !== this.config.installationId) return null;
    const frame = await this.publisher.readCurrentFrame();
    return frame && createHash("sha256").update(frame).digest("hex") === metadata.sha256 ? frame : null;
  }

  async skip(panelId?: string, now = new Date()): Promise<SchedulerDecision> {
    const id = panelId ?? this.store.getPublishedFrame()?.panel.id;
    if (!id) throw new Error("No panel to skip");
    const state = markSkipped(this.state(), id);
    this.store.setSchedulerState({ ...state, manualHold: state.manualHold?.panelId === id ? null : state.manualHold });
    const decision = this.action("Manual skip", now, id);
    await this.publish(undefined, now);
    return decision;
  }
  async snooze(minutes: number, now = new Date()): Promise<SchedulerDecision> {
    this.store.setSchedulerState({ ...snoozeUntil(this.state(), new Date(now.getTime() + minutes * 60_000)), manualHold: null });
    const decision = this.action(`Snoozed for ${minutes} minutes`, now);
    await this.publish(undefined, now);
    return decision;
  }
  async setSourceEnabled(sourceId: SourceId, enabled: boolean, now = new Date()): Promise<SchedulerDecision> {
    if (sourceId === "clock" && !enabled) throw new Error("Clock baseline cannot be disabled");
    this.store.setSchedulerState({ ...setSourceEnabled(this.state(), sourceId, enabled), manualHold: null });
    this.configGeneration++;
    this.refreshes.clear();
    if (!enabled) {
      const timer = this.sourceTimers.get(sourceId);
      if (timer) clearTimeout(timer);
      this.sourceTimers.delete(sourceId);
    }
    const decision = this.action(`${sourceId} ${enabled ? "enabled" : "disabled"}`, now);
    await this.publish(undefined, now);
    if (!this.stopped) void this.refreshSources(now);
    return decision;
  }
  private action(reason: string, now: Date, panelId: string | null = null): SchedulerDecision {
    const decision: SchedulerDecision = { id: randomUUID(), decidedAt: now.toISOString(), selectedPanelId: panelId, selectedPanelTitle: null, reason, result: "skipped", skipped: [] };
    this.store.addDecision(decision);
    return decision;
  }
  private state() { return this.store.getSchedulerState(this.config.quietHours); }
  private panels(now: Date): Panel[] {
    return buildPanels(this.config, { ...this.weather, forecast: this.weather.forecastObservedAt ? this.weather.forecast : null, alerts: this.weather.alertsObservedAt ? this.weather.alerts : [] },
      { games: this.sports.games.filter((game) => game.observedAt && Number.isFinite(Date.parse(game.observedAt))) }, now);
  }
  private makeWeatherProvider() { return new NwsProvider({ latitude: this.config.latitude, longitude: this.config.longitude, userAgent: this.config.nwsContact, initialSnapshot: this.weather, forecastRefreshMs: this.config.refreshIntervalSeconds * 1000 }); }
  private makeSportsProvider() { return new EspnSportsProvider({ favoriteTeams: this.config.favoriteTeams, initialSnapshot: this.sports }); }
  private isFrameFresh(frame: PublishedFrame | null, now: Date): boolean {
    return Boolean(frame && Date.parse(frame.validUntil) > now.getTime() && !isExpired(frame.panel, now) && (!["clock", "baby-age"].includes(frame.panel.kind) || Math.floor(Date.parse(frame.renderedAt) / 60_000) === Math.floor(now.getTime() / 60_000)));
  }
  private decisionInterval(): number { return Math.min(this.config.screenPolicy.minimumDwellSeconds, this.config.schedulerIntervalSeconds); }
  private nextPublishDelay(now = new Date()): number {
    const remaining = cycleRemainingMilliseconds({ panels: this.panels(now), state: this.state(), now, policy: this.config.screenPolicy });
    return Math.max(50, Math.min(this.decisionInterval() * 1000, 60_000 - now.getTime() % 60_000, remaining ?? Infinity));
  }
  private wake(): void { if (!this.stopped) this.scheduleNextPush(0); }
  private scheduleNextPush(delayMs: number): void {
    if (this.stopped || this.closed) return;
    if (this.schedulerTimer) clearTimeout(this.schedulerTimer);
    this.nextSchedulerRunAt = Date.now() + delayMs;
    this.schedulerTimer = setTimeout(() => {
      this.schedulerTimer = null;
      void this.publish().catch((error: unknown) => this.logger?.warn({ error: message(error) }, "Scheduled publish failed")).finally(() => {
        if (!this.stopped && !this.schedulerTimer) this.scheduleNextPush(this.nextPublishDelay());
      });
    }, delayMs);
  }
}
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
