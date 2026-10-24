import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight } from 'lucide-react';
import { SectionCard } from '@/shared/ui/section-card';
import { formatShortDate, toLocalIsoDate } from '@/shared/lib/date';
import { Button } from '@/shared/ui/button';
import { formatUah, formatKg, isZero } from '@/shared/lib/money';
import type { SettlementLine } from '@/entities/supplier';
import type { Intake } from '@/entities/intake';
import type { IntakeTopUp } from '@/entities/intake-top-up';

/**
 * §3.10's «Відкриті залишки — за що саме винні», back as a projection (spec
 * 2026-09-25 §3.10). The shape follows the reference SupplierPage: one row per
 * open line, oldest first, the open amount on the right. Rendered only when
 * there is something to say — a closed card shows no empty box.
 *
 * A top-up is ITS OWN ROW, captioned with its parent's code: folding it into
 * the receipt's row would print a number bigger than the «Разом» on the paper
 * (the 11.09.2026 note in the `suppliers` Note). Since review 2026-10-24 it reads
 * «Доплата · {причина}» on the day it was WRITTEN, the parent's code still at the
 * row's start — «Доплата до SHP-IN-…» under the receipt's date read as a second
 * receipt. A top-up past the card's `limit: 100` page keeps the old caption.
 *
 * The kilograms come from the card's already loaded receipts, found by id. A
 * receipt past the card's `limit: 100` page is still an open line here — the
 * settlement is over the whole season — and just lacks the sub-caption.
 *
 * Overpayment is ONE ROW under the list, never a line: it is money nothing is
 * open against, the `−debt` §3.5 says «гаситься сам наступною здачею».
 *
 * A row opens its receipt: a top-up's `intake_id` is its parent's, so both kinds
 * land on the paper the debt was written on.
 *
 * Audit D4: the oldest `FIRST_SHOWN` lines, then «Показати всі (N)» — a season
 * of small open remainders otherwise pushes the history off the screen. A
 * partly paid line says what it is a part of («з 4 200,00 ₴»), so 1 660 is
 * never read as the receipt's own sum.
 */
const FIRST_SHOWN = 10;

export function OpenBalances({
  lines,
  unallocated,
  intakesById,
  topUpsById,
  locale,
  onOpenReceipt,
}: {
  lines: SettlementLine[];
  unallocated: string;
  intakesById: Map<string, Intake>;
  /** The card's loaded top-ups, by id — a top-up line's reason and creation day. */
  topUpsById: Map<string, IntakeTopUp>;
  locale: string;
  onOpenReceipt: (intakeId: string) => void;
}) {
  const { t } = useTranslation();
  const [showAll, setShowAll] = useState(false);
  const open = lines.filter((l) => !isZero(l.open));
  const shown = showAll ? open : open.slice(0, FIRST_SHOWN);
  const overpaid = !isZero(unallocated);

  if (open.length === 0 && !overpaid) return null;

  return (
    <SectionCard eyebrow={t('supplierCard.open.title')} className="mb-5">
      {open.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {shown.map((l) => {
            const receipt = l.kind === 'intake' ? intakesById.get(l.intake_id) : undefined;
            const topUp = l.kind === 'top_up' ? topUpsById.get(l.id) : undefined;
            const day = topUp ? toLocalIsoDate(topUp.created_at) : l.business_date;
            return (
              <li key={`${l.kind}-${l.id}`}>
                <button
                  type="button"
                  onClick={() => onOpenReceipt(l.intake_id)}
                  title={t('supplierCard.open.openReceipt', { code: l.code })}
                  className="group flex w-full items-center gap-3 rounded-lg bg-[var(--amber)]/8 px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--amber)]/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="font-mono text-xs text-muted-foreground">{l.code}</span>
                  <span className="font-mono tabular-nums">{formatShortDate(day, locale)}</span>
                  {l.kind === 'top_up' ? (
                    <span className="truncate text-xs text-muted-foreground">
                      {topUp
                        ? t('supplierCard.open.topUpReason', { reason: topUp.reason })
                        : t('supplierCard.open.topUp', { code: l.code })}
                    </span>
                  ) : receipt ? (
                    <span className="text-xs text-muted-foreground">
                      {formatKg(receipt.net_kg, locale)}
                    </span>
                  ) : null}
                  <span className="ml-auto text-right">
                    <span
                      data-trace="card:open"
                      className="block whitespace-nowrap font-mono font-semibold tabular-nums text-[var(--amber)]"
                    >
                      {formatUah(l.open, locale)}
                    </span>
                    {!isZero(l.paid) ? (
                      <span className="block whitespace-nowrap font-mono text-[11px] tabular-nums text-muted-foreground">
                        {t('supplierCard.open.ofAmount', { uah: formatUah(l.amount, locale) })}
                      </span>
                    ) : null}
                  </span>
                  <ChevronRight
                    aria-hidden
                    className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                  />
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
      {open.length > shown.length ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-2"
          onClick={() => setShowAll(true)}
        >
          {t('supplierCard.open.showAll', { n: open.length })}
        </Button>
      ) : null}
      {overpaid ? (
        <div className="mt-2 flex items-center gap-3 rounded-lg bg-[var(--leaf)]/8 px-3 py-2 text-sm">
          <span className="text-muted-foreground">{t('supplierCard.open.unallocated')}</span>
          <span
            data-trace="card:open"
            className="ml-auto font-mono font-semibold tabular-nums text-[var(--leaf)]"
          >
            {formatUah(unallocated, locale)}
          </span>
        </div>
      ) : null}
    </SectionCard>
  );
}
