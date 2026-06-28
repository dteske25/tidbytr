import crypto from "node:crypto";
import type { Panel, SchedulerDecision, SchedulerRequest, SchedulerState, SourceId } from "./types.js";

const CRITICAL_KINDS = new Set(["nws-alert"]);

export function defaultSchedulerState(quietHours = null as SchedulerState["quietHours"]): SchedulerState {
  return {
    snoozedUntil: null,
    skippedPanelIds: [],
    disabledSources: [],
    quietHours,
  };
}

export function choosePanel(request: SchedulerRequest): SchedulerDecision {
  const skipped: SchedulerDecision["skipped"] = [];
  const now = request.now;
  const quietActive = isQuietHour(now, request.timeZone ?? "UTC", request.state.quietHours);
  const manualPanel = request.manualPanelId
    ? request.panels.find((panel) => panel.id === request.manualPanelId)
    : undefined;

  if (manualPanel && !isExpired(manualPanel, now)) {
    return decision(now, manualPanel, "Manual push requested", "selected", skipped);
  }

  if (request.manualPanelId && !manualPanel) {
    skipped.push({ panelId: request.manualPanelId, reason: "Manual panel not found" });
  }

  const filtered = request.panels.filter((panel) => {
    const reason = rejectionReason(panel, request.state, now, quietActive);
    if (reason) {
      skipped.push({ panelId: panel.id, reason });
      return false;
    }

    return true;
  });

  const sorted = filtered.toSorted((a, b) => {
    if (b.priority !== a.priority) {
      return b.priority - a.priority;
    }

    return Date.parse(a.createdAt) - Date.parse(b.createdAt);
  });

  const selected = sorted[0] ?? null;
  if (!selected) {
    return decision(now, null, "No eligible panels", "not-shown", skipped);
  }

  return decision(now, selected, selectionReason(selected), "selected", skipped);
}

export function isExpired(panel: Panel, now: Date): boolean {
  return Date.parse(panel.expiresAt) <= now.getTime();
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
  return Boolean(panel.critical) || CRITICAL_KINDS.has(panel.kind);
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
