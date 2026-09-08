import * as React from 'react';
import { cn } from '@/shared/lib/cn';

/**
 * The ONE outlined surface for a table frame, a master–detail pane, or any
 * block that must read as an object on the paper: `rounded-xl`, a real
 * `line2` hairline (the mock's `ring-foreground/10` vanishes on the dark
 * paper), card fill, clipped corners. No baked padding — a table wants none,
 * a pane adds its own. Per-site tweaks ride in via `className` (twMerge,
 * last wins).
 */
export function Card({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card"
      className={cn('overflow-hidden rounded-xl border border-line2 bg-card', className)}
      {...props}
    />
  );
}
