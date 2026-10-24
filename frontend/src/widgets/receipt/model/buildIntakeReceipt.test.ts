import { describe, it, expect } from 'vitest';
import type { TFunction } from 'i18next';
import type { IntakeDetail } from '@/entities/intake';
import { buildIntakeReceipt } from './buildIntakeReceipt';

// Keys echo back with their params, so the test pins WHICH string was chosen
// without depending on a locale.
const t = ((key: string, opts?: Record<string, unknown>) =>
  opts ? `${key}${JSON.stringify(opts)}` : key) as unknown as TFunction;

function item(
  id: string,
  over: Partial<IntakeDetail['items'][number]> = {},
): IntakeDetail['items'][number] {
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
    balance_after: '9000.00',
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
    received_by_number: 5,
    point_number: 3,
    crate_return: null,
    items: [item('item-1'), item('item-2')],
    ...over,
  };
}

function build(i: IntakeDetail) {
  return buildIntakeReceipt({
    intake: i,
    supplierName: 'Галина Кушнірук',
    tareNameById: new Map([
      ['tare-1', 'Ящик'],
      ['tare-2', 'Чешка'],
    ]),
    note: null,
    t,
    locale: 'en',
  });
}

const payout = (code: string, amount: string, voidedAt: string | null = null) => ({
  id: code,
  code,
  amount,
  created_at: '2026-09-08T08:20:00.000Z',
  voided_at: voidedAt,
});

