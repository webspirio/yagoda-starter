import { describe, it, expect } from 'vitest';
import type { TFunction } from 'i18next';
import type { Payout } from '@/entities/payout';
import { formatUah } from '@/shared/lib/money';
import { formatLongDate, formatTime } from '@/shared/lib/date';
import { buildPayoutReceipt } from './buildPayoutReceipt';

const t = ((key: string, opts?: Record<string, unknown>) =>
  opts ? `${key}${JSON.stringify(opts)}` : key) as unknown as TFunction;

function payout(over: Partial<Payout> = {}): Payout {
  return {
    id: 'payout-1',
    code: 'SHP-PO-20260908-00031',
    shift_id: 'shift-1',
    collection_point_id: 'point-1',
    business_date: '2026-09-08',
    supplier_id: 'supplier-1',
    amount: '5000.00',
    paid_by_user_id: 'user-1',
    intake_id: null,
    voided_at: null,
    voided_by_user_id: null,
    void_reason: null,
    return_settled_at: null,
    return_settled_by_user_id: null,
    return_note: null,
    returned_on_void: false,
    shift_closed: false,
    created_at: '2026-09-08T08:20:00.000Z',
    balance_after: '9000.00',
    paid_by: { first_name: 'Тарас', last_name: 'Бондар', number: 5 },
    ...over,
  };
}

function build(p: Payout, note: string | null = null) {
  return buildPayoutReceipt({
    payout: p,
    supplierName: 'Ніна Ільчук',
    pointNumber: 3,
    note,
    t,
    locale: 'uk',
  });
}

describe('buildPayoutReceipt', () => {
  it('puts the point number and the payer number in the header, not their names', () => {
    expect(build(payout()).header).toEqual({
      point: 'receipt.headerPoint{"number":3}',
      staff: 'receipt.headerStaff{"number":5}',
    });
  });

  it('lists meta in order: number, operation, date, supplier', () => {
    const doc = build(payout());
    expect(doc.meta.map((r) => r.label)).toEqual([
      'receipt.number',
      'receipt.operation',
      'receipt.date',
      'receipt.supplier',
    ]);
    expect(doc.meta[0].value).toBe('SHP-PO-20260908-00031');
    expect(doc.meta[1].value).toBe('receipt.operationPayoutDebt');
    expect(doc.meta[3].value).toBe('Ніна Ільчук');
  });

  it('«Дата» is the business date and the created_at time, even just past local midnight', () => {
    // 00:05 local on the 8th, but the shift (business) day is the 7th.
    const created_at = new Date(2026, 8, 8, 0, 5).toISOString();
    const { meta } = build(payout({ business_date: '2026-09-07', created_at }));
    expect(meta[2].value).toBe(`${formatLongDate('2026-09-07', 'uk')} · ${formatTime(created_at, 'uk')}`);
    expect(meta[2].value).not.toContain(formatLongDate('2026-09-08', 'uk'));
  });

  it('prints cash paid (strong) and the balance after as one totals group', () => {
    const doc = build(payout());
    expect(doc.sections).toHaveLength(1);
    expect(doc.sections[0]).toEqual([
      {
        kind: 'rows',
        rows: [{ label: 'receipt.paid', value: formatUah('5000.00', 'uk'), strong: true }],
      },
      {
        kind: 'rows',
        rows: [{ label: 'receipt.balanceAfterPayout', value: formatUah('9000.00', 'uk') }],
      },
    ]);
  });

  it('prints a negative balance_after with its minus', () => {
    const doc = build(payout({ balance_after: '-100.00' }));
    const last = doc.sections[0][1];
    expect(last.kind === 'rows' && last.rows[0].value).toMatch(/^[-−]100,00\s?₴$/u);
  });

  it('is not voided by default and stamps a voided payout with its reason', () => {
    expect(build(payout()).voided).toBeNull();
    expect(
      build(payout({ voided_at: '2026-09-08T10:00:00Z', void_reason: 'помилка' })).voided,
    ).toEqual({ reason: 'помилка' });
  });

  it('carries the footer note', () => {
    expect(build(payout(), 'Дякуємо').footer).toEqual({ note: 'Дякуємо' });
  });

  it('prints a dash for a payout whose payer is unknown', () => {
    expect(build(payout({ paid_by: null })).header.staff).toBe('—');
  });
});
