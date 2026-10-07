import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
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
  className,
}: {
  label: string;
  onPrev: () => void;
  onNext: () => void;
  onToday?: () => void;
  canNext?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <div className={cn('flex items-center gap-1', className)}>
      <Button variant="ghost" size="icon" aria-label={t('common.previousDay')} onClick={onPrev}>
        <ChevronLeft />
      </Button>
      <span className="min-w-[7ch] text-center font-mono text-sm tabular-nums">{label}</span>
      <Button
        variant="ghost"
        size="icon"
        aria-label={t('common.nextDay')}
        onClick={onNext}
        disabled={!canNext}
      >
        <ChevronRight />
      </Button>
      {onToday ? (
        <Button variant="outline" size="sm" onClick={onToday}>
          {t('common.today')}
        </Button>
      ) : null}
    </div>
  );
}
