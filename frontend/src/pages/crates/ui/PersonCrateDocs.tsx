import { useState } from 'react';
import { Ban } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import { Spinner } from '@/shared/ui/spinner';
import { cn } from '@/shared/lib/cn';
import { formatUah } from '@/shared/lib/money';
import { formatShortDate, formatTime } from '@/shared/lib/date';
import { useCrateIssuancesQuery, useCrateReturnsQuery } from '@/entities/crate';
import type { CrateIssuance, CrateReturn } from '@/entities/crate';
import { VoidDocumentDialog } from '@/features/void-document';

type Doc = { kind: 'crateIssuance'; doc: CrateIssuance } | { kind: 'crateReturn'; doc: CrateReturn };

/**
 * One person's crate documents, newest first, voided ones kept and struck
 * through (§9.3: a correction is a void plus a new document).
 *
 * THE VOID BUTTON FOLLOWS THE SERVER'S RULE, NOT THE MOCK'S. The client
 * relaxed §9.4 on 2026-09-15: an operator may void ANY crate document at their
 * point while the shift is OPEN; a closed shift's document is the owner's.
 * The server says which via `shift_closed`, and `has_live_returns` marks the
 * one void it would refuse outright — an issuance a live return rests on —
 * so a button is never offered that is known to fail.
 */
export function PersonCrateDocs({ supplierId, isOwner }: { supplierId: string; isOwner: boolean }) {
  const { t, i18n } = useTranslation();
  const filter = { supplierId, includeVoided: true, limit: 100 };
  const issuances = useCrateIssuancesQuery(filter);
  const returns = useCrateReturnsQuery(filter);
  const [voiding, setVoiding] = useState<Doc | null>(null);

  if (issuances.isPending || returns.isPending) {
    return <div className="flex justify-center py-4"><Spinner /></div>;
  }
  if (issuances.isError || returns.isError) {
    return <p role="alert" className="px-4 py-3 text-sm text-destructive">{t('crates.docs.failed')}</p>;
  }

  const docs: Doc[] = [
    ...(issuances.data?.data ?? []).map((doc): Doc => ({ kind: 'crateIssuance', doc })),
    ...(returns.data?.data ?? []).map((doc): Doc => ({ kind: 'crateReturn', doc })),
  ].sort((a, b) => b.doc.created_at.localeCompare(a.doc.created_at));

  const mayVoid = (d: Doc) => d.doc.voided_at === null && (isOwner || !d.doc.shift_closed);
  const blocked = (d: Doc) => d.kind === 'crateIssuance' && d.doc.has_live_returns;

  const terms = (d: Doc) =>
    d.kind === 'crateIssuance'
      ? d.doc.mode === 'deposit'
        ? t('crates.docs.onDeposit', { amount: formatUah(d.doc.deposit_taken, i18n.language) })
        : t('crates.docs.onReceipt', { code: d.doc.code })
      : d.doc.allocations.some((a) => a.mode === 'deposit')
        ? t('crates.docs.refunded', { amount: formatUah(d.doc.deposit_refund, i18n.language) })
        : t('crates.docs.noRefund');

  const label = (d: Doc) =>
    d.kind === 'crateIssuance'
      ? d.doc.code
      : t('crates.docs.returnLabel', { units: d.doc.units, date: formatShortDate(d.doc.business_date, i18n.language) });

  return (
    <div className="flex flex-col gap-2 px-4 py-3">
      <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{t('crates.docs.title')}</p>
      {docs.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('crates.docs.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {docs.map((d) => {
            const voided = d.doc.voided_at !== null;
            return (
              <li key={`${d.kind}-${d.doc.id}`}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-background px-3 py-2 text-sm ring-1 ring-foreground/10">
                <span className="font-mono text-xs text-muted-foreground">
                  {formatShortDate(d.doc.business_date, i18n.language)} · {formatTime(d.doc.created_at, i18n.language)}
                </span>
                <span className={cn(voided ? 'text-muted-foreground line-through' : undefined)}>
                  {t(d.kind === 'crateIssuance' ? 'crates.docs.issued' : 'crates.docs.returned', { count: d.doc.units })}
                </span>
                <span className="text-xs text-muted-foreground">{terms(d)}</span>
                {voided ? (
                  <span className="ml-auto text-xs text-muted-foreground">
                    {t('crates.docs.voidedLine', {
                      date: formatShortDate(d.doc.voided_at!.slice(0, 10), i18n.language),
                      reason: d.doc.void_reason ?? '',
                    })}
                  </span>
                ) : blocked(d) ? (
                  <span className="ml-auto text-xs text-muted-foreground">{t('crates.docs.blockedByReturn')}</span>
                ) : mayVoid(d) ? (
                  <Button variant="ghost" size="sm" className="ml-auto h-7 px-2 text-destructive" onClick={() => setVoiding(d)}>
                    <Ban className="size-3.5" aria-hidden="true" />
                    {t('crates.docs.void')}
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {voiding ? (
        <VoidDocumentDialog
          kind={voiding.kind}
          id={voiding.doc.id}
          code={label(voiding)}
          open
          onClose={() => setVoiding(null)}
        />
      ) : null}
    </div>
  );
}
