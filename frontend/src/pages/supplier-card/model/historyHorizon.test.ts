import { describe, it, expect } from 'vitest';
import { historyHorizon, sinceHorizon } from './historyHorizon';

const at = (...createdAt: string[]) => createdAt.map((created_at) => ({ created_at }));

describe('historyHorizon (audit D3)', () => {
  it('is null when no list was cut — the history is the whole season', () => {
    expect(
      historyHorizon([
        { rows: at('2026-09-08T07:00:00Z', '2026-09-01T07:00:00Z'), truncated: false },
        { rows: at('2026-08-01T07:00:00Z'), truncated: false },
      ]),
    ).toBeNull();
  });

  it("is the cut list's oldest loaded row", () => {
    expect(
      historyHorizon([
        { rows: at('2026-09-08T07:00:00Z', '2026-09-05T07:00:00Z'), truncated: true },
        { rows: at('2026-09-01T07:00:00Z'), truncated: false },
      ]),
    ).toBe('2026-09-05T07:00:00Z');
  });

  it('is the NEWEST of the oldest-loaded rows when several lists were cut', () => {
    expect(
      historyHorizon([
        { rows: at('2026-09-08T07:00:00Z', '2026-09-05T07:00:00Z'), truncated: true },
        { rows: at('2026-09-08T09:00:00Z', '2026-09-06T09:00:00Z'), truncated: true },
      ]),
    ).toBe('2026-09-06T09:00:00Z');
  });

  it('ignores a cut list that loaded nothing', () => {
    expect(historyHorizon([{ rows: [], truncated: true }])).toBeNull();
  });
});

describe('sinceHorizon', () => {
  it('keeps every row with no horizon, and only rows at or after it otherwise', () => {
    const rows = at('2026-09-08T07:00:00Z', '2026-09-05T07:00:00Z', '2026-09-01T07:00:00Z');
    expect(sinceHorizon(rows, null)).toBe(rows);
    expect(sinceHorizon(rows, '2026-09-05T07:00:00Z')).toEqual(rows.slice(0, 2));
  });
});
