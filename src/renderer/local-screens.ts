import { calendarAge } from "../core/age.js";

export function clockDisplay(now: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: timezone }).formatToParts(now);
  const time = `${parts.find((part) => part.type === "hour")!.value}:${parts.find((part) => part.type === "minute")!.value}`;
  return { time, blinkTime: time.replace(":", " "), period: parts.find((part) => part.type === "dayPeriod")!.value,
    timeX: Math.floor((64 - time.length * 10) / 2),
    date: new Intl.DateTimeFormat("en-US", { month: "short", day: "2-digit", timeZone: timezone }).format(now).toUpperCase().replace(",", "") };
}

export function babyAgeDisplay(birthDate: string, name: string, now: Date, timezone: string) {
  const age = calendarAge(birthDate, now, timezone);
  const label = name.trim().toUpperCase().replace(/[^A-Z0-9 -]/g, "").slice(0, 12) || "BABY";
  if (!age) return { name: label, primary: "--", secondary: "SET BIRTH DATE", primaryX: 26 };
  const primary = age.totalMonths === 0 ? `${age.totalDays} DAY${age.totalDays === 1 ? "" : "S"}`
    : age.years === 0 ? `${age.months}M ${age.days}D` : `${age.years}Y ${age.months}M`;
  const secondary = age.years > 0 ? `${age.days} DAY${age.days === 1 ? "" : "S"}`
    : `${age.weeks} WEEK${age.weeks === 1 ? "" : "S"} OLD`;
  return { name: label, primary, secondary, primaryX: Math.floor((64 - primary.length * 6) / 2) };
}
