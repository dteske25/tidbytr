import { Activity, ChevronRight, CloudSun, Gamepad2, Layers3, Monitor, Play, Settings, SkipForward, Sparkles, Timer } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { COLLEGE_TEAMS } from "../../core/college-teams.js";
import { SCREENS, SCREEN_GROUPS } from "../../core/screens.js";
import type { Panel, SanitizedConfig, TidbytrStatus } from "../../core/types.js";
import { ChildrenForm } from "./ChildrenForm.js";
import { apiUrl } from "./ingress.js";

const pages = [
  { name: "Display", icon: Monitor },
  { name: "Screens", icon: Layers3 },
  { name: "Settings", icon: Settings },
  { name: "Diagnostics", icon: Activity },
] as const;
type Page = typeof pages[number]["name"];
type Save = (body: Record<string, unknown>) => Promise<void>;
const groupIcons = [Sparkles, CloudSun, Gamepad2] as const;

function currentPage(): Page {
  return pages.find(({ name }) => window.location.hash === `#${name.toLowerCase()}`)?.name ?? "Display";
}

export function App() {
  const [page, setPage] = useState(currentPage);
  const [data, setData] = useState<{ status: TidbytrStatus; panels: Panel[]; previewRevision: number }>();
  const [offline, setOffline] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const refreshId = useRef(0);
  const pending = useRef(false);
  const refresh = useCallback(async () => {
    const id = ++refreshId.current;
    try {
      const responses = await Promise.all([fetch(apiUrl("status")), fetch(apiUrl("panels"))]);
      if (responses.some((response) => !response.ok)) throw new Error("Dashboard unavailable");
      const [status, { panels }] = await Promise.all(responses.map((response) => response.json()));
      if (refreshId.current === id) { setData({ status, panels, previewRevision: id }); setOffline(false); }
    } catch {
      if (refreshId.current === id) setOffline(true);
    }
  }, []);

  useEffect(() => {
    const navigate = () => setPage(currentPage());
    window.addEventListener("hashchange", navigate);
    void refresh();
    const timer = window.setInterval(() => { if (!pending.current) void refresh(); }, 15_000);
    return () => { window.removeEventListener("hashchange", navigate); window.clearInterval(timer); };
  }, [refresh]);

  const act = async (path: string, body: Record<string, unknown>, method = "POST") => {
    if (pending.current) return;
    pending.current = true;
    ++refreshId.current;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(apiUrl(path), { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? result.error ?? "Action failed");
      await refresh();
      if (path === "actions/push" && result.panel?.id !== body.panelId) throw new Error("A higher-priority screen took over.");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Action failed");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };

  const status = data?.status;
  const panels = data?.panels ?? [];
  const selected = panels.find(({ id }) => id === selectedId);
  const save: Save = (body) => act("config", body, "PUT");
  const available = !offline && Boolean(status);
  const delivery = !status?.display.configured ? "Setup required"
    : status.scheduler.disabledKinds.length === SCREENS.length && !status.display.currentFrame ? "Screens off"
    : status.display.apiAccepted ? "Cloud accepted"
    : status.display.lastPublish ? "Delivery issue" : "Waiting for delivery";

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><span className="brand-mark"><Monitor size={20} /></span>Tidbytr</div>
      <a className={`connection ${status?.display.apiAccepted && !offline ? "connected" : ""}`} href="#diagnostics">
        <span aria-hidden="true" />{offline ? "Dashboard offline" : status ? delivery : "Connecting"}
      </a>
    </header>
    <nav className="navigation" aria-label="Dashboard">
      {pages.map(({ name, icon: Icon }) => <a key={name} href={`#${name.toLowerCase()}`} aria-current={page === name ? "page" : undefined}>
        <Icon size={17} />{name}
      </a>)}
    </nav>

    <main className="workspace">
      {error && <p className="notice error" role="alert">{error}</p>}
      {offline && <div className="notice" role="status">Couldn’t reach Tidbytr. <button onClick={() => void refresh()}>Try again</button></div>}
      {!status && !offline && <p role="status">Loading dashboard…</p>}
      {status && <>
        {page === "Display" && <section aria-labelledby="display-title">
          <div className="page-title"><h1 id="display-title">Display</h1></div>
          <div className="display-grid">
            <section className="card display-card" aria-labelledby="sent-title">
              <div className="card-heading"><h2 id="sent-title">Last sent</h2>{status.display.currentFrame && <span>{time(status.display.currentFrame.renderedAt, status.config.timezone)}</span>}</div>
              <p className="screen-title">{status.display.currentPanel?.title ?? "No screen sent yet"}</p>
              <ScreenImage src={status.display.currentFrame ? apiUrl(`display/current.webp?v=${encodeURIComponent(status.display.currentFrame.renderedAt)}`) : undefined}
                alt="Last image accepted by the Tidbyt API" empty="Sent screens appear here" />
              <div className="display-actions">
                <button disabled={busy || !available || !status.display.currentPanel} onClick={() => void act("actions/skip", { panelId: status.display.currentPanel?.id })}>
                  <SkipForward size={16} />Skip current
                </button>
                <form className="snooze" onSubmit={(event) => {
                  event.preventDefault();
                  void act("actions/snooze", { minutes: Number(new FormData(event.currentTarget).get("minutes")) });
                }}>
                  <select name="minutes" aria-label="Snooze duration" defaultValue="15"><option value="5">5 min</option><option value="15">15 min</option><option value="30">30 min</option><option value="60">1 hour</option></select>
                  <button disabled={busy || !available} type="submit"><Timer size={16} />Snooze</button>
                </form>
              </div>
              {status.scheduler.snoozedUntil && Date.parse(status.scheduler.snoozedUntil) > Date.now() &&
                <p className="action-note">Snoozed until {time(status.scheduler.snoozedUntil, status.config.timezone)}</p>}
              {status.scheduler.manualHold && <p className="action-note">Showing manually until {time(status.scheduler.manualHold.until, status.config.timezone)}</p>}
              {status.display.degradedReason && <p className="action-note" role="status">Fallback display · {status.display.degradedReason}</p>}
            </section>
            <section className="card display-card" aria-labelledby="preview-title">
              <div className="card-heading"><h2 id="preview-title">Preview</h2><span>Local only</span></div>
              <select className="screen-picker" aria-label="Screen to preview" value={selected?.id ?? ""} onChange={(event) => setSelectedId(event.target.value)}>
                <option value="">Choose a screen</option>
                {panels.map((panel) => <option key={panel.id} value={panel.id}>{panel.title}</option>)}
              </select>
              <ScreenImage src={selected ? apiUrl(`panels/${encodeURIComponent(selected.id)}/preview.webp?v=${data?.previewRevision}`) : undefined}
                alt={selected ? `${selected.title} preview` : "Screen preview"} empty={panels.length ? "Choose a screen to preview" : "No screens available"} />
              <div className="display-actions"><button className="primary" disabled={!available || busy || !selected} onClick={() => void act("actions/push", { panelId: selected?.id })}>
                <Play size={16} />Show on Tidbyt
              </button></div>
            </section>
          </div>
          <section className="card up-next" aria-labelledby="next-title">
            <div><h2 id="next-title">Up next</h2><p>{!status.scheduler.nextPanel ? "No screen scheduled"
              : status.scheduler.nextPanel.id === status.display.currentPanel?.id && status.scheduler.nextPanel.kind === status.display.currentPanel?.kind
                ? `Continuing ${status.scheduler.nextPanel.title}` : status.scheduler.nextPanel.title}</p></div>
            <button disabled={!panels.some(({ id }) => id === status.scheduler.nextPanel?.id)} onClick={() => setSelectedId(status.scheduler.nextPanel?.id ?? "")}>Preview next<ChevronRight size={16} /></button>
          </section>
        </section>}
        {page === "Screens" && <section aria-labelledby="screens-title">
          <div className="page-title"><h1 id="screens-title">Screens</h1><p>Choose what appears on your Tidbyt.</p></div>
          <div className="screen-grid">
            {SCREEN_GROUPS.map(({ label, screens }, index) => {
              const Icon = groupIcons[index]!;
              return <section className="card screen-group" key={label}>
                <h2><Icon size={19} />{label}</h2>
                {screens.map(({ kind, label: screen }) => {
                  const checked = !status.scheduler.disabledKinds.includes(kind);
                  return <label className="switch-row" key={kind}>
                    <span>{screen}</span>
                    <input type="checkbox" role="switch" checked={checked} disabled={!available || busy}
                      onChange={(event) => void act("actions/screen", { kind, enabled: event.target.checked })} />
                  </label>;
                })}
                {label === "Everyday" && <Disclosure title="Child profiles">
                  <ChildrenForm key={JSON.stringify([status.config.children, status.config.babyBirthDate, status.config.babyName])} config={status.config} onSave={save} />
                </Disclosure>}
                {label === "Sports" && <Disclosure title="Favorite teams">
                  <FavoriteTeams key={JSON.stringify(status.config.favoriteTeams)} config={status.config} onSave={save} />
                </Disclosure>}
              </section>;
            })}
          </div>
        </section>}
        {page === "Settings" && <section aria-labelledby="settings-title">
          <div className="page-title"><h1 id="settings-title">Settings</h1></div>
          <div className="settings-grid">
            <Rotation key={JSON.stringify(status.config.screenPolicy)} config={status.config} onSave={save} />
            <QuietHours key={JSON.stringify(status.config.quietHours)} config={status.config} onSave={save} />
          </div>
        </section>}
        {page === "Diagnostics" && <Diagnostics status={status} />}
      </>}
    </main>
  </div>;
}

function ScreenImage({ src, alt, empty }: { src?: string; alt: string; empty: string }) {
  const [failed, setFailed] = useState("");
  return <div className="screen-image">
    {src && failed !== src ? <img src={src} alt={alt} onError={() => setFailed(src)} />
      : <span>{src ? "Image unavailable" : empty}</span>}
  </div>;
}

function Disclosure({ title, children }: { title: string; children: ReactNode }) {
  return <details className="disclosure"><summary>{title}</summary><div>{children}</div></details>;
}

function FavoriteTeams({ config, onSave }: { config: SanitizedConfig; onSave: Save }) {
  const matches = (team: string, key: string, label: string) => [key.toUpperCase(), label.toUpperCase()].includes(team.toUpperCase());
  const pro = config.favoriteTeams.filter((team) => !COLLEGE_TEAMS.some(({ key, label }) => matches(team, key, label)));
  return <form onSubmit={(event) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const college = values.getAll("team").map(String);
    const other = String(values.get("pro")).split(",").map((team) => team.trim()).filter(Boolean);
    void onSave({ favoriteTeams: [...college, ...other] });
  }}>
    {COLLEGE_TEAMS.map(({ key, label }) => <label className="policy-row" key={key}>{label}
      <input name="team" type="checkbox" value={key} defaultChecked={config.favoriteTeams.some((team) => matches(team, key, label))} />
    </label>)}
    <label className="policy-row">Pro teams<input name="pro" placeholder="KC, DEN" defaultValue={pro.join(", ")} /></label>
    <div className="form-actions"><button type="button" onClick={(event) => {
      for (const input of event.currentTarget.form?.querySelectorAll<HTMLInputElement>('input[name="team"]') ?? []) input.checked = true;
    }}>Select all college teams</button><button className="primary" type="submit">Save teams</button></div>
  </form>;
}

function Rotation({ config, onSave }: { config: SanitizedConfig; onSave: Save }) {
  const policy = config.screenPolicy;
  const [mode, setMode] = useState(policy.mode);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const screenPolicy = mode === "clock-cycle" ? {
      mode, clockSeconds: Number(values.get("clock")), screenSeconds: Number(values.get("screen")),
    } : {
      mode, minimumDwellSeconds: Number(values.get("dwell")),
      priorities: { ...policy.priorities, ...Object.fromEntries(SCREENS.filter(({ kind }) => kind !== "clock")
        .map(({ kind }) => [kind, Number(values.get(`priority-${kind}`))])) },
      cooldownSeconds: { ...policy.cooldownSeconds, ...Object.fromEntries(SCREENS.filter(({ kind }) => kind !== "clock")
        .map(({ kind }) => [kind, Number(values.get(`repeat-${kind}`))])) },
    };
    void onSave({ screenPolicy });
  }
  return <section className="card settings-card"><h2>Rotation</h2><form onSubmit={submit}>
    <label className="policy-row">Mode<select value={mode} onChange={(event) => setMode(event.target.value as typeof mode)}>
      <option value="clock-cycle">Clock-led cycle</option><option value="priority">Priority scheduling</option>
    </select></label>
    {mode === "clock-cycle" ? <>
      <label className="policy-row">Clock (seconds)<input name="clock" type="number" min="20" max="3600" required defaultValue={policy.clockSeconds} /></label>
      <label className="policy-row">Other screens (seconds)<input name="screen" type="number" min="10" max="120" required defaultValue={policy.screenSeconds} /></label>
    </> : <>
      <label className="policy-row">Minimum display (seconds)<input name="dwell" type="number" min="20" max="120" required defaultValue={policy.minimumDwellSeconds} /></label>
      <Disclosure title="Priority and repeat settings">
        {SCREENS.filter(({ kind }) => kind !== "clock").map(({ kind, label }) => <fieldset key={kind}><legend>{label}</legend>
          <label className="policy-row">Priority<input name={`priority-${kind}`} type="number" min="0" max="100" required defaultValue={policy.priorities[kind]} /></label>
          <label className="policy-row">Repeat (seconds)<input name={`repeat-${kind}`} type="number" min="20" max="3600" required defaultValue={policy.cooldownSeconds[kind]} /></label>
        </fieldset>)}
      </Disclosure>
    </>}
    <button className="primary" type="submit">Save rotation</button>
  </form></section>;
}

