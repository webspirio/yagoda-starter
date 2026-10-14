import type { TFunction } from 'i18next';
import type { PayoutDetail } from '@/entities/payout';
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
  note,
  t,
  locale,
}: {
  payout: PayoutDetail;
  supplierName: string;
  note: string | null;
  t: TFunction;
  locale: string;
}): ReceiptDocument {
  return {
    voided: payout.voided_at ? { reason: payout.void_reason ?? '' } : null,
    header: {
      point: t('receipt.headerPoint', { number: payout.point_number }),
      staff:
        payout.paid_by_number === null
          ? '—'
          : t('receipt.headerStaff', { number: payout.paid_by_number }),
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
          rows: [
            { label: t('receipt.paid'), value: formatUah(payout.amount, locale), strong: true },
          ],
        },
        {
          kind: 'rows',
          rows: [
            {
              label: t('receipt.balanceAfterPayout'),
              value: formatUah(payout.balance_after, locale),
            },
          ],
        },
      ],
    ],
    footer: { note },
  };
}
