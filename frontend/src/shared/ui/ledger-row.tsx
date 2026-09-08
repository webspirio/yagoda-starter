import * as React from 'react';
import { cn } from '@/shared/lib/cn';

const TONE = {
  default: 'text-foreground',
  amber: 'text-[var(--amber)]',
  bad: 'text-destructive',
  leaf: 'text-[var(--leaf)]',
} as const;

/** The label:value row — extracted from the mock's three hand-duplicated copies. */
export function LedgerRow({
  label,
  value,
  hint,
  indent,
  strong,
  tone = 'default',
  className,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  hint?: React.ReactNode;
  indent?: boolean;
  strong?: boolean;
  tone?: 'default' | 'amber' | 'bad' | 'leaf';
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex items-baseline justify-between gap-4 py-1',
        indent && 'pl-4',
        strong && 'font-semibold',
        className,
      )}
    >
      <span className={cn('text-sm', !strong && 'text-muted-foreground')}>
        {label}
        {hint ? <span className="ml-2 text-xs text-muted-foreground">{hint}</span> : null}
      </span>
      <span className={cn('font-mono tabular-nums', strong && 'font-semibold', TONE[tone])}>
        {value}
      </span>
    </div>
  );
}
