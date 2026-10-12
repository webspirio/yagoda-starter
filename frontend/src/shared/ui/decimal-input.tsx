import * as React from 'react';
import { maskDecimalInput } from '@/shared/lib/money';
import { TextInput, type TextInputProps } from './text-input';

export interface DecimalInputProps extends Omit<TextInputProps, 'type' | 'inputMode'> {
  /** Lets a leading minus through the mask — reception's surcharge only. */
  allowNegative?: boolean;
}

/**
 * The ONE money/weight field (#72). The mask runs on every change, typed or
 * pasted, so the field never holds a space, a letter or a second separator —
 * what the operator sees is exactly what gets saved. It writes the masked text
 * back only when it differs, so ordinary keystrokes keep the caret, then hands
 * the event on, so it works with RHF `register` and with a controlled `value`
 * alike. Validation is the form's: `decimalRules()` or `parseDecimal`.
 */
export const DecimalInput = React.forwardRef<HTMLInputElement, DecimalInputProps>(
  function DecimalInput({ allowNegative = false, onChange, ...props }, ref) {
    return (
      <TextInput
        ref={ref}
        autoComplete="off"
        {...props}
        type="text"
        inputMode="decimal"
        onChange={(e) => {
          const masked = maskDecimalInput(e.target.value, { allowNegative });
          if (masked !== e.target.value) e.target.value = masked;
          onChange?.(e);
        }}
      />
    );
  },
);
