import { SlidersHorizontal } from 'lucide-react';
import { cn, focusRing } from '@/shared/lib/cn';

/**
 * The app's one filter affordance: a round icon button badged with how many
 * filters are active. Shared by every list view, so "where do I change what
 * I'm seeing" looks the same everywhere.
 *
 * It sits to the right of a search field so the two filtering affordances read
 * as one row; sized to the field's 46px height rather than the bare 44px
 * minimum so the row lines up.
 *
 * `label` arrives already resolved rather than translated here: this lives in
 * `shared/`, which has no business knowing a caller's i18n namespace. It is the
 * button's ONLY accessible name — the badge is `aria-hidden` decoration — so
 * the caller must fold the count into it, or the count never reaches a screen
 * reader.
 */
export function FilterButton({
  onClick,
  activeCount,
  label,
}: {
  onClick: () => void;
  activeCount: number;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        'relative grid size-[46px] shrink-0 place-items-center rounded-full border border-border bg-card',
        focusRing,
      )}
    >
      <SlidersHorizontal className="size-[18px]" aria-hidden />
      {activeCount > 0 && (
        <span
          aria-hidden
          className="absolute -right-1 -top-1 grid min-w-[18px] place-items-center rounded-full border-2 border-background bg-primary px-1 text-[11px] font-bold leading-[14px] text-primary-foreground"
        >
          {activeCount}
        </span>
      )}
    </button>
  );
}
