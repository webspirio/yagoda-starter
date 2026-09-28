import { useId, type Ref } from 'react';
import { useTranslation } from 'react-i18next';
import { NativeCheckbox } from '@/shared/ui/native-checkbox';

/** 2026-09-28: every consequence of an open-shift void, each one ticked before «Сторнувати».
 *  Native checkboxes — same bundle-ceiling reason as the radios in `PayoutDecisionField`. */
export function VoidConsequences({
  items,
  value,
  onChange,
  error,
  firstBoxRef,
}: {
  items: string[];
  value: boolean[];
  onChange: (value: boolean[]) => void;
  error?: string;
  /** RHF's `field.ref` — a failed submit focuses the first box. */
  firstBoxRef?: Ref<HTMLInputElement>;
}) {
  const { t } = useTranslation();
  const errorId = useId();
  return (
    <fieldset
      className="flex flex-col gap-2"
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? errorId : undefined}
    >
      <legend className="mb-2 text-sm font-medium">{t('void.consequences.legend')}</legend>
      {items.map((text, i) => (
        <label key={text} className="flex items-start gap-2 text-sm">
          <NativeCheckbox
            ref={i === 0 ? firstBoxRef : undefined}
            checked={value[i] ?? false}
            onChange={(e) => onChange(items.map((_, j) => (j === i ? e.target.checked : (value[j] ?? false))))}
          />
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
