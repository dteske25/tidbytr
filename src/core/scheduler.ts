import crypto from "node:crypto";
import type { ScreenPolicy } from "./policy.js";
import type { PanelKind, Panel, SchedulerDecision, SchedulerRequest, SchedulerState, SourceId } from "./types.js";

import { DEFAULT_SCREEN_POLICY } from "./policy.js";

export const CLOCK_CYCLE_KINDS: readonly PanelKind[] = ["forecast", "baby-age", "starfield"];

export function defaultSchedulerState(quietHours = null as SchedulerState["quietHours"]): SchedulerState {
  return {
    cycleNextIndex: 0,
    snoozedUntil: null,
    skippedPanelIds: [],
    disabledSources: [],
    quietHours,
    history: {},
    showing: null,
    manualHold: null,
  };
}

export function choosePanel(request: SchedulerRequest): SchedulerDecision {
  const skipped: SchedulerDecision["skipped"] = [];
  const now = request.now;
  const quietActive = isQuietHour(now, request.timeZone ?? "UTC", request.state.quietHours);
  const policy = request.policy ?? DEFAULT_SCREEN_POLICY;
  const eligible = request.panels.filter((panel) => {
    const reason = rejectionReason(panel, request.state, now, quietActive);
    if (reason) skipped.push({ panelId: panel.id, reason });
    return !reason;
  });
  const history = request.state.history;
  const current = eligible.find((panel) => panel.id === request.state.showing?.panelId);
  const dwellActive = current && now.getTime() - Date.parse(request.state.showing!.startedAt) < policy.minimumDwellSeconds * 1000;
  const critical = eligible.filter(isCritical).toSorted((a, b) => {
    const aLast = history[a.id]?.lastShownAt;
    const bLast = history[b.id]?.lastShownAt;
    return (aLast ? Date.parse(aLast) : -Infinity) - (bLast ? Date.parse(bLast) : -Infinity) || b.priority - a.priority || a.id.localeCompare(b.id);
  });
  if (critical.length) {
    const urgent = critical.find((panel) => !history[panel.id] || history[panel.id]?.version !== panel.version);
    const selected = urgent && (!current?.critical || urgent.priority >= current.priority) ? urgent
      : dwellActive && current?.critical ? current : critical[0]!;
    return decision(now, selected, "Critical alert interrupt", "selected", skipped);
  }
  const hold = request.state.manualHold;
  const manualId = request.manualPanelId ?? (hold && Date.parse(hold.until) > now.getTime() ? hold.panelId : undefined);
  const manual = request.panels.find((panel) => panel.id === manualId && !isExpired(panel, now) && !request.state.disabledSources.includes(panel.source));
  if (manual) return decision(now, manual, "Manual show requested", "selected", skipped);
  if (request.manualPanelId) skipped.push({ panelId: request.manualPanelId, reason: "Manual panel unavailable" });
  if (policy.mode === "clock-cycle") return chooseClockCycle(request, eligible, skipped, policy);
  if (dwellActive && current) return decision(now, current, "Minimum display time", "selected", skipped);
  const ready = eligible.filter((panel) => {
    const last = history[panel.id];
    if (panel.kind === "clock" || !last || last.version !== panel.version) return true;
    const elapsed = now.getTime() - Date.parse(last.lastShownAt);
    if (elapsed >= policy.cooldownSeconds[panel.kind] * 1000) return true;
    skipped.push({ panelId: panel.id, reason: "Repeat cooldown" });
    return false;
  });
  const sorted = ready.toSorted((a, b) => {
    const score = (panel: Panel) => panel.priority + Math.min(200, Math.max(0,
      (now.getTime() - Date.parse(history[panel.id]?.lastShownAt ?? panel.createdAt)) / 1000));
    return score(b) - score(a) || a.id.localeCompare(b.id);
  });
  const selected = sorted[0] ?? null;
  return decision(now, selected, selected ? selectionReason(selected) : "No eligible panels", selected ? "selected" : "not-shown", skipped);
}

function chooseClockCycle(request: SchedulerRequest, eligible: Panel[], skipped: SchedulerDecision["skipped"], policy: ScreenPolicy): SchedulerDecision {
  const { now, state } = request;
  const clock = eligible.find((panel) => panel.kind === "clock");
  const current = eligible.find((panel) => panel.id === state.showing?.panelId);
  const elapsed = state.showing ? Math.max(0, now.getTime() - Date.parse(state.showing.startedAt)) : Infinity;
  for (const panel of eligible) {
    if (panel.kind !== "clock" && !CLOCK_CYCLE_KINDS.includes(panel.kind)) skipped.push({ panelId: panel.id, reason: "Not part of clock-led cycle" });
  }
  const selected = (panel: Panel, reason: string) => decision(now, panel, reason, "selected", skipped);
  if (current?.kind === "clock" && elapsed < policy.clockSeconds * 1000) return selected(current, "Clock interval");
  if (current && CLOCK_CYCLE_KINDS.includes(current.kind)) {
    if (elapsed < policy.screenSeconds * 1000) return selected(current, "Cycle screen interval");
    if (clock) return selected(clock, "Clock between screens");
  }
  // Start with clock, and return to it after interruptions or unavailable content.
  if ((!current || current.kind !== "clock") && clock) return selected(clock, "Clock interval");
  const cursor = Number.isInteger(state.cycleNextIndex) ? ((state.cycleNextIndex % CLOCK_CYCLE_KINDS.length) + CLOCK_CYCLE_KINDS.length) % CLOCK_CYCLE_KINDS.length : 0;
  for (let offset = 0; offset < CLOCK_CYCLE_KINDS.length; offset++) {
    const kind = CLOCK_CYCLE_KINDS[(cursor + offset) % CLOCK_CYCLE_KINDS.length];
    const panel = eligible.find((candidate) => candidate.kind === kind);
    if (panel) return selected(panel, `Clock-led cycle: ${panel.title}`);
  }
  return decision(now, clock ?? null, clock ? "Clock while cycle screens are unavailable" : "No eligible panels", clock ? "selected" : "not-shown", skipped);
}

