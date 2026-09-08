import * as React from 'react';
import { cn } from '@/shared/lib/cn';

export function Eyebrow({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground',
        className,
      )}
    >
      {children}
    </div>
  );
}
