import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import type { UseFormRegisterReturn } from 'react-hook-form';
import { NativeCheckbox } from '@/shared/ui/native-checkbox';

/** 2026-09-28: every consequence of an open-shift void, each one ticked before «Сторнувати».
 *  Native checkboxes — same bundle-ceiling reason as the radios in `PayoutDecisionField`. */
export function VoidConsequences({
  items,
  box,
  error,
}: {
  items: string[];
  /** RHF's `register` for box `i` — a failed submit focuses the first unticked one. */
  box: (i: number) => UseFormRegisterReturn;
  error?: string;
}) {
  const { t } = useTranslation();
  const errorId = useId();
  return (
    <fieldset
      className="flex flex-col gap-2"
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? errorId : undefined}
    >
      <legend className="mb-2 text-sm font-medium">{t('void.ack.legend')}</legend>
      {items.map((text, i) => (
        <label key={text} className="flex items-start gap-2 text-sm">
          <NativeCheckbox {...box(i)} />
          {text}
        </label>
      ))}
      {error ? (
        <p id={errorId} className="text-sm text-destructive">
          {t(error)}
        </p>
      ) : null}
    </fieldset>
  );
}
