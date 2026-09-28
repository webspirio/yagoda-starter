import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';

/**
 * A receipt row's «Анулювати» — the same action as the one inside
 * `ReceiptDialog`, surfaced where users look for it. The caller decides
 * visibility with `canVoidIntake` and opens the dialog with `startWithVoid`.
 * It stops propagation so the row's own open-receipt click does not fire too;
 * the accessible name carries the code, so each row's button is distinct.
 */
export function ReceiptVoidButton({ code, onClick }: { code: string; onClick: () => void }) {
  const { t } = useTranslation();
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="shrink-0 text-destructive hover:text-destructive"
      aria-label={t('receipt.voidRow', { code })}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      {t('receipt.void')}
    </Button>
  );
}
