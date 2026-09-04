import * as React from 'react';
import { cn } from '@/shared/lib/cn';

/**
 * Bordered surface container. The base is the shared card look; per-site padding
 * and the border token (e.g. a dense surface's `border-line2`) ride in via
 * `className`. No baked padding and no variants — YAGNI; add only when a real
 * need appears.
 */
export function Card({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card"
      className={cn('rounded-2xl border border-border bg-card', className)}
      {...props}
    />
  );
}
