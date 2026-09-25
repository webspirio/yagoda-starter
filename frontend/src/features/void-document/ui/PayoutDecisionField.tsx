import { useTranslation } from 'react-i18next';
import { RadioGroup, RadioGroupItem } from '@/shared/ui/radio-group';
import { formatUah, isZero } from '@/shared/lib/money';
import type { PayoutDecision } from '../api/useVoidDocument';

export interface LinkedPayout {
  code: string;
  amount: string;
  /** Null while the settlement loads — the line is then simply absent. */
  otherCovered: string | null;
}

/** #125: what happens to the payout issued with the receipt. No default on purpose. */
export function PayoutDecisionField({
  payout,
  canConfirmReturn,
  value,
  onChange,
  error,
}: {
  payout: LinkedPayout;
  canConfirmReturn: boolean;
  value: PayoutDecision | undefined;
  onChange: (value: PayoutDecision) => void;
  error?: string;
}) {
  const { t, i18n } = useTranslation();
  const money = (v: string) => formatUah(v, i18n.resolvedLanguage);
  const options: PayoutDecision[] = canConfirmReturn ? ['keep', 'void', 'void_returned'] : ['keep', 'void'];
  const labelKey = { keep: 'keep', void: 'void', void_returned: 'voidReturned' } as const;

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-2 text-sm font-medium">
        {t('void.payout.legend', { code: payout.code, amount: money(payout.amount) })}
      </legend>
      <RadioGroup value={value ?? ''} onValueChange={(v) => onChange(v as PayoutDecision)}>
        {options.map((option) => (
          <label key={option} className="flex items-start gap-2 text-sm">
            <RadioGroupItem value={option} />
            {t(`void.payout.${labelKey[option]}`)}
          </label>
        ))}
      </RadioGroup>
      {value === 'void' ? (
        <p className="text-sm text-amber">{t('void.payout.cashWarning', { amount: money(payout.amount) })}</p>
      ) : null}
      {payout.otherCovered && !isZero(payout.otherCovered) ? (
        <p className="text-sm text-muted-foreground">
          {t('void.payout.otherCovered', { amount: money(payout.otherCovered) })}
        </p>
      ) : null}
      {error ? <p className="text-sm text-destructive">{t(error)}</p> : null}
    </fieldset>
  );
}
