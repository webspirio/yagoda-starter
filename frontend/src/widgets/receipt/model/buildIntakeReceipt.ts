import type { TFunction } from 'i18next';
import type { IntakeDetail } from '@/entities/intake';
import type { ReceiptDocument, ReceiptSection } from '@/shared/ui/receipt';
import { add, cmp, formatKg, formatUah, isZero } from '@/shared/lib/money';
import { receiptHeader } from './receiptHeader';

/**
 * One intake as a `ReceiptDocument` — every number and string resolved here,
 * so `ReceiptView` stays pure layout. `balance` is the supplier's LIVE debt
 * at this point (a supplier row is a point, §3.9), not frozen at write time,
 * read by the caller.
 */
export function buildIntakeReceipt({
  intake,
  supplierName,
  tareNameById,
  note,
  balance,
  t,
  locale,
}: {
  intake: IntakeDetail;
  supplierName: string;
  tareNameById: Map<string, string>;
  note: string | null;
  balance: string;
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

  const totals: ReceiptSection[] = [
    {
      kind: 'rows',
      rows: [
        { label: t('receipt.accrued'), value: formatUah(intake.amount, locale), strong: true },
      ],
    },
  ];
  if (cmp(intake.paid_amount, '0') !== 0) {
    totals.push({
      kind: 'rows',
      rows: [{ label: t('receipt.paid'), value: formatUah(intake.paid_amount, locale) }],
    });
    totals.push({
      kind: 'caption',
      text: intake.payouts
        .filter((p) => p.voided_at === null)
        .map((p) => p.code)
        .join(', '),
    });
  }
  for (const p of intake.payouts.filter((p) => p.voided_at !== null)) {
    totals.push({ kind: 'caption', text: t('receipt.payoutVoided', { code: p.code }) });
  }
  totals.push({
    kind: 'rows',
    rows: [{ label: t('receipt.balance'), value: formatUah(balance, locale) }],
  });
  sections.push(totals);

  return {
    voided: intake.voided_at ? { reason: intake.void_reason ?? '' } : null,
    header: receiptHeader(t, intake.point_number, intake.received_by_number),
    // No «Дата» (#254, client correction): the code already carries the day.
    meta: [
      { label: t('receipt.number'), value: intake.code },
      { label: t('receipt.operation'), value: t('receipt.operationIntake') },
      { label: t('receipt.supplier'), value: supplierName },
    ],
    sections,
    footer: { note },
  };
}