/** Wake at a slot/hold boundary even when regular refreshes are aligned to a minute. */
export function cycleRemainingMilliseconds(request: SchedulerRequest): number | null {
  const policy = request.policy ?? DEFAULT_SCREEN_POLICY;
  if (policy.mode !== "clock-cycle") return null;
  const hold = request.state.manualHold;
  const heldFor = hold ? Date.parse(hold.until) - request.now.getTime() : 0;
  if (heldFor > 0) return heldFor;
  const showing = request.state.showing;
  const current = request.panels.find((panel) => panel.id === showing?.panelId);
  if (!current || !showing || current.critical) return null;
  const duration = current.kind === "clock" ? policy.clockSeconds : CLOCK_CYCLE_KINDS.includes(current.kind) ? policy.screenSeconds : null;
  if (duration === null) return null;
  const remaining = duration * 1000 - (request.now.getTime() - Date.parse(showing.startedAt));
  return remaining > 0 ? remaining : null;
}

/** Commit display history only after successful publication, never on status reads. */
export function recordShown(state: SchedulerState, panel: Panel, now: Date, policy: ScreenPolicy = DEFAULT_SCREEN_POLICY): SchedulerState {
  const version = panel.version ?? "";
  const samePanel = state.showing?.panelId === panel.id;
  const continuing = samePanel && (policy.mode === "clock-cycle" || state.showing?.version === version);
  const index = CLOCK_CYCLE_KINDS.indexOf(panel.kind);
  const previous = state.history[panel.id];
  const activeHistory = Object.fromEntries(Object.entries(state.history)
    .filter(([, entry]) => now.getTime() - Date.parse(entry.lastShownAt) < 7 * 86400_000));
  return {
    ...state, skippedPanelIds: [],
    cycleNextIndex: policy.mode === "clock-cycle" && index >= 0 ? (index + 1) % CLOCK_CYCLE_KINDS.length : state.cycleNextIndex,
    manualHold: state.manualHold && Date.parse(state.manualHold.until) > now.getTime() ? state.manualHold : null,
    showing: continuing && state.showing ? { ...state.showing, version } : { panelId: panel.id, startedAt: now.toISOString(), version },
    history: { ...activeHistory, [panel.id]: { lastShownAt: now.toISOString(), version, showCount: (previous?.showCount ?? 0) + (continuing ? 0 : 1) } },
  };
}

export function isExpired(panel: Panel, now: Date): boolean {
  const expiry = Date.parse(panel.expiresAt);
  return !Number.isFinite(expiry) || expiry <= now.getTime();
}

export function isQuietHour(now: Date, timeZone: string, quietHours: SchedulerState["quietHours"]): boolean {
  if (!quietHours) {
    return false;
  }

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  const current = hour * 60 + minute;
  const start = parseTime(quietHours.start);
  const end = parseTime(quietHours.end);

  if (start === end) {
    return false;
  }

  if (start < end) {
    return current >= start && current < end;
  }

  return current >= start || current < end;
}

export function markSkipped(state: SchedulerState, panelId: string): SchedulerState {
  return {
    ...state,
    skippedPanelIds: [...new Set([...state.skippedPanelIds, panelId])],
  };
}

export function snoozeUntil(state: SchedulerState, until: Date): SchedulerState {
  return {
    ...state,
    snoozedUntil: until.toISOString(),
  };
}

export function setSourceEnabled(state: SchedulerState, sourceId: SourceId, enabled: boolean): SchedulerState {
  const disabled = new Set(state.disabledSources);
  if (enabled) {
    disabled.delete(sourceId);
  } else {
    disabled.add(sourceId);
  }

  return {
    ...state,
    disabledSources: [...disabled],
  };
}

function rejectionReason(panel: Panel, state: SchedulerState, now: Date, quietActive: boolean): string | null {
  if (state.disabledSources.includes(panel.source)) {
    return "Source disabled";
  }

  if (isExpired(panel, now)) {
    return "TTL expired";
  }

  if (state.skippedPanelIds.includes(panel.id)) {
    return "Panel skipped";
  }

  if (state.snoozedUntil && Date.parse(state.snoozedUntil) > now.getTime() && !isCritical(panel) && panel.kind !== "clock") {
    return "Snoozed";
  }

  if (quietActive && !isCritical(panel) && panel.kind !== "clock") {
    return "Quiet hours allow only clock or critical alerts";
  }

  return null;
}

function isCritical(panel: Panel): boolean {
  return panel.critical === true;
}

function selectionReason(panel: Panel): string {
  if (panel.critical) {
    return "Critical alert interrupt";
  }

  if (panel.kind === "live-score") {
    return "Live game priority";
  }

  if (panel.kind === "clock") {
    return "Clock baseline";
  }

  return "Highest priority ready";
}

function decision(
  now: Date,
  panel: Panel | null,
  reason: string,
  result: SchedulerDecision["result"],
  skipped: SchedulerDecision["skipped"],
): SchedulerDecision {
  return {
    id: crypto.randomUUID(),
    decidedAt: now.toISOString(),
    selectedPanelId: panel?.id ?? null,
    selectedPanelTitle: panel?.title ?? null,
    reason,
    result,
    skipped,
  };
}

function parseTime(time: string): number {
  const [hour, minute] = time.split(":").map(Number);
  return (hour ?? 0) * 60 + (minute ?? 0);
}
