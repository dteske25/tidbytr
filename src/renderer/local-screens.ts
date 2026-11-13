import type { ChildProfile } from "../core/types.js";
import { calendarAge } from "../core/age.js";

export function clockDisplay(now: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: timezone }).formatToParts(now);
  const time = `${parts.find((part) => part.type === "hour")!.value}:${parts.find((part) => part.type === "minute")!.value}`;
  return { time, blinkTime: time.replace(":", " "), period: parts.find((part) => part.type === "dayPeriod")!.value,
    timeX: Math.floor((64 - time.length * 10) / 2),
    date: new Intl.DateTimeFormat("en-US", { month: "short", day: "2-digit", timeZone: timezone }).format(now).toUpperCase().replace(",", "") };
}

export const CHILD_STYLES = {
  boy: { accent: "#85C7F2", secondaryColor: "#A8C4DB" },
  girl: { accent: "#F5AAC5", secondaryColor: "#D4B3C4" },
  neutral: { accent: "#A8D8BE", secondaryColor: "#B4C9BF" },
} as const;

export function babyAgeDisplay(birthDate: string, name: string, now: Date, timezone: string, style: ChildProfile["style"] = "neutral") {
  const colors = CHILD_STYLES[style] ?? CHILD_STYLES.neutral;
  const age = calendarAge(birthDate, now, timezone);
  const label = name.trim().toUpperCase().replace(/[^A-Z0-9 -]/g, "").slice(0, 12) || "BABY";
  if (!age) return { ...colors, name: label, primary: "--", secondary: "SET BIRTH DATE", primaryX: 26 };
  const primary = age.totalMonths === 0 ? `${age.totalDays} DAY${age.totalDays === 1 ? "" : "S"}`
    : age.years === 0 ? `${age.months}M ${age.days}D` : `${age.years}Y ${age.months}M`;
  const secondary = age.years > 0 ? `${age.days} DAY${age.days === 1 ? "" : "S"}`
    : `${age.weeks} WEEK${age.weeks === 1 ? "" : "S"} OLD`;
  return { ...colors, name: label, primary, secondary, primaryX: Math.floor((64 - primary.length * 6) / 2) };
}
