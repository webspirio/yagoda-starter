import type { TFunction } from 'i18next';
import type { Payout } from '@/entities/payout';
import type { ReceiptDocument } from '@/shared/ui/receipt';
import { formatUah } from '@/shared/lib/money';
import { formatLongDate, formatTime } from '@/shared/lib/date';

/**
 * One standalone payout as a `ReceiptDocument`. `balance_after` is the debt
 * frozen when the payout was written — printed as is, never recomputed.
 */
export function buildPayoutReceipt({
  payout,
  supplierName,
  pointNumber,
  note,
  t,
  locale,
}: {
  payout: Payout;
  supplierName: string;
  /** `null` when the point is not in the caller's list — the header prints «—». */
  pointNumber: number | null;
  note: string | null;
  t: TFunction;
  locale: string;
}): ReceiptDocument {
  return {
    voided: payout.voided_at ? { reason: payout.void_reason ?? '' } : null,
    header: {
      point: pointNumber === null ? '—' : t('receipt.headerPoint', { number: pointNumber }),
      staff: payout.paid_by ? t('receipt.headerStaff', { number: payout.paid_by.number }) : '—',
    },
    meta: [
      { label: t('receipt.number'), value: payout.code },
      { label: t('receipt.operation'), value: t('receipt.operationPayoutDebt') },
      {
        label: t('receipt.date'),
        // §5 row 50 — the BUSINESS date (from the shift), as on the intake receipt.
        value: `${formatLongDate(payout.business_date, locale)} · ${formatTime(payout.created_at, locale)}`,
      },
      { label: t('receipt.supplier'), value: supplierName },
    ],
    sections: [
      [
        {
          kind: 'rows',
          rows: [{ label: t('receipt.paid'), value: formatUah(payout.amount, locale), strong: true }],
        },
        {
          kind: 'rows',
          rows: [{ label: t('receipt.balanceAfterPayout'), value: formatUah(payout.balance_after, locale) }],
        },
      ],
    ],
    footer: { note },
  };
}
