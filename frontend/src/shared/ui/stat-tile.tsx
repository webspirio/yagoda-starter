import * as React from 'react';
import { cn } from '@/shared/lib/cn';
import { Eyebrow } from './eyebrow';

/**
 * Ported from the mock's `bits.tsx` (frontend migration, issue #14): the
 * product's stat tile — a card with an uppercase label, a large mono value in
 * one of four tones, and an optional hint/icon. Screens lay several out in an
 * external `grid`; there is no `StatGrid` wrapper (the mock composes the grid
 * at the call site). The starter's earlier interactive/button variant and
 * `StatGrid` were unused and were dropped with this port — re-add them if a
 * screen ever needs a pressable stat tile.
 */
export function StatTile({
  label,
  value,
  hint,
  tone = 'default',
  icon,
  className,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  /** `berry` is the brand accent, not «money»: a plain cash or accrued figure stays
   *  `default` (neutral ink) — rule 1 of the 2026-10-24 audit. `amber` is something
   *  owed or short, `leaf` is settled. */
  tone?: 'default' | 'berry' | 'amber' | 'leaf';
  icon?: React.ReactNode;
  className?: string;
}) {
  const toneClass = {
    default: 'text-foreground',
    berry: 'text-brand',
    amber: 'text-[var(--amber)]',
    leaf: 'text-[var(--leaf)]',
  }[tone];

  return (
    <div
      data-slot="stat-tile"
      className={cn(
        'flex min-w-0 flex-col justify-between rounded-xl border border-line2 bg-card px-4 py-3.5',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <Eyebrow className="truncate">{label}</Eyebrow>
        {icon ? <span className="shrink-0 text-muted-foreground">{icon}</span> : null}
      </div>
      <div
        className={cn('mt-2 font-mono text-[26px] leading-none font-semibold tracking-tight', toneClass)}
      >
        {value}
      </div>
      {hint ? <div className="mt-1.5 text-xs text-muted-foreground">{hint}</div> : null}
    </div>
  );
}
