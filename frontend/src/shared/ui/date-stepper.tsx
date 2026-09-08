import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import { Button } from './button';

/** Domain-free ‹ date › cluster: takes a pre-formatted label + callbacks; the
 *  page owns all date math. */
export function DateStepper({
  label,
  onPrev,
  onNext,
  onToday,
  canNext = true,
  todayLabel = 'Сьогодні',
  className,
}: {
  label: string;
  onPrev: () => void;
  onNext: () => void;
  onToday?: () => void;
  canNext?: boolean;
  todayLabel?: string;
  className?: string;
}) {
  return (
    <div className={cn('flex items-center gap-1', className)}>
      <Button variant="ghost" size="icon" aria-label="Попередній день" onClick={onPrev}>
        <ChevronLeft />
      </Button>
      <span className="min-w-[7ch] text-center font-mono text-sm tabular-nums">{label}</span>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Наступний день"
        onClick={onNext}
        disabled={!canNext}
      >
        <ChevronRight />
      </Button>
      {onToday ? (
        <Button variant="outline" size="sm" onClick={onToday}>
          {todayLabel}
        </Button>
      ) : null}
    </div>
  );
}
