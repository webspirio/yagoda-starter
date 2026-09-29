import { ROW_EXTRAS_SQL, rowExtrasSelects, type IntakeRowExtras } from './intake-row-extras';

describe('intake row extras SQL', () => {
  it('names the five columns every consumer maps by', () => {
    const selects = rowExtrasSelects('i', 'sup');
    expect(selects.map((s) => s.alias)).toEqual([
      'net_kg',
      'lines_count',
      'paid_amount',
      'open_amount',
      'supplier_name',
    ]);
    // Every numeric leaves Postgres as text — never a JS number (§5.1).
    expect(selects.find((s) => s.alias === 'net_kg')?.sql).toContain('::text');
    expect(selects.find((s) => s.alias === 'paid_amount')?.sql).toContain('::text');
    expect(selects.find((s) => s.alias === 'paid_amount')?.sql).toContain('voided_at IS NULL');
    // COALESCE must wrap the ::text cast, not the number: COALESCE(SUM(x), 0)
    // is an integer zero and Postgres renders it '0', not '0.00' — the exact
    // trap `supplier-balance.service.ts` already documents and dodges.
    expect(selects.find((s) => s.alias === 'net_kg')?.sql).toContain("::text, '0.00')");
    expect(selects.find((s) => s.alias === 'paid_amount')?.sql).toContain("::text, '0.00')");
    // The sibling constraints each select carries, so a future edit that
    // loosens one of them fails here instead of silently at the page.
    expect(selects.find((s) => s.alias === 'lines_count')?.sql).toContain('COUNT(ii.id)');
    expect(selects.find((s) => s.alias === 'paid_amount')?.sql).toContain('p.intake_id = i.id');
    expect(selects.find((s) => s.alias === 'supplier_name')?.sql).toContain('btrim(');
    // open_amount reads live allocations of the receipt AND of its live top-ups.
    const open = selects.find((s) => s.alias === 'open_amount')?.sql ?? '';
    expect(open).toContain('payout_allocations');
    expect(open).toContain('a.intake_top_up_id = t.id');
    expect(open).toContain('t.voided_at IS NULL');
    expect(open).toContain("'0.00'");
  });

  it('the one-row query selects the same aliases', () => {
    for (const alias of ['net_kg', 'lines_count', 'paid_amount', 'open_amount', 'supplier_name']) {
      expect(ROW_EXTRAS_SQL).toContain(`AS ${alias}`);
    }
    const shape: IntakeRowExtras = {
      net_kg: '36.90',
      lines_count: 2,
      supplier_name: 'Іван Коваль',
      paid_amount: '0.00',
      open_amount: '0.00',
    };
    expect(shape.lines_count).toBe(2);
  });
});
