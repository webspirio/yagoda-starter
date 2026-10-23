import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { JournalTotalsQueryDto } from './journal-totals.query';

const POINT = 'a3c1f1e2-5b6d-4e7f-8a9b-0c1d2e3f4a5b';
const parse = (q: Record<string, unknown>) =>
  validateSync(plainToInstance(JournalTotalsQueryDto, q));

describe('JournalTotalsQueryDto', () => {
  it('accepts a range with optional point and supplier', () => {
    expect(parse({ from: '2026-10-01', to: '2026-10-31' })).toHaveLength(0);
    expect(
      parse({ from: '2026-10-01', to: '2026-10-31', collection_point_id: POINT, supplier_id: POINT }),
    ).toHaveLength(0);
  });

  it('accepts a one-day range', () => {
    expect(parse({ from: '2026-10-05', to: '2026-10-05' })).toHaveLength(0);
  });

  it('requires both bounds — an open range would sum the whole season', () => {
    expect(parse({ from: '2026-10-01' }).map((e) => e.property)).toEqual(['to']);
    // A missing `from` is reported as missing, not as an inverted range.
    const [error, ...rest] = parse({ to: '2026-10-31' });
    expect(rest).toHaveLength(0);
    expect(error.property).toBe('from');
  });

  it('refuses a malformed date', () => {
    expect(parse({ from: '2026-10-1', to: '2026-10-31' })).not.toHaveLength(0);
  });

  it('refuses a well-formed date that is not on the calendar — Postgres would answer it with a 500', () => {
    expect(parse({ from: '2026-02-30', to: '2026-03-01' }).map((e) => e.property)).toEqual([
      'from',
    ]);
    expect(parse({ from: '2026-02-01', to: '2026-02-29' }).map((e) => e.property)).toEqual(['to']);
    // A leap day is on the calendar.
    expect(parse({ from: '2028-02-29', to: '2028-03-01' })).toHaveLength(0);
  });

  it('refuses an inverted range', () => {
    const errors = parse({ from: '2026-10-31', to: '2026-10-01' });
    expect(errors.map((e) => e.property)).toEqual(['to']);
  });
});
