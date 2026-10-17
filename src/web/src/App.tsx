import {
  Activity,
  CalendarClock,
  CheckCircle2,
  Clock3,
  CloudSun,
  Gamepad2,
  Gauge,
  Monitor,
  PauseCircle,
  Play,
  Settings,
  SkipForward,
  Wifi,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Panel, SourceHealth, SourceId, TidbytrStatus } from "../../core/types.js";
import { apiUrl } from "./ingress.js";

type LoadState = "loading" | "ready" | "error";

const nav = [
  { label: "Display", icon: Monitor },
  { label: "Sources", icon: Wifi },
  { label: "Scheduler", icon: CalendarClock },
  { label: "Settings", icon: Settings },
];

const sourceIcons: Record<SourceId, typeof CloudSun> = {
  clock: Clock3,
  nws: CloudSun,
  sports: Gamepad2,
};

export function App() {
  const [status, setStatus] = useState<TidbytrStatus | null>(null);
  const [panels, setPanels] = useState<Panel[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [selectedPanelId, setSelectedPanelId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const [statusResponse, panelsResponse] = await Promise.all([fetch(apiUrl("status")), fetch(apiUrl("panels"))]);
      if (!statusResponse.ok || !panelsResponse.ok) {
        throw new Error("API unavailable");
      }
      const nextStatus = (await statusResponse.json()) as TidbytrStatus;
      const panelPayload = (await panelsResponse.json()) as { panels: Panel[] };
      setStatus(nextStatus);
      setPanels(panelPayload.panels);
      setSelectedPanelId((current) => current ?? nextStatus.display.currentPanel?.id ?? panelPayload.panels[0]?.id ?? null);
      setLoadState("ready");
      setRefreshKey((key) => key + 1);
    } catch {
      setLoadState("error");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const currentPanel = useMemo(
    () => panels.find((panel) => panel.id === selectedPanelId) ?? status?.display.currentPanel ?? panels[0] ?? null,
    [panels, selectedPanelId, status?.display.currentPanel],
  );

  const publishedPanel = status?.display.currentPanel;
  const act = async (path: string, body: Record<string, unknown>, method = "POST") => {
    setActionError(null);
    try {
      const response = await fetch(apiUrl(path), { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!response.ok) {
        const detail = await response.json() as { message?: string; error?: string };
        throw new Error(detail.message ?? detail.error ?? "Action failed");
      }
      await refresh();
    } catch (error) { setActionError(error instanceof Error ? error.message : "Action failed"); }
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div>
          <div className="brand">Tidbytr</div>
          <div className="version">v0.5.0</div>
        </div>

        <nav aria-label="Main navigation">
          {nav.map((item, index) => {
            const Icon = item.icon;
            return (
              <button className={index === 0 ? "nav-item active" : "nav-item"} key={item.label}>
                <Icon size={18} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="sidebar-status">
          <StatusPair label="Server" value={loadState === "ready" ? "Running" : loadState} tone={loadState === "ready" ? "ok" : "warn"} />
          <StatusPair label="TZ" value={status?.config.timezone ?? "Local"} />
          <StatusPair label="Display" value="64x32" />
          <StatusPair label="HA Ingress" value={isIngress() ? "Connected" : "Local"} tone="ok" />
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div className="run-state">
            <span className="live-dot" />
            <strong>{status?.display.online ? "Tidbyt is polling" : "Waiting for Tidbyt pull"}</strong>
          </div>
          <div className="topbar-metrics">
            <span>Display</span>
            <b className={status?.display.online ? "chip online" : "chip offline"}>{status?.display.online ? "Polling" : "No recent pull"}</b>
            <span>Last publish</span>
            <b>{formatLastPublish(status)}</b>
            <span>Last pull</span>
            <b>{status?.display.lastPull ? formatTime(status.display.lastPull) : "Never"}</b>
            <span>Next decision</span>
            <b>{status ? `in ${status.scheduler.nextDecisionInSeconds}s` : "--"}</b>
          </div>
        </header>

        <section className="main-grid">
          <div className="display-column">
            <section className="current-panel">
              <div className="section-heading">
                <div>
                  <h1>Published screen</h1>
                  <p>{publishedPanel?.title ?? "No published screen"} · {status?.display.fresh ? "Fresh" : "Stale / waiting"}</p>
                  <p>Next: {status?.scheduler.nextPanel?.title ?? "None"} · {status?.scheduler.nextReason}</p>
                  {status?.display.degradedReason ? <p role="alert">Display fallback: {status.display.degradedReason}</p> : null}
                  <p>{publishedPanel ? `Source: ${sourceLabel(publishedPanel.source)}` : "Source: none"}</p>
                </div>
                <div className="panel-meta">
                  <span>Priority: {publishedPanel?.priority ?? "--"}</span>
                  <span>Slot: {panelKindLabel(publishedPanel?.kind)}</span>
                  <span>TTL: {publishedPanel ? `${publishedPanel.ttlSeconds}s` : "--"}</span>
                </div>
              </div>

              {status?.display.currentFrame ? <div className="preview-frame">
                <img className="preview-image" alt="Last published screen" src={apiUrl(`display/current.webp?v=${refreshKey}`)} />
              </div> : null}
              <div className="preview-label">Selected preview: {currentPanel?.title ?? "None"} (64x32)</div>
              <div className="preview-frame">
                {currentPanel ? (
                  <img
                    alt={`${currentPanel.title} preview`}
                    className="preview-image"
                    src={apiUrl(`panels/${encodeURIComponent(currentPanel.id)}/preview.webp?v=${refreshKey}`)}
                  />
                ) : (
                  <div className="preview-empty">NO PANEL</div>
                )}
              </div>

              <PanelStrip panels={panels} selectedPanelId={currentPanel?.id ?? null} onSelect={setSelectedPanelId} />
            </section>

            <section className="decision-section">
              <h2>Decision history</h2>
              <div className="decision-table" role="table" aria-label="Decision history">
                <div className="decision-row heading" role="row">
                  <span>Time</span>
                  <span>Decision</span>
                  <span>Source</span>
                  <span>Slot / Reason</span>
                  <span>Result</span>
                </div>
                {(status?.decisions ?? []).slice(0, 8).map((decision) => (
                  <div className="decision-row" role="row" key={decision.id}>
                    <span>{formatTime(decision.decidedAt)}</span>
                    <span className={`decision-${decision.result}`}>{decision.result}</span>
                    <span>{decision.selectedPanelTitle ?? "Scheduler"}</span>
                    <span>{decision.reason}</span>
                    <span className="result-cell">
                      {decision.result}
                      {decision.result === "published" ? <CheckCircle2 size={15} /> : <PauseCircle size={15} />}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          </div>

          <aside className="right-rail">
            <section className="rail-section">
              <h2>Source health</h2>
              <div className="health-list">
                {(status?.sourceHealth ?? fallbackHealth()).map((health) => (
                  <HealthRow key={health.id} health={health} />
                ))}
              </div>
            </section>

            <section className="rail-section">
              <h2>Actions</h2>
              {actionError ? <p className="config-warning" role="alert">{actionError}</p> : null}
              {status?.scheduler.manualHold ? <p>Manual hold until {formatTime(status.scheduler.manualHold.until)}; critical alerts may interrupt.</p> : null}
              <button className="primary-action" onClick={() => void act("actions/push", { panelId: currentPanel?.id })}>
                <Play size={16} />
                Show for 1 minute
              </button>
              <div className="action-pair">
                <button className="outline-action skip" onClick={() => void act("actions/skip", { panelId: currentPanel?.id })}>
                  <SkipForward size={16} />
                  Skip
                </button>
                <button className="outline-action snooze" onClick={() => void act("actions/snooze", { minutes: 15 })}>
                  <Clock3 size={16} />
                  Snooze
                </button>
              </div>
              <div className="snooze-grid" aria-label="Snooze duration">
                {[5, 15, 30, 60].map((minutes) => (
                  <button key={minutes} onClick={() => void act("actions/snooze", { minutes })}>
                    {minutes === 60 ? "1h" : `${minutes}m`}
                  </button>
                ))}
              </div>
            </section>

            {status ? <section className="rail-section">
              <h2>Screen priorities</h2>
              <p>Higher priorities appear first. Cooldowns limit repeats; critical alerts may interrupt.</p>
              <form key={JSON.stringify(status.config.screenPolicy)} onSubmit={(event) => {
                event.preventDefault();
                const data = new FormData(event.currentTarget);
                const policy = status.config.screenPolicy;
                void act("config", { screenPolicy: {
                  minimumDwellSeconds: Number(data.get("dwell")),
                  priorities: Object.fromEntries(Object.keys(policy.priorities).map((kind) => [kind, Number(data.get(`priority-${kind}`))])),
                  cooldownSeconds: Object.fromEntries(Object.keys(policy.cooldownSeconds).map((kind) => [kind, Number(data.get(`cooldown-${kind}`))])),
                } }, "PUT");
              }}>
                <label className="policy-row">Minimum screen time (seconds)
                  <input name="dwell" aria-label="Minimum screen time" type="number" min="20" max="120" required defaultValue={status.config.screenPolicy.minimumDwellSeconds} />
                </label>
                {Object.keys(status.config.screenPolicy.priorities).filter((kind) => kind !== "clock").map((value) => {
                  const kind = value as Panel["kind"];
                  return <div className="policy-row" key={kind}>
                    <span>{panelKindLabel(kind)}</span>
                    <label>Priority <input aria-label={`${kind} priority`} name={`priority-${kind}`} type="number" min="0" max="100" required defaultValue={status.config.screenPolicy.priorities[kind]} /></label>
                    <label>Repeat after (s) <input aria-label={`${kind} repeat cooldown`} name={`cooldown-${kind}`} type="number" min="20" max="3600" required defaultValue={status.config.screenPolicy.cooldownSeconds[kind]} /></label>
                  </div>;
                })}
                <input type="hidden" name="priority-clock" value={status.config.screenPolicy.priorities.clock} />
                <input type="hidden" name="cooldown-clock" value="0" />
                <button className="outline-action" type="submit">Save screen rules</button>
              </form>
            </section> : null}

            <section className="rail-section">
              <h2>HDK pull URL</h2>
              <div className="url-box">{status?.display.remoteUrl ?? "Set display_base_url"}</div>
              {status?.config.displayBaseUrl && isIngressUrl(status.config.displayBaseUrl) ? (
                <p className="config-warning">Use the LAN display port, not a Home Assistant Ingress URL.</p>
              ) : null}
              {!status?.config.displayBaseUrl ? <p className="config-warning">Set display_base_url to the add-on LAN address.</p> : null}
            </section>

            <section className="rail-section">
              <h2>Source toggles</h2>
              <div className="toggle-list">
                {(["clock", "nws", "sports"] as SourceId[]).map((sourceId) => {
                  const disabled = status?.scheduler.disabledSources.includes(sourceId) ?? false;
                  return (
                    <button
                      disabled={sourceId === "clock"}
                      className="toggle-row"
                      key={sourceId}
                      onClick={() => void act("actions/source", { sourceId, enabled: disabled })}
                    >
                      <span>{sourceLabel(sourceId)}</span>
                      <span className={disabled ? "toggle" : "toggle on"} />
                    </button>
                  );
                })}
              </div>
            </section>
          </aside>
        </section>
      </main>
    </div>
  );
}

function PanelStrip({
  panels,
  selectedPanelId,
  onSelect,
}: {
  panels: Panel[];
  selectedPanelId: string | null;
  onSelect: (panelId: string) => void;
}) {
  return (
    <div className="panel-strip">
      {panels.map((panel) => (
        <button
          className={panel.id === selectedPanelId ? "panel-token active" : "panel-token"}
          key={panel.id}
          onClick={() => onSelect(panel.id)}
          title={panel.title}
        >
          <Gauge size={14} />
          {panelKindLabel(panel.kind)}
        </button>
      ))}
    </div>
  );
}

function HealthRow({ health }: { health: SourceHealth }) {
  const Icon = sourceIcons[health.id] ?? Activity;
  const StatusIcon = health.status === "ok" ? CheckCircle2 : health.status === "disabled" ? PauseCircle : XCircle;
  return (
    <div className="health-row">
      <Icon size={19} />
      <span>{health.label}</span>
      <b className={`health-${health.status}`}>{health.status}</b>
      <small>{formatTime(health.checkedAt)}</small>
      <StatusIcon size={16} />
    </div>
  );
}

function StatusPair({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warn" }) {
  return (
    <div className="status-pair">
      <span>{label}</span>
      <b className={tone ? `tone-${tone}` : undefined}>{value}</b>
    </div>
  );
}

function fallbackHealth(): SourceHealth[] {
  const checkedAt = new Date().toISOString();
  return [
    { id: "clock", label: "Clock baseline", status: "ok", checkedAt },
    { id: "nws", label: "NWS weather", status: "degraded", checkedAt },
    { id: "sports", label: "Favorite teams", status: "disabled", checkedAt },
  ];
}

function sourceLabel(source: SourceId) {
  return source === "nws" ? "NWS weather" : source === "sports" ? "Favorite teams" : "Clock baseline";
}

function panelKindLabel(kind: Panel["kind"] | undefined) {
  if (!kind) {
    return "--";
  }

  return kind
    .split("-")
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function formatLastPublish(status: TidbytrStatus | null) {
  if (!status?.display.lastPublish) {
    return "Never";
  }

  return status.display.lastPublish.ok ? "OK" : status.display.lastPublish.message;
}

function isIngress() {
  return window.location.pathname.includes("/api/hassio_ingress/");
}

function isIngressUrl(value: string) {
  return value.includes("/api/hassio_ingress/") || value.includes("/hassio_ingress/");
}
