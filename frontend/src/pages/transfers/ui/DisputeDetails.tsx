import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { HandCoins } from 'lucide-react';
import { Button } from '@/shared/ui/button';
import { formatUah, sub } from '@/shared/lib/money';
import { formatDateTime } from '@/shared/lib/date';
import type { Transfer } from '@/entities/transfer';
import { DiscrepancyText } from '@/entities/cash-count';

/**
 * What one disputed transfer says (#76): when it left, what was sent, what
 * the point counted, the difference, and the point's own note — plus, for a
 * dispute the owner already settled, what it was settled at. Presentational
 * only; shared by `PointDebtTable`'s per-point list and `TransferHistory`'s
 * per-document row, so the two never describe the same dispute differently.
 *
 * «Вирішити» appears only for an OPEN dispute (`resolved_at === null`) and
 * only when the caller passes `onResolve`. Every click inside stops at this
 * list, so a button here never toggles the table row it is expanded under.
 */
export function DisputeList({
  transfers,
  label,
  onResolve,
}: {
  transfers: Transfer[];
  label: string;
  onResolve?: (transfer: Transfer) => void;
}) {
  return (
    <ul aria-label={label} className="flex flex-col divide-y divide-line2/60">
      {transfers.map((tr) => (
        <li key={tr.id} className="py-2 first:pt-0 last:pb-0">
          <DisputeDetails transfer={tr} onResolve={onResolve} />
        </li>
      ))}
    </ul>
  );
}

function DisputeDetails({
  transfer,
  onResolve,
}: {
  transfer: Transfer;
  onResolve?: (transfer: Transfer) => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const money = (v: string | null) => (v == null ? '—' : formatUah(v, locale));
  const cratesOff = transfer.crates_discrepancy != null && transfer.crates_discrepancy !== 0;
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2 text-sm">
      <div className="flex min-w-0 flex-col gap-1.5">
        <dl className="flex flex-wrap gap-x-6 gap-y-1">
          <Item label={t('transfers.dispute.sentAt')}>
            <span className="font-mono text-xs">{formatDateTime(transfer.sent_at, locale)}</span>
          </Item>
          <Item label={t('transfers.dispute.sentCash')}>
            <span className="font-mono tabular-nums">{money(transfer.cash)}</span>
          </Item>
          <Item label={t('transfers.dispute.reportedCash')}>
            <span className="font-mono tabular-nums">{money(transfer.reported_cash)}</span>
          </Item>
          <Item label={t('transfers.dispute.discrepancy')}>
            {/* C7 — the shared reading: «Недостача 2 000,00 ₴» when less
                arrived than was sent. `cash_discrepancy` is sent − arrived,
                so it is negated into «arrived − sent». */}
            {transfer.cash_discrepancy == null ? (
              <span className="font-mono">—</span>
            ) : (
              <DiscrepancyText
                className="font-mono font-semibold tabular-nums"
                difference={sub('0', transfer.cash_discrepancy)}
              />
            )}
          </Item>
        </dl>
        {cratesOff ? (
          <p className="text-muted-foreground">
            {t('transfers.dispute.crates', {
              sent: transfer.crates,
              reported: transfer.reported_crates ?? '—',
              diff: transfer.crates_discrepancy,
            })}
          </p>
        ) : null}
        {transfer.dispute_note ? (
          <p className="text-muted-foreground">
            {t('transfers.dispute.note', { note: transfer.dispute_note })}
          </p>
        ) : null}
        {transfer.resolved_at != null ? (
          <p className="text-leaf">
            {t('transfers.dispute.resolved', {
              cash: money(transfer.resolved_cash),
              crates: transfer.resolved_crates ?? '—',
              date: formatDateTime(transfer.resolved_at, locale),
            })}
          </p>
        ) : null}
      </div>
      {transfer.resolved_at == null && onResolve ? (
        <Button
          size="sm"
          variant="outline"
          onClick={(e) => {
            e.stopPropagation();
            onResolve(transfer);
          }}
        >
          <HandCoins className="size-3.5" />
          {t('transfers.resolve')}
        </Button>
      ) : null}
    </div>
  );
}

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
