import { PointCashBreakdownRow, toPointCashBreakdown } from './point-cash.mapper';

const row = (over: Partial<PointCashBreakdownRow>): PointCashBreakdownRow => ({
  cash: '0.00',
  anchor_kind: null,
  anchor_date: null,
  same_day: null,
  opening: null,
  transfers_in: null,
  payouts: null,
  returns: null,
  counted: null,
  expected: null,
  difference: null,
  late_change: null,
  ...over,
});

const terms = {
  opening: '21820.00',
  transfers_in: '35000.00',
  payouts: '13000.00',
  returns: '0.00',
};

describe('toPointCashBreakdown', () => {
  it('none — no anchor at all', () => {
    expect(toPointCashBreakdown(row({}))).toEqual({
      kind: 'none',
      anchor_date: null,
      opening: null,
      transfers_in: null,
      payouts: null,
      returns: null,
      closing: null,
    });
  });

  it('open — an opening anchor carries the terms and no closing, whatever its date', () => {
    expect(
      toPointCashBreakdown(
        row({
          anchor_kind: 'opening',
          anchor_date: '2026-09-20',
          same_day: false,
          ...terms,
          counted: '21820.00',
        }),
      ),
    ).toEqual({ kind: 'open', anchor_date: '2026-09-20', ...terms, closing: null });
  });

  it('closed — a closing anchor on the same day carries everything', () => {
    expect(
      toPointCashBreakdown(
        row({
          anchor_kind: 'closing',
          anchor_date: '2026-09-22',
          same_day: true,
          ...terms,
          counted: '43730.00',
          expected: '43820.00',
          difference: '-90.00',
          late_change: '0.00',
        }),
      ),
    ).toEqual({
      kind: 'closed',
      anchor_date: '2026-09-22',
      ...terms,
      closing: {
        counted: '43730.00',
        expected: '43820.00',
        difference: '-90.00',
        late_change: '0.00',
      },
    });
  });

  it('carried — a closing anchor from an earlier day keeps only the counted figure', () => {
    expect(
      toPointCashBreakdown(
        row({
          anchor_kind: 'closing',
          anchor_date: '2026-09-22',
          same_day: false,
          ...terms,
          counted: '43730.00',
          expected: '43820.00',
          difference: '-90.00',
          late_change: '0.00',
        }),
      ),
    ).toEqual({
      kind: 'carried',
      anchor_date: '2026-09-22',
      opening: null,
      transfers_in: null,
      payouts: null,
      returns: null,
      closing: { counted: '43730.00', expected: null, difference: null, late_change: null },
    });
  });
});
