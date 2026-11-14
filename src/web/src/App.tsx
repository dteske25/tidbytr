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
  Sparkles,
  Wifi,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { COLLEGE_TEAMS } from "../../core/college-teams.js";
import type { Panel, SourceHealth, SourceId, TidbytrStatus } from "../../core/types.js";
import { ChildrenForm } from "./ChildrenForm.js";
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
  local: Sparkles,
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
          <div className="version">v0.10.1</div>
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
            <strong>{!status?.display.configured ? "Configure Tidbyt API delivery" : status.display.apiAccepted ? "Tidbyt API accepted the last update" : "Waiting for a successful API push"}</strong>
          </div>
          <div className="topbar-metrics">
            <span>Cloud delivery</span>
            <b className={status?.display.apiAccepted ? "chip online" : "chip offline"}>{status?.display.apiAccepted ? "Accepted" : "Pending / failed"}</b>
            <span>Last publish</span>
            <b>{formatLastPublish(status)}</b>
            <span>Next decision</span>
            <b>{status ? `in ${status.scheduler.nextDecisionInSeconds}s` : "--"}</b>
          </div>
        </header>

        <section className="main-grid">
          <div className="display-column">
            <section className="current-panel">
              <div className="section-heading">
                <div>
                  <h1>Last accepted screen</h1>
                  <p>{publishedPanel?.title ?? "No accepted screen"} · {status?.display.fresh ? "Fresh" : "Stale / waiting"}</p>
                  <p>Next: {status?.scheduler.nextPanel?.title ?? "None"} · {status?.scheduler.nextReason}</p>
                  {status?.display.degradedReason ? <p role="alert">Display fallback: {status.display.degradedReason}</p> : null}
                  <p>{publishedPanel ? `Source: ${sourceLabel(publishedPanel.source)}` : "Source: none"}</p>
                </div>
                <div className="panel-meta">
                  {status?.config.screenPolicy.mode === "clock-cycle" ? <span>Requested slot: {!publishedPanel ? "--" : publishedPanel.critical ? "Alert override" : publishedPanel.kind === "live-score" ? "Live game" : status.scheduler.manualHold && status.scheduler.manualHold.panelId === publishedPanel.id ? "Manual hold" : `${publishedPanel?.kind === "clock" ? status.config.screenPolicy.clockSeconds : status.config.screenPolicy.screenSeconds}s`}</span>
                    : <span>Priority: {publishedPanel?.priority ?? "--"}</span>}
                  <span>Slot: {panelKindLabel(publishedPanel?.kind)}</span>
                  {status?.config.screenPolicy.mode === "priority" ? <span>Data validity: {publishedPanel ? `${publishedPanel.ttlSeconds}s` : "--"}</span> : null}
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
              {status?.scheduler.manualHold ? <p>Selection held until {formatTime(status.scheduler.manualHold.until)}; critical alerts may interrupt Tidbytr.</p> : null}
              <button className="primary-action" onClick={() => void act("actions/push", { panelId: currentPanel?.id })}>
                <Play size={16} />
                Show now
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
              <h2>Personal screens</h2>
              <ChildrenForm key={JSON.stringify([status.config.children, status.config.babyBirthDate, status.config.babyName, status.config.starfieldEnabled])} config={status.config} onSave={(body) => act("config", body, "PUT")} />
            </section> : null}

            {status ? <section className="rail-section">
              <h2>Favorite teams</h2>
              <form key={JSON.stringify(status.config.favoriteTeams)} onSubmit={(event) => {
                event.preventDefault();
                const data = new FormData(event.currentTarget);
                const collegeTeams = data.getAll("collegeTeam").map(String);
                const otherTeams = String(data.get("otherTeams") ?? "").split(",").map((team) => team.trim()).filter(Boolean);
                void act("config", { favoriteTeams: [...collegeTeams, ...otherTeams] }, "PUT");
              }}>
                {COLLEGE_TEAMS.map(({ key, label }) => (
                  <label className="policy-row" key={key}>{label}
                    <input name="collegeTeam" type="checkbox" value={key} defaultChecked={status.config.favoriteTeams.some(
                      (team) => [key.toUpperCase(), label.toUpperCase()].includes(team.toUpperCase()),
                    )} />
                  </label>
                ))}
                <label className="policy-row">Pro teams
                  <input name="otherTeams" type="text" placeholder="KC, DEN" defaultValue={status.config.favoriteTeams.filter(
                    (team) => !COLLEGE_TEAMS.some(({ key, label }) => [key.toUpperCase(), label.toUpperCase()].includes(team.toUpperCase())),
                  ).join(", ")} />
                </label>
                <div className="action-pair">
                  <button className="outline-action" type="button" onClick={(event) => {
                    for (const input of event.currentTarget.form?.querySelectorAll<HTMLInputElement>('input[name="collegeTeam"]') ?? []) {
                      input.checked = true;
                    }
                  }}>Select all college teams</button>
                  <button className="outline-action" type="submit">Save favorite teams</button>
                </div>
              </form>
            </section> : null}

            {status ? <section className="rail-section">
              <h2>Rotation</h2>
              <p>Weather, baby age, stars, and sports each get a turn with clock in between. Live games pause the rotation. Score changes bring that game forward. Critical weather alerts take precedence.</p>
              <form key={`rotation-${status.config.screenPolicy.mode}-${status.config.screenPolicy.clockSeconds}-${status.config.screenPolicy.screenSeconds}`} onSubmit={(event) => {
                event.preventDefault();
                const data = new FormData(event.currentTarget);
                void act("config", { screenPolicy: {
                  mode: String(data.get("mode")), clockSeconds: Number(data.get("clockSeconds")), screenSeconds: Number(data.get("screenSeconds")),
                } }, "PUT");
              }}>
                <label className="policy-row">Mode <select name="mode" aria-label="Scheduling mode" defaultValue={status.config.screenPolicy.mode}>
                  <option value="clock-cycle">Clock-led cycle</option><option value="priority">Priority scheduling</option>
                </select></label>
                <label className="policy-row">Clock (seconds) <input name="clockSeconds" aria-label="Clock slot seconds" type="number" min="20" max="3600" required defaultValue={status.config.screenPolicy.clockSeconds} /></label>
                <label className="policy-row">Other screens (seconds) <input name="screenSeconds" aria-label="Other screen slot seconds" type="number" min="10" max="120" required defaultValue={status.config.screenPolicy.screenSeconds} /></label>
                <button className="outline-action" type="submit">Save rotation</button>
              </form>
              <p>Slot durations apply to the clock-led cycle. Priority mode uses priorities and cooldowns, including sports and ordinary advisories.</p>
            </section> : null}

            {status?.config.screenPolicy.mode === "priority" ? <section className="rail-section">
              <h2>Screen priorities</h2>
              <p>Higher priorities appear first. Cooldowns limit repeats. Live games stay on screen, and critical weather alerts take precedence.</p>
              <form key={JSON.stringify(status.config.screenPolicy)} onSubmit={(event) => {
                event.preventDefault();
                const data = new FormData(event.currentTarget);
                const policy = status.config.screenPolicy;
                void act("config", { screenPolicy: {
                  ...policy,
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
              <h2>Tidbyt API delivery</h2>
              <div className="url-box">Device: {status?.config.tidbytDeviceId || "Not configured"}</div>
              <p>App ID: {status?.config.installationId ?? "tidbytrmain"}</p>
              {!status?.display.configured ? <p className="config-warning">Set tidbyt_api_token and tidbyt_device_id in the add-on configuration.</p> : null}
              <p>{status?.config.screenPolicy.mode === "clock-cycle"
                ? "Clock-led cycle requests immediate changes at slot boundaries. For closest timing, leave only Tidbytr enabled in the Tidbyt app rotation. Store apps and cloud delay can change physical screen time."
                : "Scheduled updates share rotation with Store apps. Show now, critical alerts, and detected score changes request immediate display."} API acceptance does not confirm the physical display.</p>
            </section>

            <section className="rail-section">
              <h2>Source toggles</h2>
              <div className="toggle-list">
                {(["clock", "nws", "sports", "local"] as SourceId[]).map((sourceId) => {
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
          {panel.kind === "baby-age" ? panel.title : panelKindLabel(panel.kind)}
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
  return source === "nws" ? "NWS weather" : source === "sports" ? "Favorite teams" : source === "local" ? "Personal & ambient" : "Clock baseline";
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
