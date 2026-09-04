import * as React from 'react';
import { cn, focusRing } from '@/shared/lib/cn';

const CHIP_BASE = cn(
  'inline-flex items-center h-[34px] px-3 rounded-full text-[13px] font-semibold',
  'whitespace-nowrap cursor-pointer select-none border transition-colors',
  // `ChipProps extends ComponentProps<'button'>`, so callers can pass
  // `disabled` — a filter chip group does this while its default is still
  // loading. The native attribute blocks the click on its own; without this
  // the chip stays fully lit and reads as tappable while silently doing
  // nothing.
  'disabled:cursor-not-allowed disabled:opacity-50',
  focusRing,
);

interface ChipProps extends React.ComponentProps<'button'> {
  selected?: boolean;
  /** 'create' renders the dashed brand "add new" affordance. */
  variant?: 'default' | 'create';
}

/**
 * Pill chip matching the prototype `.chip` (toggle + "create" states).
 *
 * `selected` drives `aria-pressed` as well as the styling — class-only
 * selection is invisible to assistive tech. The "create" variant is an action,
 * not a toggle, so it carries no pressed state. Callers that need radio
 * semantics override `role`/`aria-checked` via props.
 *
 * Forwards its ref to the `<button>` so a chip group can move DOM focus to the
 * newly-active chip on arrow-key navigation (WAI-ARIA roving tabindex).
 */
export const Chip = React.forwardRef<HTMLButtonElement, ChipProps>(function Chip(
  { selected, variant = 'default', className, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-pressed={variant === 'create' ? undefined : Boolean(selected)}
      className={cn(
        CHIP_BASE,
        variant === 'create'
          ? 'border-dashed border-brand bg-transparent text-brand'
          : selected
            ? 'border-transparent bg-foreground text-background'
            : 'border-input bg-card text-muted2 hover:border-line2',
        className,
      )}
      {...props}
    />
  );
});
