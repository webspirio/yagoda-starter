import { useTranslation } from 'react-i18next';
import { CheckCircle2, TriangleAlert } from 'lucide-react';
import { Badge } from '@/shared/ui/badge';
import { cn } from '@/shared/lib/cn';
import { describeDiscrepancy, formatDiscrepancy, type Discrepancy } from '../lib/discrepancy';

const TEXT_TONE: Record<Discrepancy['tone'], string> = {
  bad: 'text-destructive',
  amber: 'text-[var(--amber)]',
  leaf: 'text-[var(--leaf)]',
};

const BADGE_TONE: Record<Discrepancy['tone'], string> = {
  bad: 'border-destructive/40 text-destructive',
  amber: 'border-[var(--amber)]/40 text-[var(--amber)]',
  leaf: 'border-leaf/40 text-leaf',
};

function useDiscrepancyLabel(): (difference: string) => string {
  const { t, i18n } = useTranslation();
  return (difference) => formatDiscrepancy(t, difference, i18n.language);
}

/** The named difference in its tone — a table cell, a ledger value. `difference` = counted − expected. */
export function DiscrepancyText({
  difference,
  className,
}: {
  difference: string;
  className?: string;
}) {
  const label = useDiscrepancyLabel();
  const d = describeDiscrepancy(difference);
  return (
    <span className={cn('whitespace-nowrap', TEXT_TONE[d.tone], className)} data-discrepancy={d.kind}>
      {label(difference)}
    </span>
  );
}

/** The same reading as a pill — the shift panel and the count result. */
export function DiscrepancyBadge({ difference }: { difference: string }) {
  const label = useDiscrepancyLabel();
  const d = describeDiscrepancy(difference);
  return (
    <Badge variant="outline" className={BADGE_TONE[d.tone]} data-discrepancy={d.kind}>
      {d.kind === 'matched' ? (
        <CheckCircle2 aria-hidden="true" />
      ) : (
        <TriangleAlert aria-hidden="true" />
      )}
      <span className="tabular-nums">{label(difference)}</span>
    </Badge>
  );
}
