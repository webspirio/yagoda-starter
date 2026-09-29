import { useTranslation } from 'react-i18next';
import { SectionCard } from '@/shared/ui/section-card';
import { formatLongDate } from '@/shared/lib/date';
import { formatUah, formatKg, isZero } from '@/shared/lib/money';
import type { SettlementLine } from '@/entities/supplier';
import type { Intake } from '@/entities/intake';

/**
 * §3.10's «Відкриті залишки — за що саме винні», back as a projection (spec
 * 2026-09-25 §3.10). The shape follows the reference SupplierPage: one row per
 * open line, oldest first, the open amount on the right. Rendered only when
 * there is something to say — a closed card shows no empty box.
 *
 * A top-up is ITS OWN ROW, captioned with its parent's code: folding it into
 * the receipt's row would print a number bigger than the «Разом» on the paper
 * (the 11.09.2026 note in the `suppliers` Note).
 *
 * The kilograms come from the card's already loaded receipts, found by id. A
 * receipt past the card's `limit: 100` page is still an open line here — the
 * settlement is over the whole season — and just lacks the sub-caption.
 *
 * Overpayment is ONE ROW under the list, never a line: it is money nothing is
 * open against, the `−debt` §3.5 says «гаситься сам наступною здачею».
 */
export function OpenBalances({
  lines,
  unallocated,
  intakesById,
  locale,
}: {
  lines: SettlementLine[];
  unallocated: string;
  intakesById: Map<string, Intake>;
  locale: string;
}) {
  const { t } = useTranslation();
  const open = lines.filter((l) => !isZero(l.open));
  const overpaid = !isZero(unallocated);

  if (open.length === 0 && !overpaid) return null;

  return (
    <SectionCard eyebrow={t('supplierCard.open.title')} className="mb-5">
      {open.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {open.map((l) => {
            const receipt = l.kind === 'intake' ? intakesById.get(l.intake_id) : undefined;
            return (
              <li
                key={`${l.kind}-${l.id}`}
                className="flex items-center gap-3 rounded-lg bg-[var(--amber)]/8 px-3 py-2 text-sm"
              >
                <span className="font-mono text-xs text-muted-foreground">{l.code}</span>
                <span>{formatLongDate(l.business_date, locale)}</span>
                {l.kind === 'top_up' ? (
                  <span className="text-xs text-muted-foreground">
                    {t('supplierCard.open.topUp', { code: l.code })}
                  </span>
                ) : receipt ? (
                  <span className="text-xs text-muted-foreground">
                    {formatKg(receipt.net_kg, locale)}
                  </span>
                ) : null}
                <span className="ml-auto font-mono font-semibold tabular-nums text-[var(--amber)]">
                  {formatUah(l.open, locale)}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
      {overpaid ? (
        <div className="mt-2 flex items-center gap-3 rounded-lg bg-[var(--leaf)]/8 px-3 py-2 text-sm">
          <span className="text-muted-foreground">{t('supplierCard.open.unallocated')}</span>
          <span className="ml-auto font-mono font-semibold tabular-nums text-[var(--leaf)]">
            {formatUah(unallocated, locale)}
          </span>
        </div>
      ) : null}
    </SectionCard>
  );
}
