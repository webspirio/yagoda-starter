import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/shared/ui/badge';

/** One line of the printed receipt, already resolved to display strings —
 *  `ReceiptDialog` does the grade/tare lookups and money/weight formatting;
 *  this component only lays them out (mirrors the mock's `Row`-based sheet,
 *  `yagoda-crm`'s `components/reception/ReceiptDialog.tsx`). */
export interface ReceiptSheetLine {
  key: string;
  /** «{product} · {grade}» */
  label: string;
  gross: string;
  /** `null` hides the Піддон row — only shown when the intake had one. */
  pallet: string | null;
  /** «{units} × {tare name}»[, …] — every tare type on this line. */
  tareLabel: string;
  tareWeight: string;
  net: string;
  price: string;
  /** Formatted bonus (already signed), or `null` when the bonus is 0.00. */
  bonus: string | null;
  amount: string;
}

export interface ReceiptSheetProps {
  code: string;
  date: string;
  pointName: string;
  supplierName: string;
  lines: ReceiptSheetLine[];
  accrued: string;
  balance: string;
  /** `null` when nothing has been paid out yet (`paid_amount` is `'0.00'`) —
   *  the row and its muted list of payout codes are both hidden then.
   *  `codes` are the LIVE (non-voided) linked payouts' codes. */
  paid: { amount: string; codes: string[] } | null;
  /** Codes of linked payouts that were voided after the fact — printed as a
   *  muted annulment line each, so the paper slip doesn't silently disagree
   *  with the register. */
  voidedPayouts: string[];
  /** Who received this document (`received_by_name`), or «—» when unknown. */
  receivedBy: string;
  voided: { reason: string } | null;
  /** Our rented crates handed back in the SAME «Прийняти» as this receipt
   *  (2026-09-24) — `null` when none came back with it. Printed as its own
   *  line under the tare/lines block, apart from «Видано готівкою». */
  crateReturn: {
    units: number;
    /** Formatted deposit refund, or `null` when the whole return was «на
     *  розписку» (`deposit_refund` is zero — no money changed hands). A
     *  MIXED return (part deposit, part receipt) still has a non-null
     *  amount here, since the amount covers only the deposit part. */
    amount: string | null;
    /** The return is voided together with the receipt, never on its own —
     *  prints a muted annulment line instead of the units/amount. */
    voided: boolean;
  } | null;
}

function Row({
  label,
  value,
  strong,
  muted,
}: {
  label: ReactNode;
  value: ReactNode;
  strong?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-[3px]">
      <span className={muted ? 'text-neutral-500' : ''}>{label}</span>
      <span className={`font-mono ${strong ? 'text-base font-semibold' : ''}`}>{value}</span>
    </div>
  );
}

/**
 * The printable body of one intake's receipt («квитанція») — `.printable` is
 * what `index.css`'s `@media print` rules keep on the page, hiding everything
 * else (see the block above `.print-hide`). Pure layout: every value it
 * receives is already the string that belongs on paper.
 */
export function ReceiptSheet({
  code,
  date,
  pointName,
  supplierName,
  lines,
  accrued,
  balance,
  paid,
  voidedPayouts,
  receivedBy,
  voided,
  crateReturn,
}: ReceiptSheetProps) {
  const { t } = useTranslation();

  return (
    <div className="printable rounded-lg border border-dashed border-border bg-white p-4 text-[13px] text-neutral-900">
      {voided ? (
        <div className="mb-3 rounded-md border-2 border-destructive p-2 text-center">
          <Badge variant="destructive" className="h-auto px-3 py-1 text-sm font-semibold">
            {t('receipt.voided')}
          </Badge>
          <p className="mt-1 text-xs text-destructive">
            {t('receipt.voidReason', { reason: voided.reason })}
          </p>
        </div>
      ) : null}

      <div className="text-center">
        <div className="text-sm font-semibold tracking-tight">{t('receipt.heading')}</div>
        <div className="text-[11px] text-neutral-500">{pointName}</div>
      </div>

      <div className="my-3 border-t border-dashed border-neutral-300" />

      <Row label={t('receipt.code')} value={code} />
      <Row label={t('receipt.date')} value={date} />
      <Row label={t('receipt.supplier')} value={supplierName} />

      {lines.map((line) => (
        <div key={line.key}>
          <div className="my-3 border-t border-dashed border-neutral-300" />

          <Row label={line.label} value="" muted />
          <Row label={t('receipt.gross')} value={line.gross} />
          {line.pallet !== null ? (
            <Row label={t('receipt.pallet')} value={`− ${line.pallet}`} />
          ) : null}
          <Row label={t('receipt.tare', { detail: line.tareLabel })} value={`− ${line.tareWeight}`} />
          <div className="my-1.5 border-t border-neutral-900" />
          <Row label={t('receipt.net')} value={line.net} strong />
          <Row
            label={t('receipt.pricePerKg')}
            value={line.bonus !== null ? `${line.price} ${line.bonus}` : line.price}
          />
          <Row label={t('receipt.amount')} value={line.amount} />
        </div>
      ))}

      {crateReturn ? (
        <div>
          <div className="my-3 border-t border-dashed border-neutral-300" />
          {crateReturn.voided ? (
            <Row label={t('receipt.crateReturnVoided')} value="" muted />
          ) : (
            <Row
              label={t(
                crateReturn.amount !== null ? 'receipt.crateReturn' : 'receipt.crateReturnNoMoney',
                { units: crateReturn.units, amount: crateReturn.amount ?? undefined },
              )}
              value=""
            />
          )}
        </div>
      ) : null}

      <div className="my-3 border-t border-dashed border-neutral-300" />

      <Row label={t('receipt.accrued')} value={accrued} strong />
      {paid ? <Row label={t('receipt.paid')} value={paid.amount} /> : null}
      {paid ? (
        <div className="text-[10px] text-neutral-500">{paid.codes.join(', ')}</div>
      ) : null}
      {voidedPayouts.map((code) => (
        <div key={code} className="text-[10px] text-neutral-500">
          {t('receipt.payoutVoided', { code })}
        </div>
      ))}
      <Row label={t('receipt.balanceAtPoint')} value={balance} />
      <Row label={t('receipt.receivedBy')} value={receivedBy} muted />

      <div className="mt-4 text-center text-[10px] text-neutral-400">{t('receipt.footer')}</div>
    </div>
  );
}