function QuietHours({ config, onSave }: { config: SanitizedConfig; onSave: Save }) {
  return <section className="card settings-card"><h2>Quiet hours</h2><p>{config.timezone}</p>
    <form onSubmit={(event) => {
      event.preventDefault();
      const values = new FormData(event.currentTarget);
      void onSave({ quietHours: values.has("enabled") ? { start: values.get("start"), end: values.get("end") } : null });
    }}>
      <label className="policy-row">Enabled<input name="enabled" type="checkbox" defaultChecked={Boolean(config.quietHours)} /></label>
      <label className="policy-row">Start<input name="start" type="time" required defaultValue={config.quietHours?.start ?? "22:00"} /></label>
      <label className="policy-row">End<input name="end" type="time" required defaultValue={config.quietHours?.end ?? "06:00"} /></label>
      <button className="primary" type="submit">Save quiet hours</button>
    </form>
  </section>;
}

function Diagnostics({ status }: { status: TidbytrStatus }) {
  const { display, config, scheduler } = status;
  return <section aria-labelledby="diagnostics-title">
    <div className="page-title"><h1 id="diagnostics-title">Diagnostics</h1></div>
    <div className="settings-grid">
      <section className="card settings-card"><h2>Delivery</h2>
        {!display.configured && <p>Set the Tidbyt API token and device ID in Home Assistant’s add-on configuration.</p>}
        <dl>
          <div><dt>Device</dt><dd>{config.tidbytDeviceId || "Unconfigured"}</dd></div>
          <div><dt>Installation</dt><dd>{config.installationId}</dd></div>
          <div><dt>Last push</dt><dd>{display.lastPublish?.message ?? "None"}</dd></div>
          <div><dt>Next decision</dt><dd>{scheduler.nextReason}</dd></div>
        </dl>
      </section>
      <section className="card settings-card"><h2>Sources</h2>
        <dl>{status.sourceHealth.map(({ id, label, status, detail }) => <div key={id}><dt>{label}</dt><dd>{status}{detail ? ` · ${detail}` : ""}</dd></div>)}</dl>
      </section>
    </div>
    <section className="card log"><h2>Recent activity</h2>
      {status.decisions.length ? <ul>{status.decisions.slice(0, 12).map((decision) => <li key={decision.id}>
        <time dateTime={decision.decidedAt}>{time(decision.decidedAt, config.timezone)}</time>
        <span>{decision.selectedPanelTitle ?? decision.reason}</span><small>{decision.result} · {decision.reason}</small>
      </li>)}</ul> : <p>No activity yet.</p>}
    </section>
  </section>;
}

function time(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone }).format(new Date(value));
}
