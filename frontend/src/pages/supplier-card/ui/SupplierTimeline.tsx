import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { EmptyState } from '@/shared/ui/empty-state';
import { cn } from '@/shared/lib/cn';
import { formatShortDate } from '@/shared/lib/date';
import { formatUah } from '@/shared/lib/money';
import type { Intake } from '@/entities/intake';
import type { Payout } from '@/entities/payout';
import type { Me } from '@/entities/user';

interface TimelineRowBase {
  id: string;
  code: string;
  amount: string;
  businessDate: string;
  createdAt: string;
  voided: boolean;
  reason: string | null;
}

type TimelineRow =
  | (TimelineRowBase & { kind: 'intake'; intake: Intake })
  | (TimelineRowBase & { kind: 'payout'; payout: Payout });

/**
 * intakes + payouts of one supplier, merged newest-first by `created_at`
 * (spec §5.4) — the season's whole history, no per-receipt balance
 * breakdown (§3: a balance is ONE number). Voided rows are struck through
 * with the reason shown, not just hinted at in a tooltip; a payout carries
 * its own «Анулювати» when the viewer is allowed to void it — an intake's
 * void action lives inside the receipt widget it opens, not here.
 */
export function SupplierTimeline({
  intakes,
  payouts,
  me,
  onOpenReceipt,
  onVoidPayout,
}: {
  intakes: Intake[];
  payouts: Payout[];
  me: Me | undefined;
  onOpenReceipt: (intakeId: string) => void;
  onVoidPayout: (payout: Payout) => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;

  const canVoid = (p: Payout) =>
    p.voided_at === null && (me?.role === 'network_owner' || me?.id === p.paid_by_user_id);

  const rows: TimelineRow[] = useMemo(
    () =>
      [
        ...intakes.map(
          (i): TimelineRow => ({
            kind: 'intake',
            intake: i,
            id: i.id,
            code: i.code,
            amount: i.amount,
            businessDate: i.business_date,
            createdAt: i.created_at,
            voided: i.voided_at !== null,
            reason: i.void_reason,
          }),
        ),
        ...payouts.map(
          (p): TimelineRow => ({
            kind: 'payout',
            payout: p,
            id: p.id,
            code: p.code,
            amount: p.amount,
            businessDate: p.business_date,
            createdAt: p.created_at,
            voided: p.voided_at !== null,
            reason: p.void_reason,
          }),
        ),
      ].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0)),
    [intakes, payouts],
  );

  if (rows.length === 0) {
    return <EmptyState title={t('supplierCard.timeline.empty')} />;
  }

  return (
    <ul className="divide-y divide-border">
      {rows.map((row) => (
        <li
          key={`${row.kind}-${row.id}`}
          className={cn(
            'flex items-center gap-3 py-2.5 text-sm',
            row.voided && 'text-muted-foreground line-through',
          )}
          title={row.voided ? (row.reason ?? undefined) : undefined}
        >
          {row.kind === 'intake' ? (
            <button
              type="button"
              onClick={() => onOpenReceipt(row.id)}
              className="flex flex-1 items-center gap-3 text-left"
            >
              <span className="font-mono text-xs text-muted-foreground">
                {formatShortDate(row.businessDate, locale)}
              </span>
              <span className="font-mono text-xs text-muted-foreground">
                {new Date(row.createdAt).toLocaleTimeString(locale, {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
              <span className="font-mono">{row.code}</span>
              <Badge variant="secondary">{t('supplierCard.timeline.intake')}</Badge>
              {row.voided ? <span className="text-xs">{row.reason}</span> : null}
              <span className="ml-auto font-mono tabular-nums">
                {formatUah(row.amount, locale)}
              </span>
            </button>
          ) : (
            <>
              <Badge variant="outline">{t('supplierCard.timeline.payout')}</Badge>
              <span className="font-mono">{row.code}</span>
              {row.voided ? <span className="text-xs">{row.reason}</span> : null}
              <span
                className={cn(
                  'ml-auto font-mono tabular-nums',
                  !row.voided && 'text-[var(--leaf)]',
                )}
              >
                {formatUah(row.amount, locale)}
              </span>
              {canVoid(row.payout) ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onVoidPayout(row.payout)}
                >
                  {t('supplierCard.timeline.void')}
                </Button>
              ) : null}
            </>
          )}
        </li>
      ))}
    </ul>
  );
}
