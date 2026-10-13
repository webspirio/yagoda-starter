import { describe, it, expect } from 'vitest';
import type { TFunction } from 'i18next';
import type { IntakeDetail } from '@/entities/intake';
import { buildIntakeReceipt } from './buildIntakeReceipt';

// Keys echo back with their params, so the test pins WHICH string was chosen
// without depending on a locale.
const t = ((key: string, opts?: Record<string, unknown>) =>
  opts ? `${key}${JSON.stringify(opts)}` : key) as unknown as TFunction;

function item(id: string, over: Partial<IntakeDetail['items'][number]> = {}): IntakeDetail['items'][number] {
  return {
    id,
    item_order: 1,
    product_grade_id: 'grade-1',
    product_name: 'Малина',
    grade_name: '1 сорт',
    gross_kg: '126.40',
    pallet_kg: '0.00',
    tare_weight_kg: '14.40',
    net_kg: '112.00',
    price: '135.00',
    bonus: '-5.00',
    amount: '14560.00',
    tare: [{ tare_type_id: 'tare-1', units: 12 }],
    ...over,
  };
}

function intake(over: Partial<IntakeDetail> = {}): IntakeDetail {
  return {
    id: 'intake-1',
    code: 'SHP-IN-20260908-00412',
    shift_id: 'shift-1',
    collection_point_id: 'point-1',
    business_date: '2026-09-08',
    supplier_id: 'supplier-1',
    amount: '29120.00',
    received_by_user_id: 'user-1',
    voided_at: null,
    voided_by_user_id: null,
    void_reason: null,
    shift_closed: false,
    created_at: '2026-09-08T08:20:00.000Z',
    net_kg: '224.00',
    lines_count: 2,
    supplier_name: 'Ніна Ільчук',
    paid_amount: '0.00',
    open_amount: '0.00',
    payouts: [],
    received_by_name: 'Тарас Бондар',
    received_by: { first_name: 'Тарас', last_name: 'Бондар' },
    crate_return: null,
    items: [item('item-1'), item('item-2')],
    ...over,
  };
}

function build(i: IntakeDetail) {
  return buildIntakeReceipt({
    intake: i,
    supplierName: 'Галина Кушнірук',
    pointName: 'Пункт 1',
    tareNameById: new Map([['tare-1', 'Ящик']]),
    note: null,
    balance: '9000.00',
    t,
    locale: 'en',
  });
}

