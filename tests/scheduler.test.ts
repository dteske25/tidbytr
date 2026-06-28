import { describe, expect, it } from "vitest";
import type { Panel } from "../src/core/types.js";
import { choosePanel, defaultSchedulerState, snoozeUntil } from "../src/core/scheduler.js";

const now = new Date("2026-06-28T12:00:00.000Z");

describe("scheduler", () => {
  it("uses clock as the baseline when no higher-priority panels exist", () => {
    const decision = choosePanel({ panels: [panel("clock", 0, "clock")], now, state: defaultSchedulerState() });
    expect(decision.selectedPanelId).toBe("clock");
    expect(decision.reason).toBe("Clock baseline");
  });

  it("lets warning and watch alerts interrupt other panels", () => {
    const decision = choosePanel({
      panels: [panel("forecast", 40, "forecast"), panel("warning", 100, "nws-alert", true)],
      now,
      state: defaultSchedulerState(),
    });
    expect(decision.selectedPanelId).toBe("warning");
    expect(decision.reason).toBe("Critical alert interrupt");
  });

  it("rotates advisory above forecast but below live games", () => {
    const advisoryDecision = choosePanel({
      panels: [panel("forecast", 40, "forecast"), panel("advisory", 70, "nws-alert")],
      now,
      state: defaultSchedulerState(),
    });
    expect(advisoryDecision.selectedPanelId).toBe("advisory");

    const liveDecision = choosePanel({
      panels: [panel("advisory", 70, "nws-alert"), panel("live", 85, "live-score")],
      now,
      state: defaultSchedulerState(),
    });
    expect(liveDecision.selectedPanelId).toBe("live");
  });

  it("filters expired panels", () => {
    const expired = panel("old", 100, "forecast");
    expired.expiresAt = "2026-06-28T11:59:59.000Z";
    const decision = choosePanel({ panels: [expired, panel("clock", 0, "clock")], now, state: defaultSchedulerState() });
    expect(decision.selectedPanelId).toBe("clock");
    expect(decision.skipped).toContainEqual({ panelId: "old", reason: "TTL expired" });
  });

  it("honors snooze for non-critical panels", () => {
    const state = snoozeUntil(defaultSchedulerState(), new Date("2026-06-28T12:15:00.000Z"));
    const decision = choosePanel({
      panels: [panel("forecast", 40, "forecast"), panel("clock", 0, "clock")],
      now,
      state,
    });
    expect(decision.selectedPanelId).toBe("clock");
    expect(decision.skipped).toContainEqual({ panelId: "forecast", reason: "Snoozed" });
  });

  it("uses quiet hours for non-critical panels and lets critical alerts through", () => {
    const state = defaultSchedulerState({ start: "22:00", end: "06:00" });
    const decision = choosePanel({
      panels: [panel("forecast", 40, "forecast"), panel("warning", 100, "nws-alert", true), panel("clock", 0, "clock")],
      now: new Date("2026-06-28T04:00:00.000Z"),
      timeZone: "UTC",
      state,
    });
    expect(decision.selectedPanelId).toBe("warning");
  });

  it("allows manual push to force a selected unexpired panel", () => {
    const decision = choosePanel({
      panels: [panel("clock", 0, "clock"), panel("forecast", 40, "forecast")],
      now,
      state: defaultSchedulerState(),
      manualPanelId: "clock",
    });
    expect(decision.selectedPanelId).toBe("clock");
    expect(decision.reason).toBe("Manual push requested");
  });
});

function panel(id: string, priority: number, kind: Panel["kind"], critical = false): Panel {
  return {
    id,
    kind,
    source: kind === "live-score" ? "sports" : kind === "clock" ? "clock" : "nws",
    title: id,
    priority,
    createdAt: "2026-06-28T12:00:00.000Z",
    ttlSeconds: 60,
    expiresAt: "2026-06-28T12:01:00.000Z",
    critical,
    payload: {},
  };
}
