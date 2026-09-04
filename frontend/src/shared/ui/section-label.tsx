import * as React from 'react';
import { cn } from '@/shared/lib/cn';

interface SectionLabelProps extends React.HTMLAttributes<HTMLElement> {
  /** Element to render. Picks heading semantics (h2/h3) where the original had them. */
  as?: React.ElementType;
}

/**
 * Uppercase "eyebrow" section label. Base is `text-xs`; the `text-[11px]` sites
 * override via `className` (twMerge swaps the size). `as` selects the element to
 * preserve heading semantics — intentionally NOT a fully type-safe polymorphic
 * component (no typed per-element prop passthrough), which suffices here.
 */
export function SectionLabel({ as: Tag = 'span', className, ...props }: SectionLabelProps) {
  return (
    <Tag
      data-slot="section-label"
      className={cn(
        'text-xs font-bold uppercase tracking-wider text-muted-foreground',
        className,
      )}
      {...props}
    />
  );
}
