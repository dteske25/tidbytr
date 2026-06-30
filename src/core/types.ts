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
  payload: unknown;
}

export interface SchedulerDecision {
  id: string;
  decidedAt: string;
  selectedPanelId: string | null;
  selectedPanelTitle: string | null;
  reason: string;
  result: "selected" | "skipped" | "pushed" | "not-shown";
  skipped: Array<{ panelId: string; reason: string }>;
}

export interface SourceHealth {
  id: SourceId;
  label: string;
  status: SourceStatus;
  checkedAt: string;
  detail?: string;
}

export interface PushResult {
  ok: boolean;
  status: number;
  message: string;
  attemptCount: number;
  pushedAt: string;
}

export interface DisplayTransport {
  push(frame: FrameBundle, options: DisplayPushOptions): Promise<PushResult>;
}

export interface DisplayPushOptions {
  apiToken: string;
  deviceId: string;
  installationId: string;
}

export interface HomeAssistantOptions {
  tidbytApiToken: string;
  tidbytDeviceId: string;
  timezone: string;
  latitude: number;
  longitude: number;
  nwsContact: string;
  favoriteTeams: string[];
  logLevel: "trace" | "debug" | "info" | "warn" | "error";
  schedulerIntervalSeconds: number;
  refreshIntervalSeconds: number;
  quietHours: QuietHours | null;
  installationId: string;
}

export interface QuietHours {
  start: string;
  end: string;
}

export interface RuntimeConfig extends HomeAssistantOptions {
  dataDir: string;
  host: string;
  port: number;
}

export interface SchedulerState {
  snoozedUntil: string | null;
  skippedPanelIds: string[];
  disabledSources: SourceId[];
  quietHours: QuietHours | null;
}

export interface SchedulerRequest {
  panels: Panel[];
  now: Date;
  state: SchedulerState;
  manualPanelId?: string;
  timeZone?: string;
}

export interface TidbytrStatus {
  display: {
    width: 64;
    height: 32;
    online: boolean;
    lastPush: PushResult | null;
    currentPanel: Panel | null;
  };
  config: SanitizedConfig;
  sourceHealth: SourceHealth[];
  decisions: SchedulerDecision[];
  scheduler: {
    snoozedUntil: string | null;
    skippedPanelIds: string[];
    disabledSources: SourceId[];
    nextDecisionInSeconds: number;
  };
}

export type SanitizedConfig = Omit<RuntimeConfig, "tidbytApiToken"> & {
  tidbytApiToken: string;
};
