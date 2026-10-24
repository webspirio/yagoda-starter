import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, XCircle } from 'lucide-react';
import { formatDecimal, formatUah } from '@/shared/lib/money';
import type { CostOfDay } from '@/entities/cost-of-day';

/**
 * §4.1 step 5: the two money identities, written from the server's figures —
 * this component adds nothing up. The parts are joined with « + » as text; the
 * totals are the server's own `basket` and `full_cost`.
 *
 * A native `<details>`: `open` follows the prop (the page opens it when a
 * check fails or the chip is clicked) and the user's own toggles are synced
 * back through `onOpenChange`. In print it opens itself on `beforeprint`
 * and restores the user's state on `afterprint`. `null` when there is no звірка to show.
 */
export function ChecksDisclosure({
  day,
  locale,
  open,
  onOpenChange,
}: {
  day: CostOfDay;
  locale: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDetailsElement>(null);
  const printing = useRef(false);

  // A closed <details> hides its body from print and CSS cannot reopen it, so
  // open it for the print and put it back after. `printing` keeps these
  // programmatic toggles from reaching `onOpenChange`.
  useEffect(() => {
    const before = () => {
      const el = ref.current;
      if (el && !el.open) {
        printing.current = true;
        el.open = true;
      }
    };
    const after = () => {
      const el = ref.current;
      if (el && printing.current) {
        el.open = open;
        // the toggle event is async; release the guard after it fired
        setTimeout(() => {
          printing.current = false;
        }, 0);
      }
    };
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', after);
    return () => {
      window.removeEventListener('beforeprint', before);
      window.removeEventListener('afterprint', after);
    };
  }, [open]);

  if (day.checks === null) return null;

  // «Кизил 50,49 + Малина 1 914,70» — each operand named by its product
  // (audit E4), so the sum reads back to the table's rows. The unit sits on
  // the total after «=», once.
  const join = (pick: (p: CostOfDay['products'][number]) => string | null) =>
    day.products
      .flatMap((p) => {
        const v = pick(p);
        return v === null ? [] : [`${p.product_name} ${formatDecimal(v, locale)}`];
      })
      .join(' + ');

  const expenses = formatUah(day.expenses_amount, locale);
  const allOk = day.checks.shares_ok && day.checks.total_ok;
  const tone = (ok: boolean) => (ok ? 'text-[var(--leaf)]' : 'text-destructive');
  const mark = (ok: boolean) =>
    ok ? (
      <CheckCircle2 aria-hidden className="mr-1 inline size-3.5" />
    ) : (
      <XCircle aria-hidden className="mr-1 inline size-3.5" />
    );
  const unweighed = day.unweighed.accrued !== '0.00';

  return (
    <details
      ref={ref}
      id="cost-checks"
      open={open}
      onToggle={(e) => {
        if (printing.current) return;
        const next = e.currentTarget.open;
        if (next !== open) onOpenChange(next);
      }}
      className="rounded-lg border border-border px-4 py-2 text-sm"
    >
      <summary className={`cursor-pointer font-medium ${tone(allOk)}`}>
        {mark(allOk)}
        {t(allOk ? 'costOfDay.status.checked' : 'costOfDay.status.mismatch')} ·{' '}
        {t('costOfDay.checks.title')}
      </summary>
      <div className="mt-2 space-y-1 tabular-nums text-muted-foreground">
        <p className={tone(day.checks.shares_ok)}>
          {mark(day.checks.shares_ok)}
          {t('costOfDay.checks.shares', {
            shares: join((p) => p.basket_share),
            basket: formatUah(day.basket, locale),
            shortfall: formatUah(day.shortfall_amount, locale),
            expenses,
          })}
        </p>
        <p className={tone(day.checks.total_ok)}>
          {mark(day.checks.total_ok)}
          {t(unweighed ? 'costOfDay.checks.totalUnweighed' : 'costOfDay.checks.total', {
            fulls: join((p) => p.full_cost),
            full: day.full_cost === null ? '—' : formatUah(day.full_cost, locale),
            unweighed: formatUah(day.unweighed.accrued, locale),
            accrued: formatUah(day.accrued, locale),
            expenses,
          })}
        </p>
      </div>
    </details>
  );
}
