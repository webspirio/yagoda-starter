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
import type { IntakeTopUp } from '@/entities/intake-top-up';
import type { Me } from '@/entities/user';

interface TimelineRowBase {
  id: string;
  /** A top-up has no code of its own, so it borrows its PARENT receipt's —
   *  that is what the owner recognises, and inventing one would be a lie. */
  code: string;
  amount: string;
  /** A top-up has no business date either: it is written from the owner's desk
   *  against a shift that closed days ago. Empty for that kind, and the merge
   *  sorts on `createdAt`, which all three have. */
  businessDate: string;
  createdAt: string;
  voided: boolean;
  reason: string | null;
}

type TimelineRow =
  | (TimelineRowBase & { kind: 'intake'; intake: Intake })
  | (TimelineRowBase & { kind: 'payout'; payout: Payout })
  | (TimelineRowBase & { kind: 'topUp'; topUp: IntakeTopUp });

/**
 * intakes + payouts + TOP-UPS of one supplier, merged newest-first by
 * `created_at` (spec §5.4) — the season's whole history, no per-receipt balance
 * breakdown (§3: a balance is ONE number). Voided rows are struck through
 * with the reason shown, not just hinted at in a tooltip; a payout carries
 * its own «Анулювати» when the viewer is allowed to void it — an intake's
 * void action lives inside the receipt widget it opens, not here.
 *
 * THIS IS THE ONLY PLACE THE BALANCE IS EXPLAINED. `GET /suppliers/:id/balance`
 * returns a single `debt` string with no breakdown, so the three terms of
 * `Σ intakes + Σ top-ups − Σ payouts` meet on screen here and nowhere else.
 * That is why a top-up must be visible even when it counts for nothing: a
 * reader comparing this list against the balance tile has no other source.
 */
export function SupplierTimeline({
  intakes,
  payouts,
  topUps,
  me,
  onOpenReceipt,
  onVoidPayout,
  onAddTopUp,
  onVoidTopUp,
}: {
  intakes: Intake[];
  payouts: Payout[];
  topUps: IntakeTopUp[];
  me: Me | undefined;
  onOpenReceipt: (intakeId: string) => void;
  onVoidPayout: (payout: Payout) => void;
  /** Owner only. Absent for an operator — §10.2: «заблокована кнопка вчить
   *  шукати обхід, відсутня не вчить нічого». */
  onAddTopUp: (intake: Intake) => void;
  onVoidTopUp: (topUp: IntakeTopUp) => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;

  const canVoid = (p: Payout) =>
    p.voided_at === null && (me?.role === 'network_owner' || me?.id === p.paid_by_user_id);
  // Both top-up writes are `@Auth(UserRole.NetworkOwner)` — the operator never
  // writes one, so §9.4's «своя квитанція» has no meaning here.
  const isOwner = me?.role === 'network_owner';

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
        ...topUps.map(
          (u): TimelineRow => ({
            kind: 'topUp',
            topUp: u,
            id: u.id,
            // The PARENT's code — see `TimelineRowBase`.
            code: u.intake.code,
            amount: u.amount,
            businessDate: '',
            createdAt: u.created_at,
            // STRUCK THROUGH WHEN IT COUNTS FOR NOTHING, whichever of the two
            // was voided — but never hidden. The caption below says which.
            voided: !u.counts_toward_balance,
            reason: u.voided_at !== null ? u.void_reason : null,
          }),
        ),
      ].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0)),
    [intakes, payouts, topUps],
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
            <>
              {/* The receipt opens on click; «Додати залишок» is a SIBLING, not
                  nested — a button inside a button is invalid markup and the
                  inner one would never receive the click. */}
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
              {/* NOT OFFERED ON A VOIDED RECEIPT: `counts_toward_balance` folds
                  in the parent's void, so a top-up written here would count for
                  nothing the moment it was saved. */}
              {isOwner && !row.voided ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onAddTopUp(row.intake)}
                >
                  {t('supplierCard.timeline.addTopUp')}
                </Button>
              ) : null}
            </>
          ) : row.kind === 'topUp' ? (
            <>
              <Badge variant="secondary">{t('supplierCard.timeline.topUp')}</Badge>
              <span className="font-mono text-xs text-muted-foreground">
                {t('supplierCard.timeline.againstReceipt', { code: row.code })}
              </span>
              <span className="truncate text-xs text-muted-foreground">{row.topUp.reason}</span>
              {/*
                WHICH OF THE TWO WAS VOIDED, said out loud. A top-up the owner
                voided and a top-up whose PARENT RECEIPT was voided look
                identical on a balance — both count for nothing — and are
                completely different events. Collapsing them into one strike
                through would be exactly the silence `counts_toward_balance`
                exists to prevent.
              */}
              {row.voided ? (
                <span className="text-xs">
                  {row.topUp.voided_at !== null
                    ? row.topUp.void_reason
                    : t('supplierCard.timeline.parentVoided')}
                </span>
              ) : null}
              <span className="ml-auto font-mono tabular-nums">
                {formatUah(row.amount, locale)}
              </span>
              {isOwner && row.topUp.voided_at === null ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onVoidTopUp(row.topUp)}
                >
                  {t('supplierCard.timeline.void')}
                </Button>
              ) : null}
            </>
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
