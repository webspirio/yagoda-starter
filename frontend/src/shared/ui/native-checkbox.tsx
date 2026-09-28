import * as React from 'react';
import { cn } from '@/shared/lib/cn';

/**
 * Native checkbox — the checkbox counterpart of `Radio`: the browser's own control, none of the
 * Radix `Checkbox`'s bundle weight (`checkbox.tsx`). Wrap it in a `<label>` with its text.
 */
export const NativeCheckbox = React.forwardRef<HTMLInputElement, Omit<React.ComponentProps<'input'>, 'type'>>(
  function NativeCheckbox({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        type="checkbox"
        className={cn('mt-0.5 size-4 shrink-0 cursor-pointer accent-brand disabled:cursor-not-allowed', className)}
        {...props}
      />
    );
  },
);