describe('buildIntakeReceipt', () => {
  it('puts the point and the staff name in the header', () => {
    expect(build(intake()).header).toEqual({ pointName: 'Пункт 1', staffName: 'Бондар Тарас' });
  });

  it('prints a dash for staff when the receiver is unknown', () => {
    expect(build(intake({ received_by: null })).header.staffName).toBe('—');
  });

  it('fills the meta rows: code, operation, date, supplier', () => {
    const { meta } = build(intake());
    expect(meta.map((r) => r.label)).toEqual([
      'receipt.number',
      'receipt.operation',
      'receipt.date',
      'receipt.supplier',
    ]);
    expect(meta[0].value).toBe('SHP-IN-20260908-00412');
    expect(meta[1].value).toBe('receipt.operationIntake');
    expect(meta[3].value).toBe('Галина Кушнірук');
  });

  it('makes one berry group per item, then the totals group', () => {
    const { sections } = build(intake());
    expect(sections).toHaveLength(3);
    expect(sections[0]).toHaveLength(1);
    expect(sections[0][0]).toMatchObject({
      kind: 'berryLine',
      line: { label: 'Малина', net: '112.00 kg', price: '130.00 ₴', pallet: null, tareLabel: '12 × Ящик' },
    });
    expect(sections[1][0].kind).toBe('berryLine');
  });

  it('shows the pallet only when non-zero', () => {
    const { sections } = build(intake({ items: [item('a', { pallet_kg: '2.00' })] }));
    expect(sections[0][0]).toMatchObject({ line: { pallet: '2.00 kg' } });
  });

  it('adds no crate group without a crate return', () => {
    const { sections } = build(intake());
    expect(sections.flat().some((s) => s.kind === 'rows' && s.rows.some((r) => r.label.includes('rateReturn')))).toBe(false);
  });

  it('prints the voided crate return as its annulment caption', () => {
    const { sections } = build(
      intake({
        crate_return: {
          units: 3,
          deposit_refund: '30.00',
          voided_at: '2026-09-08T10:00:00.000Z',
        } as IntakeDetail['crate_return'],
      }),
    );
    expect(sections).toHaveLength(4);
    expect(sections[2]).toEqual([
      { kind: 'rows', rows: [{ label: 'receipt.crateReturnVoided', value: '', muted: true }] },
    ]);
  });

  it('prints a live crate return as a normal, unmuted row', () => {
    const { sections } = build(
      intake({
        crate_return: { units: 3, deposit_refund: '30.00', voided_at: null } as IntakeDetail['crate_return'],
      }),
    );
    expect(sections[2]).toHaveLength(1);
    expect(sections[2][0]).toMatchObject({ kind: 'rows', rows: [{ value: '' }] });
    const row = (sections[2][0] as { rows: { label: string; muted?: boolean }[] }).rows[0];
    expect(row.label).toBe('receipt.crateReturn{"units":3,"amount":"30.00 ₴"}');
    expect(row.muted).toBeUndefined();
  });

  it('prints a no-money crate return as a normal, unmuted row', () => {
    const { sections } = build(
      intake({
        crate_return: { units: 3, deposit_refund: '0.00', voided_at: null } as IntakeDetail['crate_return'],
      }),
    );
    const row = (sections[2][0] as { rows: { label: string; muted?: boolean }[] }).rows[0];
    expect(sections[2][0].kind).toBe('rows');
    expect(row.label).toBe('receipt.crateReturnNoMoney{"units":3}');
    expect(row.muted).toBeUndefined();
  });

  it('omits «Видано готівкою» when nothing was paid', () => {
    const totals = (sections => sections[sections.length - 1])(build(intake()).sections);
    const labels = totals.flatMap((s) => (s.kind === 'rows' ? s.rows.map((r) => r.label) : []));
    expect(labels).toEqual(['receipt.accrued', 'receipt.balanceAtPoint']);
  });

  it('totals: accrued, paid, live codes, voided annulments, live balance', () => {
    const all = build(
      intake({
        paid_amount: '10000.00',
        payouts: [
          { id: 'p1', code: 'PO-1', amount: '6000.00', created_at: '', voided_at: null },
          { id: 'p2', code: 'PO-2', amount: '4000.00', created_at: '', voided_at: null },
          { id: 'p3', code: 'PO-3', amount: '1.00', created_at: '', voided_at: '2026-09-08T10:00:00.000Z' },
        ],
      }),
    ).sections;
    const totals = all[all.length - 1];
    expect(totals).toEqual([
      { kind: 'rows', rows: [{ label: 'receipt.accrued', value: '29,120.00 ₴', strong: true }] },
      { kind: 'rows', rows: [{ label: 'receipt.paid', value: '10,000.00 ₴' }] },
      { kind: 'caption', text: 'PO-1, PO-2' },
      { kind: 'caption', text: 'receipt.payoutVoided{"code":"PO-3"}' },
      { kind: 'rows', rows: [{ label: 'receipt.balanceAtPoint', value: '9,000.00 ₴' }] },
    ]);
  });

  it('carries the void stamp and the note through', () => {
    const doc = buildIntakeReceipt({
      intake: intake({ voided_at: '2026-09-08T10:00:00.000Z', void_reason: 'Помилка' }),
      supplierName: 'X',
      pointName: 'P',
      tareNameById: new Map(),
      note: 'Дякуємо',
      balance: '0.00',
      t,
      locale: 'en',
    });
    expect(doc.voided).toEqual({ reason: 'Помилка' });
    expect(doc.footer).toEqual({ note: 'Дякуємо' });
  });
});
