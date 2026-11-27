import { afterEach, describe, expect, it } from 'vitest';
import { dateForDay, dateKeyForDay, dayNumberFor, localDateKey, msUntilNextDay } from '../src/game/daily';

// Node re-reads process.env.TZ whenever it is assigned, so one run can visit
// many zones. Santiago and Havana skip midnight itself when their clocks go
// forward; Lord Howe moves by half an hour; Kiritimati and Pago Pago sit 25
// hours apart either side of the date line.
const ZONES = [
  'UTC',
  'Pacific/Auckland',
  'America/Los_Angeles',
  'America/Santiago',
  'America/Havana',
  'Australia/Lord_Howe',
  'Pacific/Kiritimati',
  'Pacific/Pago_Pago',
  'Asia/Kathmandu',
  'Europe/London',
];
const HOUR = 3_600_000;
// The project has no Node types, so reach process.env through globalThis.
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
const original = env.TZ;

function inZone(tz: string, fn: () => void) {
  env.TZ = tz;
  fn();
}

afterEach(() => {
  if (original === undefined) delete env.TZ;
  else env.TZ = original;
});

describe('days in every time zone', () => {
  it('starts day 1 at local midnight on 27 November 2026', () => {
    for (const tz of ZONES) {
      inZone(tz, () => {
        const start = new Date(2026, 10, 27);
        expect(dayNumberFor(start), tz).toBe(1);
        expect(dayNumberFor(new Date(start.getTime() - 1)), tz).toBe(0);
        expect(dayNumberFor(new Date(2026, 10, 27, 23, 59, 59, 999)), tz).toBe(1);
        expect(dayNumberFor(new Date(2026, 10, 28)), tz).toBe(2);
      });
    }
  });

  it('maps every day to its own local date and back, for three years', () => {
    for (const tz of ZONES) {
      inZone(tz, () => {
        for (let day = 1; day <= 1100; day++) {
          const start = dateForDay(day);
          expect(dayNumberFor(start), `${tz} day ${day}`).toBe(day);
          expect(localDateKey(start), `${tz} day ${day}`).toBe(dateKeyForDay(day));
          // dateForDay is the first instant of the day, even where midnight does not exist.
          expect(dayNumberFor(new Date(start.getTime() - 1)), `${tz} day ${day}`).toBe(day - 1);
        }
      });
    }
  });

  it('counts down to the first instant of the next day, through every clock change of 2027', () => {
    for (const tz of ZONES) {
      inZone(tz, () => {
        const from = new Date(2027, 0, 1).getTime();
        const to = new Date(2028, 0, 1).getTime();
        // An odd step, so samples fall at every time of day across the year.
        for (let t = from; t < to; t += 7 * HOUR + 13 * 60_000 + 7_000) {
          const now = new Date(t);
          const ms = msUntilNextDay(now);
          expect(ms, `${tz} ${now.toString()}`).toBeGreaterThan(0);
          expect(ms, `${tz} ${now.toString()}`).toBeLessThanOrEqual(25 * HOUR);
          expect(dayNumberFor(new Date(t + ms)), `${tz} ${now.toString()}`).toBe(dayNumberFor(now) + 1);
          expect(dayNumberFor(new Date(t + ms - 1)), `${tz} ${now.toString()}`).toBe(dayNumberFor(now));
        }
      });
    }
  });

  it('knows the short and long days', () => {
    const length = (y: number, m: number, d: number) => msUntilNextDay(dateForDay(dayNumberFor(new Date(y, m, d))));
    inZone('America/Los_Angeles', () => {
      expect(length(2027, 2, 14)).toBe(23 * HOUR);
      expect(length(2027, 10, 7)).toBe(25 * HOUR);
      expect(length(2027, 5, 1)).toBe(24 * HOUR);
    });
    inZone('Pacific/Auckland', () => {
      expect(length(2027, 3, 4)).toBe(25 * HOUR);
      expect(length(2027, 8, 26)).toBe(23 * HOUR);
    });
    inZone('Australia/Lord_Howe', () => {
      expect(length(2027, 3, 4)).toBe(24.5 * HOUR);
      expect(length(2027, 9, 3)).toBe(23.5 * HOUR);
    });
    inZone('America/Santiago', () => {
      // Clocks jump from 23:59:59 to 01:00 on 5 September 2027: that day starts at 01:00.
      const start = dateForDay(dayNumberFor(new Date(2027, 8, 5, 12)));
      expect(start.getHours()).toBe(1);
      expect(localDateKey(start)).toBe('2027-09-05');
      expect(msUntilNextDay(new Date(2027, 8, 4, 23, 59, 59))).toBe(1000);
    });
  });

  it('reaches Auckland and Kiritimati before Los Angeles and Pago Pago', () => {
    const instant = new Date(Date.UTC(2026, 10, 27, 11, 0));
    const dayIn = (tz: string) => {
      let d = 0;
      inZone(tz, () => (d = dayNumberFor(instant)));
      return d;
    };
    expect(dayIn('Pacific/Kiritimati')).toBe(2);
    expect(dayIn('Pacific/Auckland')).toBe(2);
    expect(dayIn('UTC')).toBe(1);
    expect(dayIn('America/Los_Angeles')).toBe(1);
    expect(dayIn('Pacific/Pago_Pago')).toBe(1);
  });
});
