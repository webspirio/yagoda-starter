import { useState, type FocusEvent } from 'react';
import { parseDecimal } from '@/shared/lib/money';

interface DecimalFieldOptions {
  /** A leading minus — for the mask AND the grammar at once, so they cannot disagree. */
  allowNegative?: boolean;
  /**
   * The id of the element that renders `error`, for a field OUTSIDE `Field`:
   * then `inputProps` also carries `aria-invalid`/`aria-describedby`. Inside a
   * `Field` leave it out — `Field` hands those to the control itself, and a
   * second, `undefined` copy here would overwrite a server error's.
   */
  errorId?: string;
  /** The field's own blur work (a clamp, a canonicalisation), run after the hook's. */
  onBlur?: (event: FocusEvent<HTMLInputElement>) => void;
}

/**
 * Everything a CONTROLLED money/weight field needs around `DecimalInput` (#72),
 * in one place: the parsed value, the one shared format message, and the props
 * to spread onto the input.
 *
 * `error` waits until the operator leaves the field — «980.» on the way to
 * «980.40» is not a mistake yet, leaving the field with it is. `isMalformed`
 * does not wait: a submit button can refuse at once while the message holds.
 * Empty is neither — «not typed yet» is the form's own call.
 *
 * `register()`-based fields do not need this: `decimalRules()` is their
 * counterpart.
 */
export function useDecimalField(
  value: string,
  { allowNegative = false, errorId, onBlur }: DecimalFieldOptions = {},
) {
  const [focused, setFocused] = useState(false);
  const parsed = parseDecimal(value, { allowNegative });
  const isMalformed = value.trim() !== '' && parsed === null;
  const error = isMalformed && !focused ? 'errors.decimalFormat' : null;

  const inputProps = {
    allowNegative,
    onFocus: () => setFocused(true),
    onBlur: (event: FocusEvent<HTMLInputElement>) => {
      setFocused(false);
      onBlur?.(event);
    },
    ...(errorId
      ? {
          'aria-invalid': error ? (true as const) : undefined,
          'aria-describedby': error ? errorId : undefined,
        }
      : {}),
  };

  return { parsed, error, isMalformed, inputProps };
}
