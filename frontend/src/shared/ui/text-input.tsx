import * as React from 'react';
import { cn } from '@/shared/lib/cn';
import { fieldBaseClass, fieldGhostClass } from './field';

const datetimeLocalClasses = [
  'appearance-none',
  '[&::-webkit-datetime-edit]:p-0',
  '[&::-webkit-datetime-edit-fields-wrapper]:p-0',
  '[&::-webkit-calendar-picker-indicator]:m-0',
];

export interface TextInputProps extends React.ComponentProps<'input'> {
  /**
   * `default` is the prototype `.fld` box. `ghost` is for controls nested in an
   * already-bordered surface (inline rename rows) — same 16px iOS no-zoom floor
   * and focus ring, no chrome. Route every text control through here rather
   * than hand-rolling an `<input>`, or the 16px floor gets lost (see
   * `fieldTextClass` in `field.tsx`).
   */
  variant?: 'default' | 'ghost';
}

/** Text input styled to the prototype `.fld`. Forwards ref so RHF `register` works. */
export const TextInput = React.forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { className, type = 'text', variant = 'default', ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      type={type}
      className={cn(
        variant === 'ghost' ? fieldGhostClass : cn(fieldBaseClass, 'h-[46px]'),
        type === 'datetime-local' && datetimeLocalClasses,
        className,
      )}
      {...props}
    />
  );
});
