import * as React from 'react';
import { cn } from '@/shared/lib/cn';
import { Eyebrow } from './eyebrow';

/** A titled section: optional Eyebrow + title header with an aside, then content.
 *  `card` (default) wraps it in the app's one outlined shell — `Card`'s
 *  `border border-line2`, not the mock's `ring-foreground/10`, which vanished on the
 *  dark paper (audit 2026-10-24, F2). */
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
    <div className={cn(card && 'rounded-xl border border-line2 bg-card p-5', className)}>
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
