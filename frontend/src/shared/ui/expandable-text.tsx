import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/cn';

/**
 * Free text inside a table cell: two lines, then «Показати повністю». The
 * toggle appears only when the clamp actually hides something — measured, not
 * guessed from a character count, since how much fits depends on the font.
 */
export function ExpandableText({ children, className }: { children: ReactNode; className?: string }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLSpanElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (el && !expanded) setOverflows(el.scrollHeight > el.clientHeight);
  }, [children, expanded]);

  return (
    <div className="flex max-w-xs flex-col items-start gap-0.5 whitespace-normal">
      <span ref={ref} className={cn(!expanded && 'line-clamp-2', className)}>
        {children}
      </span>
      {overflows ? (
        <button
          type="button"
          className="text-xs text-primary underline-offset-2 hover:underline"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          {t(expanded ? 'actions.collapse' : 'actions.showMore')}
        </button>
      ) : null}
    </div>
  );
}
