import * as React from 'react';
import { cn } from '@/shared/lib/cn';

function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  // bg-muted (neutral gray), NOT bg-accent — accent is the brand orange-tinted
  // selected-surface token, which would make loading skeletons read as orange.
  return <div data-slot="skeleton" className={cn('bg-muted animate-pulse rounded-md', className)} {...props} />;
}

export { Skeleton };
