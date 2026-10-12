import { describe, expect, it } from 'vitest';
import { calendarGrid } from '../src/calendar-grid';

describe('continuous wallos month calendar', () => {
  it('always includes the final day and aligns Monday start', () => {
    const cells = calendarGrid(2026, 10, false);
    expect(cells.length % 7).toBe(0);
    expect(cells.length).toBeGreaterThanOrEqual(35);
    expect(cells.some(c => c.date === '2026-10-31' && c.inMonth)).toBe(true);
    expect(cells[0].date).toBe('2026-09-28');
    expect(cells[cells.length - 1].date).toBe('2026-11-01');
    expect(cells[0].week).toBe(0);
    expect(cells[7].week).toBe(1);
  });
  it('aligns Sunday start and includes leap day', () => {
    const cells = calendarGrid(2028, 2, true);
    expect(cells[0].date).toBe('2028-01-30');
    expect(cells.some(c => c.date === '2028-02-29' && c.inMonth)).toBe(true);
  });
  it('rejects invalid dates without overflow', () => {
    expect(calendarGrid(2026, 13, true)).toEqual([]);
    expect(calendarGrid(100000, 5, false)).toEqual([]);
  });
});
