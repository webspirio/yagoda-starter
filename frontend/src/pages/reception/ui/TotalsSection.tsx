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
  isSubmitting,
  formErrorKey,
}: {
  accrued: string | null;
  netKg: string | null;
  lineCount: number;
  debt: string | null;
  disabled: boolean;
  isSubmitting: boolean;
  formErrorKey: string | null;
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
            {accrued === null ? '—' : formatUah(accrued, locale)}
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
              <span className="font-mono">
                {formatUah(add(accrued ?? '0.00', debt), locale)}
              </span>
            </div>
          </>
        ) : null}
      </div>

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
