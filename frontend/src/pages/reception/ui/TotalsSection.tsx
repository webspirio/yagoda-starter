import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import { Eyebrow } from '@/shared/ui/eyebrow';
import { add, cmp, formatKg, formatUah } from '@/shared/lib/money';

/**
 * «4 · Розрахунок» — what the receipt will say, and the one button that writes
 * it. `accrued` and `netKg` are the SERVER's numbers off the live preview;
 * «Разом до видачі» is the only figure added here, and it is display-only
 * (`add` over decimal strings, never a float) — no payout is written from this
 * screen, the receipt dialog offers that afterwards.
 */
export function TotalsSection({
  accrued,
  netKg,
  lineCount,
  debt,
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
  debt: string | null;
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

  const owes = debt !== null && cmp(debt, '0') === 1;

  const label =
    netKg === null
      ? t('reception.submit')
      : lineCount > 1
        ? t('reception.submitLines', { count: lineCount, kg: formatKg(netKg, locale) })
        : t('reception.submitKg', { kg: formatKg(netKg, locale) });

  return (
    <div className="border-t border-border p-4">
      <Eyebrow className="mb-2">{t('reception.totals.eyebrow')}</Eyebrow>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-3 text-sm">
          <span className="text-muted-foreground">{t('reception.totals.accrued')}</span>
          <span className="font-mono">
            {accrued === null ? (
              <span className="text-muted-foreground">{isPreviewing ? '…' : '—'}</span>
            ) : (
              formatUah(accrued, locale)
            )}
          </span>
        </div>

        {owes && debt !== null ? (
          <>
            <div className="flex items-baseline justify-between gap-3 rounded-lg bg-amber/10 px-3 py-2 text-sm">
              <span className="text-muted-foreground">{t('reception.totals.debt')}</span>
              <span className="font-mono">{formatUah(debt, locale)}</span>
            </div>
            <div className="flex items-baseline justify-between gap-3 text-sm font-medium">
              <span>{t('reception.totals.total')}</span>
              {/* Never «balance + 0,00» while the accrual is unknown: that reads
                  as a real figure and is not one. */}
              <span className="font-mono">
                {accrued === null ? (
                  <span className="text-muted-foreground">{isPreviewing ? '…' : '—'}</span>
                ) : (
                  formatUah(add(accrued, debt), locale)
                )}
              </span>
            </div>
          </>
        ) : null}
      </div>

      {showDraftHint ? (
        <p className="mt-3 text-xs text-muted-foreground">{t('reception.lines.draftHint')}</p>
      ) : null}

      {formErrorKey ? (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {t(formErrorKey)}
        </p>
      ) : null}

      <Button type="submit" className="mt-4 h-14 w-full text-base" disabled={disabled || isSubmitting}>
        {label}
      </Button>
    </div>
  );
}
