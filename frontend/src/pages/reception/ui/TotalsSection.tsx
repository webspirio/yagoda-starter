import type { ReactNode } from 'react';
import { Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import { Field } from '@/shared/ui/field';
import { DecimalInput } from '@/shared/ui/decimal-input';
import { useDecimalField } from '@/shared/ui/use-decimal-field';
import { cn } from '@/shared/lib/cn';
import {
  clampDecimal,
  cmp,
  floorToHundreds,
  formatKg,
  formatUah,
  parseDecimal,
  sub,
} from '@/shared/lib/money';
import { suggestedPaid, totalToPay } from '../lib/suggestedPaid';

/**
 * «Розрахунок» — the SAME action as «Прийняти» now also hands over cash
 * (§2.1 ⑥, §3.1, §3.6): the operator sees what accrues today, what carries
 * in from a previous visit, and types (or picks with a chip) what actually
 * leaves the drawer. Every figure but the typed «Видано готівкою» is the
 * SERVER's — `accrued`/`netKg` off the live preview, `debt`/`cash` off their
 * own reads — this component only ADDS decimal STRINGS for display
 * (`@/shared/lib/money`'s `totalToPay`/`suggestedPaid`, never a float), and
 * never writes anything itself: the submit button is a plain
 * `type="submit"` inside the page's own `<form>`.
 */
export function TotalsSection({
  accrued,
  netKg,
  lineCount,
  debt,
  credit,
  cash,
  cashUnavailable,
  paid,
  onPaidChange,
  paidError,
  disabled,
  isPreviewing,
  isSubmitting,
  formErrorKey,
  formErrorParams,
  showDraftHint,
  crateReturn,
}: {
  /** `null` unless the preview has SETTLED on the form as it stands now. */
  accrued: string | null;
  netKg: string | null;
  lineCount: number;
  /** Supplier balance — only a POSITIVE one is carried into the total. */
  debt: string | null;
  /** The POSITIVE amount of a negative balance (we overpaid), else `null`.
   *  Shown below «Разом», never added to it (§3.5/§3.8). */
  credit: string | null;
  /** `GET /point-cash/:id`'s `.cash` — the drawer for berries. `null` means
   *  UNKNOWN (still loading OR errored), never an empty drawer. */
  cash: string | null;
  /** True only once the point-cash query has ERRORED — not while it is
   *  merely loading. Caps `paid` at the total instead of the drawer, drops
   *  the cash note, and shows a muted hint that the server still checks the
   *  real ceiling when the receipt is recorded. */
  cashUnavailable: boolean;
  /** The value shown in «Видано готівкою» — the caller owns it (controlled). */
  paid: string;
  onPaidChange: (v: string) => void;
  /** i18n key from `apiErrorToFields`, if the last submit was refused on this field. */
  paidError: string | null;
  disabled: boolean;
  /** The numbers are being (re)computed — «…» rather than a bare dash. */
  isPreviewing: boolean;
  isSubmitting: boolean;
  formErrorKey: string | null;
  formErrorParams?: Record<string, number>;
  /** «Ще позиція» left an empty draft behind — nudges the operator toward
   *  finishing it or using `LineEditor`'s «Прибрати позицію» escape hatch,
   *  rather than leaving a dark submit button unexplained. */
  showDraftHint: boolean;
  /** The crate-return field, rendered after the cash note, before the hint. */
  crateReturn?: ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? 'uk';

  const carried = debt !== null && cmp(debt, '0') === 1 ? debt : '0.00';
  const total = totalToPay(accrued, debt);
  const drawer = cash !== null && cmp(cash, '0') === 1 ? cash : '0.00';
  // The cash-capped total — same helper the page uses for the default, so
  // the cap here and the suggestion there can never drift apart.
  const cap = total === null ? null : suggestedPaid(accrued, debt, cash);
  const paidField = useDecimalField(paid, {
    onBlur: () => {
      if (cap === null) return;
      // I5: canonicalise BEFORE validity — a trailing separator («1200,») is
      // not yet a well-formed decimal, but it IS one with that one character
      // stripped.
      const stripped = parseDecimal(paid.replace(/[.,]$/, ''));
      if (stripped === null) return; // leave the text as typed
      const canonical = clampDecimal(stripped, '0.00', cap);
      // I4: idempotent — tabbing through an already-canonical value must not
      // latch `paidTouched` on the caller's side by calling back with the same
      // string.
      if (canonical !== paid) onPaidChange(canonical);
    },
  });
  const paidParsed = paidField.parsed;
  const paidValid = paidParsed !== null;
  const paidValue = paidParsed ?? '0.00';
  const remainder = total === null ? null : sub(total, paidValue);
  const owed = remainder !== null && cmp(remainder, '0') === 1;
  const overCap = cap !== null && paidValid && cmp(paidValue, cap) === 1;
  // `cash === null` means the cap is the TOTAL (see `suggestedPaid`), not the
  // drawer — nothing here is "limited by cash" when there is no cash figure
  // to limit by.
  const limitedByCash = cash !== null && total !== null && cmp(total, drawer) === 1;
  // The mock's «Більше за РАЗОМ…» copy only makes sense when the cap IS the
  // total; once the drawer is what actually limits the payout, the clamp note
  // has to say so instead (M2).
  const overCapKey = limitedByCash ? 'reception.totals.overCash' : 'reception.totals.overCap';
  // #72 — «Видано готівкою» is never sent while unparsable (`toCreateBody`),
  // so the server can never say so; the field says it itself, with the one
  // shared message. Empty is not an error here: it means «nothing paid out».
  // It waits until the operator leaves the field — «1200.» mid-keystroke is
  // not a mistake yet (`useDecimalField`).
  const formatError = paidField.error ?? undefined;
  const settle = (v: string) => onPaidChange(v);
  // The unavailable-drawer note takes the Field hint slot over the over-cap
  // one — a failed read is the more important thing to say, and `overCap`
  // can't itself be about cash while `cashUnavailable` holds (the cap is the
  // total, per `suggestedPaid`).
  const fieldHint = cashUnavailable
    ? t('reception.totals.cashUnavailable')
    : overCap
      ? t(overCapKey, { uah: formatUah(cap ?? '0', locale) })
      : undefined;

  const label =
    netKg !== null && paidValid && cmp(paidValue, '0') === 1
      ? t('reception.submitPay', {
          lines: lineCount > 1 ? t('reception.linesPart', { count: lineCount }) : '',
          kg: formatKg(netKg, locale),
          uah: formatUah(paidValue, locale),
        })
      : netKg === null
        ? t('reception.submit')
        : lineCount > 1
          ? t('reception.submitLines', { count: lineCount, kg: formatKg(netKg, locale) })
          : t('reception.submitKg', { kg: formatKg(netKg, locale) });

  const remainderText =
    total === null
      ? // M1: neither «Розраховано повністю» nor a remainder claims
        // anything about a total that has not settled yet.
        '—'
      : owed && remainder !== null
        ? t('reception.totals.remainderLine', { uah: formatUah(remainder, locale) })
        : t('reception.totals.settled');

  return (
    // «Розрахунок» is the card's accessible name (a labelled `section` is a
    // region landmark), no longer a visible eyebrow — 23 px the 650 px
    // budget could not spare (spec §5.1).
    // Three groups, read top to bottom: what is owed (the ledger and its
    // «Разом»), what is handed over now (the field and its chips), then what
    // that leaves and the button. Body text is 14–16 px throughout — the
    // operator reads this card at arm's length while counting cash.
    <section aria-label={t('reception.totals.eyebrow')} className="flex flex-col gap-4 p-4">
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-3 text-base">
          <span className="text-muted-foreground">
            {t('reception.totals.accruedToday')}
            {lineCount > 1 ? t('reception.totals.linesSuffix', { count: lineCount }) : ''}
          </span>
          <span className="font-mono font-medium">
            {accrued === null ? (
              <span className="text-muted-foreground">{isPreviewing ? '…' : '—'}</span>
            ) : (
              formatUah(accrued, locale)
            )}
          </span>
        </div>

        {cmp(carried, '0') === 1 ? (
          <div className="flex items-baseline justify-between gap-3 text-base">
            <span className="text-muted-foreground">{t('reception.totals.debt')}</span>
            <span className="font-mono font-medium text-amber">+ {formatUah(carried, locale)}</span>
          </div>
        ) : null}

        <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-t border-border pt-3">
          <span className="text-base font-semibold">{t('reception.totals.total')}</span>
          <span className="font-mono text-3xl leading-none font-semibold tracking-tight">
            {total === null ? (
              <span className="text-base text-muted-foreground">{isPreviewing ? '…' : '—'}</span>
            ) : (
              formatUah(total, locale)
            )}
          </span>
        </div>

        {credit !== null ? (
          // §3.5/§3.8: a negative balance is never added to «Разом» — it is
          // shown below it, in green, as information.
          <p className="text-sm text-leaf">
            {t('reception.supplier.credit', { uah: formatUah(credit, locale) })}
          </p>
        ) : null}
      </div>

      <Field
        size="large"
        name="paid_amount"
        label={t('reception.totals.paid')}
        error={paidError ?? formatError}
        hint={fieldHint}
        hintTone={overCap && !cashUnavailable ? 'warning' : undefined}
      >
        {(a11y) => (
          <>
            <div className="relative">
              <DecimalInput
                {...a11y}
                className="h-12 pr-10 font-mono text-2xl font-semibold"
                value={paid}
                onChange={(e) => onPaidChange(e.target.value)}
                {...paidField.inputProps}
              />
              <span className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 font-mono text-base text-muted-foreground">
                ₴
              </span>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2">
              <Button
                type="button"
                variant="outline"
                className="h-9 px-2 text-sm"
                onClick={() => settle(cap ?? '0')}
              >
                {t('reception.totals.all')}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-9 px-2 text-sm"
                disabled={cap === null || cmp(cap, '100') === -1}
                onClick={() => settle(floorToHundreds(cap ?? '0'))}
              >
                {t('reception.totals.toHundreds')}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-9 px-2 text-sm"
                onClick={() => settle('0')}
              >
                {t('reception.totals.allToBalance')}
              </Button>
            </div>
          </>
        )}
      </Field>

      {/* Wraps rather than truncates: what is left owed is the one sentence
          the operator says out loud to the supplier. */}
      <div
        data-testid="remainder-row"
        className={cn(
          'rounded-lg px-3 py-2 text-sm leading-snug font-medium',
          total === null
            ? 'bg-muted/50 text-muted-foreground'
            : owed
              ? 'bg-amber/10 text-amber'
              : 'bg-leaf/10 text-leaf',
        )}
      >
        {remainderText}
      </div>

      {limitedByCash ? (
        <p className="rounded-lg bg-amber/10 px-3 py-2 text-sm leading-snug text-amber">
          {t('reception.totals.cashNote', { uah: formatUah(drawer, locale) })}
        </p>
      ) : null}

      {crateReturn}

      {showDraftHint ? (
        <p className="text-sm text-muted-foreground">{t('reception.lines.draftHint')}</p>
      ) : null}

      {formErrorKey ? (
        <p role="alert" className="text-sm text-destructive">
          {t(formErrorKey, formErrorParams)}
        </p>
      ) : null}

      {/* The label carries the payout sum, so it wraps inside the button
          rather than running past the ~355 px card — never truncated. */}
      <Button
        type="submit"
        className="h-auto min-h-12 w-full py-2 text-center text-base leading-tight font-semibold whitespace-normal"
        disabled={disabled || isSubmitting}
      >
        <Check className="size-5" />
        {label}
      </Button>
    </section>
  );
}
