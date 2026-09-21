import { ROW_EXTRAS_SQL, rowExtrasSelects, type IntakeRowExtras } from './intake-row-extras';

describe('intake row extras SQL', () => {
  it('names the four columns every consumer maps by', () => {
    const selects = rowExtrasSelects('i', 'sup');
    expect(selects.map((s) => s.alias)).toEqual([
      'net_kg',
      'lines_count',
      'paid_amount',
      'supplier_name',
    ]);
    // Every numeric leaves Postgres as text — never a JS number (§5.1).
    expect(selects.find((s) => s.alias === 'net_kg')?.sql).toContain('::text');
    expect(selects.find((s) => s.alias === 'paid_amount')?.sql).toContain('::text');
    expect(selects.find((s) => s.alias === 'paid_amount')?.sql).toContain('voided_at IS NULL');
  });

  it('the one-row query selects the same aliases', () => {
    for (const alias of ['net_kg', 'lines_count', 'paid_amount', 'supplier_name']) {
      expect(ROW_EXTRAS_SQL).toContain(`AS ${alias}`);
    }
    const shape: IntakeRowExtras = {
      net_kg: '36.90',
      lines_count: 2,
      supplier_name: 'Іван Коваль',
      paid_amount: '0.00',
    };
    expect(shape.lines_count).toBe(2);
  });
});
