import * as React from 'react';
import { cn } from '@/shared/lib/cn';

// Static column classes — never interpolate `grid-cols-${n}` (Tailwind's scanner
// would not see it, so the utility would be missing from the built CSS).
const COLS = {
  2: 'grid-cols-2',
  3: 'grid-cols-2 sm:grid-cols-3',
  4: 'grid-cols-2 sm:grid-cols-4',
  5: 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5',
} as const;

/** Responsive layout grid for a band of StatTiles. Distinct from a table/card. */
export function StatGrid({
  columns = 5,
  children,
  className,
}: {
  columns?: 2 | 3 | 4 | 5;
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn('grid gap-3', COLS[columns], className)}>{children}</div>;
}
