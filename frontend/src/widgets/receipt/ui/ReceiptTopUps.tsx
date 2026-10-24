import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/cn';
import { formatDateTime } from '@/shared/lib/date';
import { formatUah } from '@/shared/lib/money';
import type { IntakeTopUp } from '@/entities/intake-top-up';

/**
 * «Доплати до цієї квитанції (не друкуються)» — review 2026-10-24 #6. A row of
 * «Відкриті залишки» captioned «Доплата · …» opens THIS receipt, and the paper
 * cannot say a word about it: §2.7 freezes what was printed, and a top-up is
 * written days later. So the screen says it, under the paper and never on it
 * (`print-hide`), and only to the OWNER while the client decides whether
 * operators see top-ups at all.
 *
 * Struck through when it counts for nothing — voided itself, or its receipt
 * voided — and a voided one says why.
 */
export function ReceiptTopUps({ topUps }: { topUps: readonly IntakeTopUp[] }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? 'uk';
  if (topUps.length === 0) return null;
  return (
    <section
      aria-label={t('receipt.topUps.title')}
      className="print-hide mt-4 rounded-lg border border-line2 bg-muted/40 px-3 py-2 text-sm"
    >
      <h3 className="mb-1.5 text-xs font-medium text-muted-foreground">
        {t('receipt.topUps.title')}
      </h3>
      <ul className="flex flex-col gap-1">
        {topUps.map((u) => (
          <li
            key={u.id}
            className={cn(
              'flex flex-wrap items-baseline gap-x-2',
              !u.counts_toward_balance && 'text-muted-foreground line-through',
            )}
          >
            <span className="font-mono font-semibold tabular-nums whitespace-nowrap">
              {formatUah(u.amount, locale)}
            </span>
            <span>
              {'· '}
              {u.reason}
            </span>
            {u.created_by_name ? (
              <span>
                {'· '}
                {u.created_by_name}
              </span>
            ) : null}
            <span className="font-mono text-xs tabular-nums">
              {'· '}
              {formatDateTime(u.created_at, locale)}
            </span>
            {u.voided_at !== null ? (
              <span className="text-xs">
                {'· '}
                {t('receipt.topUps.voided', { reason: u.void_reason ?? '' })}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
