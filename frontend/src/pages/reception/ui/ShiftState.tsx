import { CalendarClock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import { EmptyState } from '@/shared/ui/empty-state';
import { cn } from '@/shared/lib/cn';
import { formatTime } from '@/shared/lib/date';
import type { StripShift } from './PointStrip';

/**
 * The shift's status beside the page title: a coloured dot and one short
 * phrase. It never carries an action — a day with no open shift says what to
 * do in `ShiftClosedState`, where the form would otherwise be.
 */
export function ShiftStatus({ shift }: { shift: StripShift }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? 'uk';

  if (shift.status === 'pending') return null;
  // A failed read and «no shift» are the same `null` in the data, so the
  // failure is said outright rather than read as «not opened».
  if (shift.status === 'error') {
    return (
      <p role="alert" className="text-sm text-destructive">
        {t('common.somethingWentWrong')}
      </p>
    );
  }
  const open = shift.status === 'open';
  return (
    <p
      className={cn(
        'flex items-center gap-2 text-sm font-medium whitespace-nowrap',
        open ? 'text-success' : 'text-amber',
      )}
    >
      <span
        className={cn('size-2 shrink-0 rounded-full', open ? 'bg-success' : 'bg-amber')}
        aria-hidden="true"
      />
      {open
        ? t('reception.state.shiftOpen', { time: formatTime(shift.shift.created_at, locale) })
        : t('reception.shift.none')}
    </p>
  );
}

/**
 * What stands in for the intake form and the settlement card while today's
 * shift is not open: nothing can be received without one (§10.3), so the
 * form is not offered disabled — the screen says why and what to do. Only the
 * OPERATOR opens a shift; the owner reads whose job it is, with no button the
 * server would refuse.
 */
export function ShiftClosedState({
  canOpen,
  isOpening,
  onOpenShift,
}: {
  canOpen: boolean;
  isOpening: boolean;
  onOpenShift: () => void;
}) {
  const { t } = useTranslation();
  return (
    <EmptyState
      icon={<CalendarClock className="size-8" aria-hidden="true" />}
      title={t('reception.shift.closedTitle')}
      hint={canOpen ? t('reception.shift.closedHint') : t('reception.shift.closedHintOwner')}
      action={
        canOpen ? (
          <Button className="mt-2" onClick={onOpenShift} disabled={isOpening}>
            {t('reception.shift.open')}
          </Button>
        ) : undefined
      }
    />
  );
}
