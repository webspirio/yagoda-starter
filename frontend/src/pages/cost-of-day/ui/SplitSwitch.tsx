import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import { COST_SPLITS, type CostSplit } from '@/entities/cost-of-day';

/**
 * «Розподіл кошика» (spec 2026-10-24 §3.1) — three pressed/unpressed buttons
 * in one labelled group, every option in sight. Not `shared/ui/segmented`: its
 * gliding thumb pulls `motion/react` into the owner chunk, which put the lazy
 * bundle 11 KiB over its ceiling for an animation this switch does not need.
 * `print-hide`: on paper the sheet's title names the split instead.
 */
export function SplitSwitch({
  value,
  onChange,
}: {
  value: CostSplit;
  onChange: (next: CostSplit) => void;
}) {
  const { t } = useTranslation();
  return (
    <div role="group" aria-label={t('costOfDay.split.label')} className="print-hide flex gap-1">
      {COST_SPLITS.map((split) => (
        <Button
          key={split}
          type="button"
          size="sm"
          variant={split === value ? 'secondary' : 'outline'}
          aria-pressed={split === value}
          onClick={() => onChange(split)}
        >
          {t(`costOfDay.split.${split}`)}
        </Button>
      ))}
    </div>
  );
}
