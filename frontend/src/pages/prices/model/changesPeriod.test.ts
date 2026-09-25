import { describe, it, expect } from 'vitest';
import {
  MAX_CHANGES_DAYS,
  groupByLocalDay,
  periodOfPreset,
  presetOf,
  readPeriod,
  withFrom,
  withTo,
} from './changesPeriod';

const TODAY = '2026-09-25';

describe('readPeriod', () => {
  it('reads an absent period as «the server picks today»', () => {
    expect(readPeriod(null, null)).toEqual({ from: null, to: null });
  });

  it('keeps a well-formed period', () => {
    expect(readPeriod('2026-09-20', '2026-09-24')).toEqual({
      from: '2026-09-20',
      to: '2026-09-24',
    });
  });

  /* A shared link must render a list, never the backend's 400. */
  it.each([
    ['garbage', null],
    ['2026-02-30', null],
    ['2026-09-24', '2026-09-20'],
    ['2026-01-01', '2026-02-01'],
  ])('falls back to today for %o → %o', (from, to) => {
    expect(readPeriod(from, to)).toEqual({ from: null, to: null });
  });

  it(`accepts exactly ${MAX_CHANGES_DAYS} days`, () => {
    expect(readPeriod('2026-01-01', '2026-01-31')).toEqual({
      from: '2026-01-01',
      to: '2026-01-31',
    });
  });
});

describe('presets', () => {
  it('maps each preset to its period and back', () => {
    for (const preset of ['today', 'yesterday', 'week'] as const) {
      expect(presetOf(periodOfPreset(preset, TODAY), TODAY)).toBe(preset);
    }
  });

  it('spells «today» as no period, so the server keeps choosing the day', () => {
    expect(periodOfPreset('today', TODAY)).toEqual({ from: null, to: null });
  });

  it('makes «7 days» seven days ending today', () => {
    expect(periodOfPreset('week', TODAY)).toEqual({ from: '2026-09-19', to: null });
  });

  it('names no preset for a hand-picked period', () => {
    expect(presetOf({ from: '2026-09-01', to: '2026-09-03' }, TODAY)).toBeNull();
  });
});

describe('editing one bound', () => {
  it('drags `to` along when `from` moves past it', () => {
    expect(withFrom({ from: null, to: '2026-09-10' }, '2026-09-12', TODAY)).toEqual({
      from: '2026-09-12',
      to: '2026-09-12',
    });
  });

  it('drags `from` along when `to` moves before it', () => {
    expect(withTo({ from: '2026-09-12', to: null }, '2026-09-10', TODAY)).toEqual({
      from: '2026-09-10',
      to: '2026-09-10',
    });
  });

  it(`keeps the period within ${MAX_CHANGES_DAYS} days`, () => {
    expect(withFrom({ from: null, to: null }, '2026-07-01', TODAY)).toEqual({
      from: '2026-07-01',
      to: '2026-07-31',
    });
    expect(withTo({ from: '2026-07-01', to: '2026-07-01' }, '2026-09-25', TODAY)).toEqual({
      from: '2026-08-26',
      to: '2026-09-25',
    });
  });

  it('reads an absent bound as today', () => {
    expect(withFrom({ from: null, to: null }, '2026-09-20', TODAY)).toEqual({
      from: '2026-09-20',
      to: TODAY,
    });
  });
});

describe('groupByLocalDay', () => {
  it('groups consecutive rows by the viewer’s local date, keeping their order', () => {
    const at = (h: number, day: number) => new Date(2026, 8, day, h).toISOString();
    const rows = [
      { id: 'a', created_at: at(18, 24) },
      { id: 'b', created_at: at(9, 24) },
      { id: 'c', created_at: at(20, 23) },
    ];
    expect(groupByLocalDay(rows)).toEqual([
      { date: '2026-09-24', rows: [rows[0], rows[1]] },
      { date: '2026-09-23', rows: [rows[2]] },
    ]);
  });
});
