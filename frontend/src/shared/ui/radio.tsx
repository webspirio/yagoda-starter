import * as React from 'react';
import { cn } from '@/shared/lib/cn';

/**
 * Native radio button in the brand accent — the radio counterpart of `SelectField`: the
 * browser's own control and semantics, none of the Radix `radio-group`'s bundle weight. Wrap
 * it in a `<label>` with its text so the label is its accessible name, and give a set one
 * shared `name`.
 */
export const Radio = React.forwardRef<HTMLInputElement, Omit<React.ComponentProps<'input'>, 'type'>>(
  function Radio({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        type="radio"
        className={cn('mt-0.5 size-4 shrink-0 cursor-pointer accent-brand disabled:cursor-not-allowed', className)}
        {...props}
      />
    );
  },
);
