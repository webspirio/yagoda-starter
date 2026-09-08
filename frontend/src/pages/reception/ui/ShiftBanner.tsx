import { AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/shared/ui/card';
import { Button } from '@/shared/ui/button';

/**
 * A document needs an open shift at the point (§10.3), and only the OPERATOR
 * may open one — so the owner reading this screen is told whose job it is
 * rather than shown a button the server would refuse.
 */
export function ShiftBanner({
  canOpen,
  isOpening,
  onOpen,
}: {
  canOpen: boolean;
  isOpening: boolean;
  onOpen: () => void;
}) {
  const { t } = useTranslation();

  return (
    <Card className="mb-5 flex flex-wrap items-center gap-3 border-amber/40 p-4">
      <AlertTriangle className="size-4 shrink-0 text-amber" />
      <div className="min-w-0">
        <p className="text-sm font-medium">
          {canOpen ? t('reception.shift.none') : t('reception.shift.noneOwner')}
        </p>
        <p className="text-xs text-muted-foreground">{t('reception.shift.hint')}</p>
      </div>
      {canOpen ? (
        <Button className="ml-auto" onClick={onOpen} disabled={isOpening}>
          {t('reception.shift.open')}
        </Button>
      ) : null}
    </Card>
  );
}
