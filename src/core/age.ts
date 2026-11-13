/** Calendar arithmetic uses the configured local date, never elapsed 24-hour blocks. */
export function validBirthDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value && date.getUTCFullYear() >= 1900;
}

export function calendarAge(birthDate: string, now: Date, timeZone: string) {
  if (!validBirthDate(birthDate)) return null;
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const number = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)!.value);
  const today = Date.UTC(number("year"), number("month") - 1, number("day"));
  const birth = new Date(`${birthDate}T00:00:00Z`);
  if (today < birth.getTime()) return null;
  const anniversary = (months: number) => {
    const first = new Date(Date.UTC(birth.getUTCFullYear(), birth.getUTCMonth() + months, 1));
    const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
    return Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(birth.getUTCDate(), lastDay));
  };
  let totalMonths = (number("year") - birth.getUTCFullYear()) * 12 + number("month") - 1 - birth.getUTCMonth();
  if (anniversary(totalMonths) > today) totalMonths--;
  const totalDays = Math.round((today - birth.getTime()) / 86400_000);
  return { years: Math.floor(totalMonths / 12), months: totalMonths % 12,
    days: Math.round((today - anniversary(totalMonths)) / 86400_000), totalMonths, totalDays,
    weeks: Math.floor(totalDays / 7), weekDays: totalDays % 7 };
}
