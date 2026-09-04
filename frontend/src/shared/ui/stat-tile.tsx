import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn, focusRing } from '@/shared/lib/cn';
import { Card } from '@/shared/ui/card';

const tileVariants = cva('flex flex-col items-center gap-1', {
  variants: { size: { default: 'py-5', compact: 'py-4' } },
  defaultVariants: { size: 'default' },
});

const valueVariants = cva('font-extrabold text-brand', {
  variants: { size: { default: 'text-[26px]', compact: 'text-2xl' } },
  defaultVariants: { size: 'default' },
});

const labelVariants = cva('text-muted-foreground', {
  variants: {
    size: { default: 'text-xs', compact: 'text-center text-[11px] font-semibold' },
  },
  defaultVariants: { size: 'default' },
});

interface StatTileBaseProps extends VariantProps<typeof tileVariants> {
  value: React.ReactNode;
  label: React.ReactNode;
  /**
   * Styles the TILE, not necessarily the root DOM node: in `<div>` mode
   * (no `onClick`) it lands on that div, unchanged from before. In button
   * mode it lands on the inset inner wrapper — the content box — not on the
   * outer `<button>`, because once a button wraps the tile, the inner box is
   * the tile and the button is a tap-target shell the caller never asked to
   * style. A margin/width/ring/background utility here follows the content,
   * not the full-bleed grid cell; see `stat-tile.test.tsx`'s
   * `className placement` tests, which pin both modes.
   */
  className?: string;
  labelClassName?: string;
}

/**
 * `onClick` and `ariaLabel` travel together — this union makes passing one
 * without the other a compile error. The primitive has only `ReactNode`s for
 * `value`/`label` and cannot interpolate them into a sentence, so the caller
 * composes the accessible name itself, in **label-then-value** order (e.g.
 * "Tasks completed: 9") — pin this order at every call site.
 */
export type StatTileProps =
  | (StatTileBaseProps & { onClick?: undefined; ariaLabel?: undefined })
  | (StatTileBaseProps & { onClick: () => void; ariaLabel: string });

/**
 * Without `onClick` this renders exactly what it always has — a `<div>`, no
 * new wrapper, no new ARIA. **That path must never change**: every caller
 * that renders a read-only stat relies on it staying byte-identical.
 *
 * With `onClick` it becomes a 44px `<button>` — a number that is itself
 * interactive (e.g. drills into a detail view) must read as a control, not a
 * label. The press highlight (`active:bg-muted`) lives on an INNER
 * `rounded-xl` wrapper, inset from the button's own edges via `mx-1` — never
 * on the `<button>` itself — because `StatGrid` is a `Card` with
 * `divide-x divide-border` (`:52`), and a highlight painted to the button's
 * full-bleed edge would land ON that divider line instead of stopping short
 * of it.
 */
export function StatTile(props: StatTileProps) {
  const { value, label, size, className, labelClassName } = props;

  if (!props.onClick) {
    return (
      <div data-slot="stat-tile" className={cn(tileVariants({ size }), className)}>
        <span className={valueVariants({ size })}>{value}</span>
        <span className={cn(labelVariants({ size }), labelClassName)}>{label}</span>
      </div>
    );
  }

  const { onClick, ariaLabel } = props;

  return (
    <button
      type="button"
      data-slot="stat-tile"
      aria-label={ariaLabel}
      onClick={onClick}
      className={cn('min-h-[44px] w-full', focusRing)}
    >
      {/* This inner span is where `className` lands in button mode (see the
          prop's doc comment): it styles the tile's content box, not the
          full-bleed `<button>` tap target above it. */}
      <span
        className={cn(
          tileVariants({ size }),
          'mx-1 rounded-xl active:bg-muted',
          className,
        )}
      >
        <span className={valueVariants({ size })}>{value}</span>
        <span className={cn(labelVariants({ size }), labelClassName)}>{label}</span>
      </span>
    </button>
  );
}

// Static map — never interpolate `grid-cols-${columns}` (Tailwind's scanner
// would not see it, so the utility would be missing from the built CSS).
const COLUMNS_CLASS = { 2: 'grid-cols-2', 3: 'grid-cols-3' } as const;

interface StatGridProps extends React.ComponentProps<'div'> {
  columns: 2 | 3;
}

export function StatGrid({ columns, className, ...props }: StatGridProps) {
  return (
    <Card
      data-slot="stat-grid"
      className={cn('grid divide-x divide-border', COLUMNS_CLASS[columns], className)}
      {...props}
    />
  );
}
