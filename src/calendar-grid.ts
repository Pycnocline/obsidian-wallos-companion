export interface CalendarCell {
  date: string;
  day: number;
  inMonth: boolean;
  week: number;
}

/** A Monday/Sunday aligned month calendar, including trailing leading dates. */
export function calendarGrid(year: number, month: number, startSunday: boolean): CalendarCell[] {
  if (!Number.isInteger(year) || year < 1970 || year > 9998 ||
      !Number.isInteger(month) || month < 1 || month > 12) return [];
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const offset = startSunday ? firstWeekday : (firstWeekday + 6) % 7;
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const totalCells = Math.max(35, Math.ceil((offset + days) / 7) * 7);
  const result: CalendarCell[] = [];
  for (let i = 0; i < totalCells; i++) {
    const utc = new Date(Date.UTC(year, month - 1, 1 + i - offset));
    result.push({
      date: utc.toISOString().slice(0, 10),
      day: utc.getUTCDate(),
      inMonth: utc.getUTCMonth() === month - 1 && utc.getUTCFullYear() === year,
      week: Math.floor(i / 7),
    });
  }
  return result;
}
