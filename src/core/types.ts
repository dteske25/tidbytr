import type { ScreenPolicy } from "./policy.js";
export type PanelKind =
  | "clock"
  | "nws-alert"
  | "forecast"
  | "upcoming-game"
  | "live-score"
  | "final-score";

export type SourceId = "clock" | "nws" | "sports";

export type AlertSeverity = "warning" | "watch" | "advisory";

export type SourceStatus = "ok" | "degraded" | "error" | "disabled";

export interface FrameBundle {
  panelId: string;
  width: 64;
  height: 32;
  mimeType: "image/webp";
  encoding: "webp";
  webp: Buffer;
  renderedAt: string;
}

export interface Panel {
  id: string;
  kind: PanelKind;
  source: SourceId;
  title: string;
  priority: number;
  createdAt: string;
  ttlSeconds: number;
  expiresAt: string;
  critical?: boolean;
  version?: string;
  payload: unknown;
}

export interface SchedulerDecision {
  id: string;
  decidedAt: string;
  selectedPanelId: string | null;
  selectedPanelTitle: string | null;
  reason: string;
  result: "selected" | "skipped" | "published" | "not-shown";
  skipped: Array<{ panelId: string; reason: string }>;
}

export interface SourceHealth {
  id: SourceId;
  label: string;
  status: SourceStatus;
  checkedAt: string;
  detail?: string;
  lastSuccessAt?: string;
}

export interface PublishResult {
  ok: boolean;
  status: number;
  message: string;
  attemptCount: number;
  publishedAt: string;
  renderedAt: string;
  panelId: string;
  framePath: string;
}

export interface HomeAssistantOptions {
  displayBaseUrl: string;
  timezone: string;
  latitude: number;
  longitude: number;
  nwsContact: string;
  favoriteTeams: string[];
  logLevel: "trace" | "debug" | "info" | "warn" | "error";
  schedulerIntervalSeconds: number;
  refreshIntervalSeconds: number;
  screenPolicy: ScreenPolicy;
  quietHours: QuietHours | null;
}

export interface QuietHours {
  start: string;
  end: string;
}

export interface RuntimeConfig extends HomeAssistantOptions {
  dataDir: string;
  host: string;
  port: number;
  displayHost: string;
  displayPort: number;
  displayPollingWindowSeconds: number;
}

export interface DisplayHistory {
  lastShownAt: string;
  version: string;
  showCount: number;
}

export interface PublishedFrame {
  panel: Panel;
  renderedAt: string;
  validUntil: string;
  sha256: string;
  degradedReason?: string;
}

export interface SchedulerState {
  snoozedUntil: string | null;
  skippedPanelIds: string[];
  disabledSources: SourceId[];
  quietHours: QuietHours | null;
  history: Record<string, DisplayHistory>;
  showing: { panelId: string; startedAt: string; version: string } | null;
  manualHold: { panelId: string; until: string } | null;
}

export interface SchedulerRequest {
  panels: Panel[];
  now: Date;
  state: SchedulerState;
  manualPanelId?: string;
  policy?: ScreenPolicy;
  timeZone?: string;
}

export interface TidbytrStatus {
  display: {
    delivery: "hdk-local-pull";
    width: 64;
    height: 32;
    remoteUrl: string | null;
    currentFrame: { panelId: string; renderedAt: string } | null;
    online: boolean;
    lastPublish: PublishResult | null;
    lastPull: string | null;
    currentPanel: Panel | null;
    fresh: boolean;
    degradedReason: string | null;
  };
  config: SanitizedConfig;
  sourceHealth: SourceHealth[];
  decisions: SchedulerDecision[];
  scheduler: {
    snoozedUntil: string | null;
    skippedPanelIds: string[];
    disabledSources: SourceId[];
    nextDecisionInSeconds: number;
    nextPanel: Panel | null;
    nextReason: string;
    manualHold: SchedulerState["manualHold"];
  };
}

export type SanitizedConfig = RuntimeConfig;
