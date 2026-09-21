import { Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import { Eyebrow } from '@/shared/ui/eyebrow';
import { TextInput } from '@/shared/ui/text-input';
import { cn } from '@/shared/lib/cn';
import {
  clampDecimal,
  cmp,
  DECIMAL_INPUT,
  floorToHundreds,
  formatKg,
  formatUah,
  maskDecimalInput,
  normalizeAmount,
  sub,
} from '@/shared/lib/money';
import { suggestedPaid, totalToPay } from '../lib/suggestedPaid';

/**
 * «4 · Розрахунок» — the SAME action as «Прийняти» now also hands over cash
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
  cash,
  paid,
  onPaidChange,
  paidError,
  disabled,
  isPreviewing,
  isSubmitting,
  formErrorKey,
  showDraftHint,
}: {
  /** `null` unless the preview has SETTLED on the form as it stands now. */
  accrued: string | null;
  netKg: string | null;
  lineCount: number;
  /** Supplier balance — only a POSITIVE one is carried into the total. */
  debt: string | null;
  /** `GET /point-cash/:id`'s `.cash` — the drawer for berries. */
  cash: string | null;
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
  /** «Ще позиція» left an empty draft behind — nudges the operator toward
   *  finishing it or using `LineEditor`'s «Прибрати позицію» escape hatch,
   *  rather than leaving a dark submit button unexplained. */
  showDraftHint: boolean;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? 'uk';

  const carried = debt !== null && cmp(debt, '0') === 1 ? debt : '0.00';
  const total = totalToPay(accrued, debt);
  const drawer = cash !== null && cmp(cash, '0') === 1 ? cash : '0.00';
  // The cash-capped total — same helper the page uses for the default, so
  // the cap here and the suggestion there can never drift apart.
  const cap = total === null ? null : suggestedPaid(accrued, debt, cash);
  const paidNormalized = normalizeAmount(paid);
  const paidValid = DECIMAL_INPUT.test(paidNormalized);
  const paidValue = paidValid ? paidNormalized : '0.00';
  const remainder = total === null ? null : sub(total, paidValue);
  const owed = remainder !== null && cmp(remainder, '0') === 1;
  const overCap = cap !== null && paidValid && cmp(paidValue, cap) === 1;
  const limitedByCash = total !== null && cmp(total, drawer) === 1;
  const settle = (v: string) => onPaidChange(v);

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

  return (
    <div className="border-t border-border p-4">
      <Eyebrow className="mb-2">{t('reception.totals.eyebrow')}</Eyebrow>

      <div className="grid gap-4 sm:grid-cols-[minmax(0,1.15fr)_minmax(220px,0.85fr)]">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="text-muted-foreground">
              {t('reception.totals.accruedToday')}
              {lineCount > 1 ? t('reception.totals.linesSuffix', { count: lineCount }) : ''}
            </span>
            <span className="font-mono">
              {accrued === null ? (
                <span className="text-muted-foreground">{isPreviewing ? '…' : '—'}</span>
              ) : (
                formatUah(accrued, locale)
              )}
            </span>
          </div>

          {cmp(carried, '0') === 1 ? (
            <div className="flex items-center justify-between gap-3 rounded-lg bg-amber/10 px-3 py-2 text-sm">
              <span className="text-muted-foreground">{t('reception.totals.debt')}</span>
              <span className="font-mono">+ {formatUah(carried, locale)}</span>
            </div>
          ) : null}

          <div className="my-1 border-t border-foreground/20" />

          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <Eyebrow>{t('reception.totals.total')}</Eyebrow>
            <span className="font-mono text-[34px] leading-none font-semibold tracking-tight">
              {total === null ? (
                <span className="text-base text-muted-foreground">{isPreviewing ? '…' : '—'}</span>
              ) : (
                formatUah(total, locale)
              )}
            </span>
          </div>

          <div className="mt-2 grid gap-1.5">
            <span className="text-xs text-muted-foreground">{t('reception.totals.paid')}</span>
            <div className="relative">
              <TextInput
                inputMode="decimal"
                className="h-12 pr-9 font-mono text-xl font-semibold"
                value={paid}
                onChange={(e) => onPaidChange(maskDecimalInput(e.target.value))}
                onBlur={() => {
                  if (cap !== null && paidValid) onPaidChange(clampDecimal(paidValue, '0.00', cap));
                }}
                aria-label={t('reception.totals.paid')}
              />
              <span className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 font-mono text-sm text-muted-foreground">
                ₴
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              <Button type="button" variant="outline" size="sm" onClick={() => settle(cap ?? '0')}>
                {t('reception.totals.all')}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={cap === null || cmp(cap, '100') === -1}
                onClick={() => settle(floorToHundreds(cap ?? '0'))}
              >
                {t('reception.totals.toHundreds')}
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => settle('0')}>
                {t('reception.totals.allToBalance')}
              </Button>
            </div>
            {overCap ? (
              <p className="text-xs text-amber">
                {t('reception.totals.overCap', { uah: formatUah(cap ?? '0', locale) })}
              </p>
            ) : null}
            {paidError ? (
              <p role="alert" className="text-sm text-destructive">
                {t(paidError)}
              </p>
            ) : null}
          </div>
        </div>

        <div
          className={cn(
            'flex flex-col justify-center rounded-lg px-4 py-3',
            owed ? 'bg-amber/10' : 'bg-leaf/10',
          )}
        >
          <Eyebrow>{owed ? t('reception.totals.remainder') : t('reception.totals.settled')}</Eyebrow>
          <div className={cn('mt-1 font-mono text-2xl font-semibold', owed ? 'text-amber' : 'text-leaf')}>
            {owed && remainder !== null ? formatUah(remainder, locale) : formatUah('0.00', locale)}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {owed ? t('reception.totals.remainderHint') : t('reception.totals.settledHint')}
          </div>
        </div>
      </div>

      {limitedByCash ? (
        <p className="mt-3 rounded-lg bg-amber/10 px-3 py-2 text-xs leading-relaxed text-amber">
          {t('reception.totals.cashNote', { uah: formatUah(drawer, locale) })}
        </p>
      ) : null}

      {showDraftHint ? (
        <p className="mt-3 text-xs text-muted-foreground">{t('reception.lines.draftHint')}</p>
      ) : null}

      {formErrorKey ? (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {t(formErrorKey)}
        </p>
      ) : null}

      <Button type="submit" className="mt-4 h-14 w-full text-base" disabled={disabled || isSubmitting}>
        <Check className="size-5" />
        {label}
      </Button>
    </div>
  );
}
