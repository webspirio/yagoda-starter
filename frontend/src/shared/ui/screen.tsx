import type { ReactNode } from 'react';
import { cn } from '@/shared/lib/cn';

export interface ScreenProps {
  children: ReactNode;
  className?: string;
}

/**
 * The page wrapper. A plain centered container with a max-width and
 * horizontal padding — the standard shape for a page's content column.
 */
export function Screen({ children, className }: ScreenProps) {
  return (
    <div data-slot="screen" className={cn('mx-auto w-full max-w-screen-md bg-background px-4', className)}>
      {children}
    </div>
  );
}
