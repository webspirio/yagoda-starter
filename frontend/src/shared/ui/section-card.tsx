import * as React from 'react';
import { cn } from '@/shared/lib/cn';
import { Eyebrow } from './eyebrow';

/** A titled section: optional Eyebrow + title header with an aside, then content.
 *  `card` (default) wraps it in the app's card shell. */
export function SectionCard({
  eyebrow,
  title,
  aside,
  children,
  card = true,
  className,
}: {
  eyebrow?: string;
  title?: React.ReactNode;
  aside?: React.ReactNode;
  children: React.ReactNode;
  card?: boolean;
  className?: string;
}) {
  const hasHeader = Boolean(eyebrow || title || aside);
  return (
    <div className={cn(card && 'rounded-xl bg-card p-5 ring-1 ring-foreground/10', className)}>
      {hasHeader ? (
        <div className="mb-3 flex items-center justify-between gap-4">
          <div className="min-w-0">
            {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
            {title ? <div className="font-medium">{title}</div> : null}
          </div>
          {aside ? <div className="shrink-0">{aside}</div> : null}
        </div>
      ) : null}
      {children}
    </div>
  );
}
