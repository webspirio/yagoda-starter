import * as React from 'react';
import { cn } from '@/shared/lib/cn';

/**
 * Traced formulas — «звідки це число» (client, 24.10).
 *
 * Every operand of an on-screen formula is a `TraceTerm`: a small boxed figure. Pointing
 * at it (hover, focus, or a tap on a phone) lights up, inside the nearest `TraceScope`,
 * every element whose `data-trace` attribute lists one of the term's ids — the table
 * cell the figure was read from, and every other operand showing the same figure — in
 * the term's colour. A source is any element carrying `data-trace="id …"` (space-
 * separated, like `class`); it needs no wrapper and no hook, so a `<td>` stays a `<td>`.
 *
 * The highlight is applied imperatively as `data-trace-hit="<tone>"` on the matched
 * elements and styled in `index.css`, so pointing at a figure re-renders nothing. React
 * never writes `data-trace-hit`, so it is not fighting React for the attribute.
 *
 * Outside a scope a term is still the boxed figure, just without the pointing.
 */

export type TraceTone = 'neutral' | 'sky' | 'amber' | 'plum' | 'leaf' | 'berry';

interface TraceApi {
  show: (refs: readonly string[], tone: TraceTone) => void;
  clear: () => void;
}

const TraceContext = React.createContext<TraceApi | null>(null);

const HIT = 'data-trace-hit';

function clearHits(root: HTMLElement) {
  for (const el of root.querySelectorAll(`[${HIT}]`)) el.removeAttribute(HIT);
}

/** Attribute-selector-safe: ids are app-made (`p:<uuid>:accrued`), never user text. */
const quote = (ref: string) => ref.replace(/["\\]/g, '\\$&');

/** The area a term may light up — usually the card holding a table and its formulas. */
export function TraceScope({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const root = React.useRef<HTMLDivElement>(null);
  const api = React.useMemo<TraceApi>(
    () => ({
      show(refs, tone) {
        const el = root.current;
        if (!el) return;
        clearHits(el);
        for (const ref of refs) {
          for (const hit of el.querySelectorAll(`[data-trace~="${quote(ref)}"]`)) {
            hit.setAttribute(HIT, tone);
          }
        }
      },
      clear() {
        if (root.current) clearHits(root.current);
      },
    }),
    [],
  );
  return (
    <TraceContext.Provider value={api}>
      <div ref={root} data-slot="trace-scope" className={cn('contents', className)}>
        {children}
      </div>
    </TraceContext.Provider>
  );
}

const TONE: Record<TraceTone, string> = {
  neutral: 'border-line2 bg-muted/60',
  sky: 'border-[var(--sky)]/35 bg-[var(--sky)]/10 text-[var(--sky)]',
  amber: 'border-[var(--amber)]/40 bg-[var(--amber)]/10 text-[var(--amber)]',
  plum: 'border-[var(--plum)]/35 bg-[var(--plum)]/10 text-[var(--plum)]',
  leaf: 'border-[var(--leaf)]/35 bg-[var(--leaf)]/10 text-[var(--leaf)]',
  berry: 'border-brand/35 bg-brand/10 text-brand',
};

/**
 * One boxed operand. `refs` names where the figure comes from (one id or several — a
 * per-kg share points at both the money it divides and the kilograms it divides by);
 * `hint` says it in words for the tooltip and a screen reader («Нараховано · Малина»).
 * The children are the figure WITH its unit, already formatted.
 */
export function TraceTerm({
  refs,
  tone = 'neutral',
  hint,
  children,
  className,
}: {
  refs: string | readonly string[];
  tone?: TraceTone;
  hint?: string;
  /** Optional so a term can be a `<Trans>` component, which supplies the children. */
  children?: React.ReactNode;
  className?: string;
}) {
  const api = React.useContext(TraceContext);
  const list = typeof refs === 'string' ? refs.split(' ').filter(Boolean) : refs;
  const on = () => api?.show(list, tone);
  const off = () => api?.clear();
  return (
    <span
      data-slot="trace-term"
      data-trace={list.join(' ')}
      tabIndex={api ? 0 : undefined}
      title={hint}
      aria-label={hint ? `${textOf(children)} — ${hint}` : undefined}
      onPointerEnter={on}
      onPointerLeave={off}
      onFocus={on}
      onBlur={off}
      className={cn(
        'mx-px inline-flex items-baseline rounded-[5px] border px-1 font-mono tabular-nums whitespace-nowrap',
        'outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
        api && 'cursor-help',
        'print:border-transparent print:bg-transparent print:px-0',
        TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

function textOf(node: React.ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  return '';
}
