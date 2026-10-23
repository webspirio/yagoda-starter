import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { formatUah } from '@/shared/lib/money';
import type { CostOfDay } from '@/entities/cost-of-day';

/**
 * §4.1 step 5: the two money identities, written from the server's figures —
 * this component adds nothing up. The parts are joined with « + » as text; the
 * totals are the server's own `basket` and `full_cost`.
 *
 * A native `<details>`: `open` follows the prop (the page opens it when a
 * check fails or the chip is clicked) and the user's own toggles are synced
 * back through `onOpenChange`. In print the body is shown whether or not the
 * element is open. `null` when there is no звірка to show.
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

  const join = (parts: (string | null)[]) =>
    parts
      .filter((p): p is string => p !== null)
      .map((p) => formatUah(p, locale))
      .join(' + ');

  const expenses = formatUah(day.expenses_amount, locale);
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
      <summary className="cursor-pointer font-medium text-[var(--leaf)]">
        {t('costOfDay.status.checked')} · {t('costOfDay.checks.title')}
      </summary>
      <div className="mt-2 space-y-1 tabular-nums text-muted-foreground">
        <p>
          {t('costOfDay.checks.shares', {
            shares: join(day.products.map((p) => p.basket_share)),
            basket: formatUah(day.basket, locale),
            shortfall: formatUah(day.shortfall_amount, locale),
            expenses,
          })}
        </p>
        <p>
          {t(unweighed ? 'costOfDay.checks.totalUnweighed' : 'costOfDay.checks.total', {
            fulls: join(day.products.map((p) => p.full_cost)),
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
