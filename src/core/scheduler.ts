import crypto from "node:crypto";
import type { Panel, SchedulerDecision, SchedulerRequest, SchedulerState, SourceId } from "./types.js";

import { DEFAULT_SCREEN_POLICY } from "./policy.js";

export function defaultSchedulerState(quietHours = null as SchedulerState["quietHours"]): SchedulerState {
  return {
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

/** Commit display history only after successful publication, never on status reads. */
export function recordShown(state: SchedulerState, panel: Panel, now: Date): SchedulerState {
  const version = panel.version ?? "";
  const continuing = state.showing?.panelId === panel.id && state.showing.version === version;
  const previous = state.history[panel.id];
  const activeHistory = Object.fromEntries(Object.entries(state.history)
    .filter(([, entry]) => now.getTime() - Date.parse(entry.lastShownAt) < 7 * 86400_000));
  return {
    ...state, skippedPanelIds: [],
    manualHold: state.manualHold && Date.parse(state.manualHold.until) > now.getTime() ? state.manualHold : null,
    showing: continuing ? state.showing : { panelId: panel.id, startedAt: now.toISOString(), version },
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