describe('buildIntakeReceipt', () => {
  it('puts the point number and the receiver number in the header, not their names', () => {
    expect(build(intake()).header).toEqual({
      point: 'receipt.headerPoint{"number":3}',
      staff: 'receipt.headerStaff{"number":5}',
    });
  });

  it('prints a dash, never «№ undefined», when a response lacks the numbers', () => {
    const bare = intake();
    delete (bare as Partial<IntakeDetail>).point_number;
    delete (bare as Partial<IntakeDetail>).received_by_number;
    expect(build(bare).header).toEqual({ point: '—', staff: '—' });
  });

  it('prints a dash for staff when the receiver is unknown', () => {
    expect(build(intake({ received_by_number: null })).header.staff).toBe('—');
  });

  it('fills the meta rows: code, supplier — no date (#254), no «Операція» (client 23.10)', () => {
    const { meta } = build(intake());
    expect(meta.map((r) => r.label)).toEqual(['receipt.number', 'receipt.supplier']);
    expect(meta[0].value).toBe('SHP-IN-20260908-00412');
    expect(meta[1].value).toBe('Галина Кушнірук');
  });

  it('makes one berry group per item, then the totals group, then the tare tally', () => {
    const { sections } = build(intake());
    expect(sections).toHaveLength(4);
    expect(sections[0]).toHaveLength(1);
    expect(sections[0][0]).toMatchObject({
      kind: 'berryLine',
      line: {
        label: 'Малина',
        net: '112.00 kg',
        price: '130.00 ₴',
        pallet: null,
        tareLabel: '12 × Ящик',
      },
    });
    expect(sections[1][0].kind).toBe('berryLine');
  });

  it('shows the pallet only when non-zero', () => {
    const { sections } = build(intake({ items: [item('a', { pallet_kg: '2.00' })] }));
    expect(sections[0][0]).toMatchObject({ line: { pallet: '2.00 kg' } });
  });

  it('adds no crate group without a crate return', () => {
    const { sections } = build(intake());
    expect(
      sections
        .flat()
        .some((s) => s.kind === 'rows' && s.rows.some((r) => r.label.includes('rateReturn'))),
    ).toBe(false);
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
    expect(sections).toHaveLength(5);
    expect(sections[2]).toEqual([
      { kind: 'rows', rows: [{ label: 'receipt.crateReturnVoided', value: '', muted: true }] },
    ]);
  });

  it('prints a live crate return as a normal, unmuted row', () => {
    const { sections } = build(
      intake({
        crate_return: {
          units: 3,
          deposit_refund: '30.00',
          voided_at: null,
        } as IntakeDetail['crate_return'],
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
        crate_return: {
          units: 3,
          deposit_refund: '0.00',
          voided_at: null,
        } as IntakeDetail['crate_return'],
      }),
    );
    const row = (sections[2][0] as { rows: { label: string; muted?: boolean }[] }).rows[0];
    expect(sections[2][0].kind).toBe('rows');
    expect(row.label).toBe('receipt.crateReturnNoMoney{"units":3}');
    expect(row.muted).toBeUndefined();
  });

  // The agreed footer: Сума · Борг · Разом · Виплачено · Залишок, each a
  // calculator check of the ones before it.
  const totalsOf = (sections: ReturnType<typeof build>['sections']) =>
    sections[sections.length - 2];

  it('prints all five footer lines from the frozen balance_after, «Виплачено» as 0.00 when nothing was paid', () => {
    // Залишок 30 120 frozen after a 29 120 receipt with nothing paid: the
    // supplier walked in owed 1 000.
    const totals = totalsOf(build(intake({ balance_after: '30120.00' })).sections);
    expect(totals).toEqual([
      {
        kind: 'rows',
        rows: [
          { label: 'receipt.sum', value: '29,120.00 ₴' },
          { label: 'receipt.debt', value: '1,000.00 ₴' },
          { label: 'receipt.total', value: '30,120.00 ₴', strong: true },
          { label: 'receipt.paidOut', value: '0.00 ₴' },
        ],
      },
      { kind: 'rows', rows: [{ label: 'receipt.balance', value: '30,120.00 ₴', strong: true }] },
    ]);
  });

  it('prints «Борг» as 0.00 when nothing was owed before this receipt', () => {
    const totals = totalsOf(
      build(
        intake({
          balance_after: '0.00',
          paid_amount: '29120.00',
          payouts: [payout('PO-1', '29120.00')],
        }),
      ).sections,
    );
    const rows = totals.flatMap((s) => (s.kind === 'rows' ? s.rows : []));
    expect(rows.find((r) => r.label === 'receipt.debt')?.value).toBe('0.00 ₴');
    expect(rows.find((r) => r.label === 'receipt.total')?.value).toBe('29,120.00 ₴');
  });

  it('derives «Борг» = Залишок − Сума + Виплачено, with the live payout code under «Виплачено»', () => {
    const all = build(
      intake({
        balance_after: '20120.00',
        paid_amount: '10000.00',
        payouts: [payout('PO-1', '10000.00')],
      }),
    ).sections;
    expect(totalsOf(all)).toEqual([
      {
        kind: 'rows',
        rows: [
          { label: 'receipt.sum', value: '29,120.00 ₴' },
          // 20 120 + 10 000 − 29 120
          { label: 'receipt.debt', value: '1,000.00 ₴' },
          { label: 'receipt.total', value: '30,120.00 ₴', strong: true },
          { label: 'receipt.paidOut', value: '10,000.00 ₴' },
        ],
      },
      { kind: 'caption', text: 'PO-1' },
      { kind: 'rows', rows: [{ label: 'receipt.balance', value: '20,120.00 ₴', strong: true }] },
    ]);
  });

  // Audit 2026-10-24 A1: a reprint after the cash handed over with the receipt
  // was voided prints the SAME paper, plus the annulment line — `balance_after`
  // already subtracted that payout, so dropping it from «Виплачено» would print
  // a «Борг» 10 000 too small.
  it('reprints the first figures after its payout was voided, adding only the annulment line', () => {
    const all = build(
      intake({
        balance_after: '20120.00',
        paid_amount: '0.00',
        payouts: [payout('PO-1', '10000.00', '2026-09-08T10:00:00.000Z')],
      }),
    ).sections;
    expect(totalsOf(all)).toEqual([
      {
        kind: 'rows',
        rows: [
          { label: 'receipt.sum', value: '29,120.00 ₴' },
          { label: 'receipt.debt', value: '1,000.00 ₴' },
          { label: 'receipt.total', value: '30,120.00 ₴', strong: true },
          { label: 'receipt.paidOut', value: '10,000.00 ₴' },
        ],
      },
      { kind: 'caption', text: 'receipt.payoutVoided{"code":"PO-1"}' },
      { kind: 'rows', rows: [{ label: 'receipt.balance', value: '20,120.00 ₴', strong: true }] },
    ]);
  });

  it('prints a negative «Борг» signed, so the column still adds up', () => {
    // The supplier owed US 500 walking in: 1 000 − 500 = 500 paid, nothing left.
    const totals = totalsOf(
      build(
        intake({
          amount: '1000.00',
          balance_after: '0.00',
          paid_amount: '500.00',
          payouts: [payout('PO-1', '500.00')],
        }),
      ).sections,
    );
    const rows = totals.flatMap((s) => (s.kind === 'rows' ? s.rows : []));
    expect(rows.find((r) => r.label === 'receipt.debt')?.value).toBe('−500.00 ₴');
    expect(rows.find((r) => r.label === 'receipt.total')?.value).toBe('500.00 ₴');
  });

  // A2: a voided receipt's own amount is in no debt any more — a «Залишок»
  // that still counted it would contradict the stamp above it.
  it('prints a voided receipt with «Сума» and the annulment row instead of the balance block', () => {
    const { sections } = build(
      intake({
        voided_at: '2026-09-08T10:00:00.000Z',
        void_reason: 'Помилка',
        balance_after: '20120.00',
        payouts: [payout('PO-1', '10000.00', '2026-09-08T10:00:00.000Z')],
      }),
    );
    expect(sections).toHaveLength(4);
    expect(sections[2]).toEqual([
      {
        kind: 'rows',
        rows: [
          { label: 'receipt.sum', value: '29,120.00 ₴' },
          { label: 'receipt.voidedNotInBalance', value: '', muted: true },
        ],
      },
    ]);
    const labels = sections
      .flat()
      .flatMap((s) => (s.kind === 'rows' ? s.rows.map((r) => r.label) : []));
    for (const gone of ['receipt.debt', 'receipt.total', 'receipt.paidOut', 'receipt.balance']) {
      expect(labels).not.toContain(gone);
    }
    expect(sections.flat().some((s) => s.kind === 'caption')).toBe(false);
  });

  it('ends with the tare tally — one emphasised line per type, summed across lines', () => {
    const { sections } = build(
      intake({
        items: [
          item('a'),
          item('b', {
            tare: [
              { tare_type_id: 'tare-2', units: 3 },
              { tare_type_id: 'tare-1', units: 2 },
            ],
          }),
        ],
      }),
    );
    expect(sections[sections.length - 1]).toEqual([
      {
        kind: 'emphasis',
        rows: [
          { label: 'Ящик', value: '14' },
          { label: 'Чешка', value: '3' },
        ],
      },
    ]);
  });

  it('carries the void stamp and the note through', () => {
    const doc = buildIntakeReceipt({
      intake: intake({ voided_at: '2026-09-08T10:00:00.000Z', void_reason: 'Помилка' }),
      supplierName: 'X',
      tareNameById: new Map(),
      note: 'Дякуємо',
      t,
      locale: 'en',
    });
    expect(doc.voided).toEqual({ reason: 'Помилка' });
    expect(doc.footer).toEqual({ note: 'Дякуємо' });
  });
});
