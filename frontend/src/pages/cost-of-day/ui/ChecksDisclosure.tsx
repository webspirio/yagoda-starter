import { Fragment, useEffect, useRef, type ReactNode } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { CheckCircle2, XCircle } from 'lucide-react';
import { formatUah, unbreakable } from '@/shared/lib/money';
import type { CostOfDay } from '@/entities/cost-of-day';
import { DAY, TOTAL, UNWEIGHED, rowId } from './trace-ids';
import { ShortfallTerm, Term } from './terms';

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

  const uah = (v: string) => unbreakable(formatUah(v, locale));
  type Product = CostOfDay['products'][number];
  // «Кизил 50,49 ₴ + Малина 1 914,70 ₴» — each operand named by its product
  // (audit E4), so the sum reads back to the table's rows, and each carries
  // its ₴ like every other figure in a formula (2026-10-24). Neither a share
  // nor a повна вартість has a column of its own, so each points at the
  // cells of its row it is made of (`shared/ui/trace`).
  const join = (
    pick: (p: Product) => string | null,
    term: (p: Product, figure: string) => ReactNode,
  ) => (
    <>
      {day.products
        .flatMap((p) => {
          const v = pick(p);
          return v === null ? [] : [{ p, v }];
        })
        .map(({ p, v }, i) => (
          <Fragment key={p.product_id}>
            {i > 0 ? ' + ' : null}
            {p.product_name} {term(p, uah(v))}
          </Fragment>
        ))}
    </>
  );
  const shareRefs = (p: Product) => [
    rowId(p.product_id, 'baseKg'),
    rowId(p.product_id, 'shortfallPerKg'),
    rowId(p.product_id, 'expensesPerKg'),
  ];
  const share = (p: Product, figure: string) => (
    <Term refs={shareRefs(p)} hint={t('costOfDay.trace.share', { row: p.product_name })}>
      {figure}
    </Term>
  );
  const full = (p: Product, figure: string) => (
    <Term
      refs={[rowId(p.product_id, 'accrued'), rowId(p.product_id, 'shortfall'), ...shareRefs(p)]}
      tone="leaf"
      hint={t('costOfDay.trace.full', { row: p.product_name })}
    >
      {figure}
    </Term>
  );

  const expenses = uah(day.expenses_amount);
  const expensesTerm = (
    <Term refs={DAY.expenses} tone="plum" hint={t('costOfDay.trace.expenses')} />
  );
  const totalHint = (columnKey: string) =>
    t('costOfDay.trace.cell', { column: t(columnKey), row: t('costOfDay.table.total') });
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
          <Trans
            t={t}
            i18nKey="costOfDay.checks.shares"
            values={{
              basket: uah(day.basket),
              shortfall: uah(day.shortfall_amount),
              expenses,
            }}
            components={{
              shares: join((p) => p.basket_share, share),
              basket: (
                <Term refs={[TOTAL.shortfall, DAY.expenses]} hint={t('costOfDay.trace.basket')} />
              ),
              shortfall: (
                <ShortfallTerm
                  refs={TOTAL.shortfall}
                  hint={totalHint('costOfDay.table.ownShortfall')}
                />
              ),
              expenses: expensesTerm,
            }}
          />
        </p>
        <p className={tone(day.checks.total_ok)}>
          {mark(day.checks.total_ok)}
          <Trans
            t={t}
            i18nKey={unweighed ? 'costOfDay.checks.totalUnweighed' : 'costOfDay.checks.total'}
            values={{
              full: day.full_cost === null ? '—' : uah(day.full_cost),
              unweighed: uah(day.unweighed.accrued),
              accrued: uah(day.accrued),
              expenses,
            }}
            components={{
              fulls: join((p) => p.full_cost, full),
              full: (
                <Term
                  refs={[TOTAL.accrued, DAY.expenses]}
                  tone="leaf"
                  hint={t('costOfDay.trace.dayFull')}
                />
              ),
              unweighed: (
                <Term
                  refs={UNWEIGHED.accrued}
                  tone="sky"
                  hint={t('costOfDay.trace.unweighed', { column: t('costOfDay.table.accrued') })}
                />
              ),
              // The day's whole нараховано is the total row's when nothing is
              // left unweighed, and that plus the «не перезважено» rows otherwise.
              accrued: (
                <Term
                  refs={unweighed ? [TOTAL.accrued, UNWEIGHED.accrued] : TOTAL.accrued}
                  tone="sky"
                  hint={
                    unweighed
                      ? t('costOfDay.trace.dayAccrued')
                      : totalHint('costOfDay.table.accrued')
                  }
                />
              ),
              expenses: expensesTerm,
            }}
          />
        </p>
      </div>
    </details>
  );
}
