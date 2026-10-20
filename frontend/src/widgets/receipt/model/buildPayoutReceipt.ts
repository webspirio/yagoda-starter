import type { TFunction } from 'i18next';
import type { PayoutDetail } from '@/entities/payout';
import type { ReceiptDocument } from '@/shared/ui/receipt';
import { formatUah } from '@/shared/lib/money';
import { receiptHeader } from './receiptHeader';

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
    header: receiptHeader(t, payout.point_number, payout.paid_by_number),
    // No «Дата» (#254, client correction): the code already carries the day.
    meta: [
      { label: t('receipt.number'), value: payout.code },
      { label: t('receipt.operation'), value: t('receipt.operationPayoutDebt') },
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
