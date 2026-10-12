import { useState } from 'react';

/**
 * Whether a decimal field is being typed in right now — so a form can hold its
 * format error back until the operator leaves the field (#72): «980.» on the
 * way to «980.40» is not a mistake yet, leaving the field with it is. Spread
 * `focusProps` onto the `DecimalInput` (compose with your own `onBlur` if you
 * have one). A blocked submit button can stay live; only the message waits.
 */
export function useFieldFocus() {
  const [focused, setFocused] = useState(false);
  return {
    focused,
    focusProps: { onFocus: () => setFocused(true), onBlur: () => setFocused(false) },
  };
}
