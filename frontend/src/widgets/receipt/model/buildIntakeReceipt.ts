import type { TFunction } from 'i18next';
import type { IntakeDetail } from '@/entities/intake';
import type { ReceiptDocument, ReceiptSection } from '@/shared/ui/receipt';
import { add, cmp, formatKg, formatUah, isZero, sub, sum } from '@/shared/lib/money';
import { receiptHeader } from './receiptHeader';

/**
 * One intake as a `ReceiptDocument` — every number and string resolved here,
 * so `ReceiptView` stays pure layout.
 *
 * The footer is the client's agreed five lines (23.10, read off their own
 * Excel receipt): Сума · Борг · Разом · Виплачено · Залишок, each always
 * printed — «Борг» and «Виплачено» as 0,00 when there is none — so they
 * re-check on a calculator: Сума + Борг = Разом, Разом − Виплачено = Залишок.
 *
 * Every figure is the one the FIRST print showed (audit 2026-10-24 A1):
 * «Залишок» is the server's frozen `balance_after`, never the live debt, so a
 * later receipt, payout or top-up of this supplier does not move a reprint.
 * «Виплачено» is the cash handed over WITH the receipt — every linked payout,
 * a since-voided one included, because `balance_after` already subtracted it;
 * the voided one also gets its annulment line. «Борг» is DERIVED (Залишок −
 * Сума + Виплачено), so the calculator check holds by construction.
 *
 * A VOIDED receipt (A2) prints its lines, «Сума» and «Анульовано — у залишок
 * не входить» instead of that block: its own amount is no longer in any debt,
 * and a «Залишок» that still counted it would contradict the stamp above.
 * Then the tare tally: one emphasised line per tare type, summed over every
 * line of the receipt.
 */
function balanceBlock(intake: IntakeDetail, t: TFunction, locale: string): ReceiptSection[] {
  const balance = intake.balance_after;
  // Not `paid_amount` (live payouts only): after a payout void that would
  // print a «Борг» the first print never showed.
  const paid = sum(intake.payouts.map((p) => p.amount));
  const debt = sub(add(balance, paid), intake.amount);
  const totals: ReceiptSection[] = [
    {
      kind: 'rows',
      rows: [
        { label: t('receipt.sum'), value: formatUah(intake.amount, locale) },
        { label: t('receipt.debt'), value: formatUah(debt, locale) },
        {
          label: t('receipt.total'),
          value: formatUah(add(intake.amount, debt), locale),
          strong: true,
        },
        { label: t('receipt.paidOut'), value: formatUah(paid, locale) },
      ],
    },
  ];
  const livePayoutCodes = intake.payouts.filter((p) => p.voided_at === null).map((p) => p.code);
  if (livePayoutCodes.length > 0) {
    totals.push({ kind: 'caption', text: livePayoutCodes.join(', ') });
  }
  for (const p of intake.payouts.filter((p) => p.voided_at !== null)) {
    totals.push({ kind: 'caption', text: t('receipt.payoutVoided', { code: p.code }) });
  }
  totals.push({
    kind: 'rows',
    rows: [{ label: t('receipt.balance'), value: formatUah(balance, locale), strong: true }],
  });
  return totals;
}

export function buildIntakeReceipt({
  intake,
  supplierName,
  tareNameById,
  note,
  t,
  locale,
}: {
  intake: IntakeDetail;
  supplierName: string;
  tareNameById: Map<string, string>;
  note: string | null;
  t: TFunction;
  locale: string;
}): ReceiptDocument {
  const sections: ReceiptSection[][] = intake.items.map((item) => {
    const tareLabel = item.tare
      .map((tareLine) => `${tareLine.units} × ${tareNameById.get(tareLine.tare_type_id) ?? '—'}`)
      .join(', ');
    return [
      {
        kind: 'berryLine',
        line: {
          // #162: the product alone — the grade shows only through its price.
          // `intake.mapper` keeps `?? ''` for a missing name, hence the «—».
          label: item.product_name || '—',
          gross: formatKg(item.gross_kg, locale),
          pallet: cmp(item.pallet_kg, '0') !== 0 ? formatKg(item.pallet_kg, locale) : null,
          tareLabel,
          tareWeight: formatKg(item.tare_weight_kg, locale),
          net: formatKg(item.net_kg, locale),
          // #164: the final price only — the bonus is folded in, not shown.
          price: formatUah(add(item.price, item.bonus), locale),
          amount: formatUah(item.amount, locale),
        },
      },
    ];
  });

  const crateReturn = intake.crate_return;
  if (crateReturn) {
    // The old sheet's markup: the live forms are a normal row (label only),
    // only the annulment is muted.
    if (crateReturn.voided_at !== null) {
      sections.push([
        { kind: 'rows', rows: [{ label: t('receipt.crateReturnVoided'), value: '', muted: true }] },
      ]);
    } else {
      const label = isZero(crateReturn.deposit_refund)
        ? t('receipt.crateReturnNoMoney', { units: crateReturn.units })
        : t('receipt.crateReturn', {
            units: crateReturn.units,
            amount: formatUah(crateReturn.deposit_refund, locale),
          });
      sections.push([{ kind: 'rows', rows: [{ label, value: '' }] }]);
    }
  }

  if (intake.voided_at !== null) {
    sections.push([
      {
        kind: 'rows',
        rows: [
          { label: t('receipt.sum'), value: formatUah(intake.amount, locale) },
          { label: t('receipt.voidedNotInBalance'), value: '', muted: true },
        ],
      },
    ]);
  } else {
    sections.push(balanceBlock(intake, t, locale));
  }

  // The tare tally (client 23.10, 38:18–47:06): how many of each tare type
  // the supplier takes away, the same type summed across lines, in the order
  // the receipt first names it. Integer unit counts, not money.
  const tally = new Map<string, number>();
  for (const item of intake.items) {
    for (const tareLine of item.tare) {
      tally.set(tareLine.tare_type_id, (tally.get(tareLine.tare_type_id) ?? 0) + tareLine.units);
    }
  }
  if (tally.size > 0) {
    sections.push([
      {
        kind: 'emphasis',
        rows: [...tally].map(([id, units]) => ({
          label: tareNameById.get(id) ?? '—',
          value: String(units),
        })),
      },
    ]);
  }

  return {
    voided: intake.voided_at ? { reason: intake.void_reason ?? '' } : null,
    header: receiptHeader(t, intake.point_number, intake.received_by_number),
    // No «Дата» (#254, client correction): the code already carries the day.
    meta: [
      { label: t('receipt.number'), value: intake.code },
      // No «Операція» line (client 23.10, 02:43): an intake receipt says so by itself.
      { label: t('receipt.supplier'), value: supplierName },
    ],
    sections,
    footer: { note },
  };
}
