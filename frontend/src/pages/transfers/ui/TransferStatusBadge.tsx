import { useTranslation } from 'react-i18next';
import { Truck, Check, TriangleAlert, CircleCheck } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Badge } from '@/shared/ui/badge';
import type { TransferStatus } from '@/entities/transfer';

/**
 * «У дорозі» / «Прийнято» / «Не сходиться» — the same client-facing words
 * `transfer.incoming`/`transfer.dispute` already use elsewhere on this
 * branch, so the vocabulary does not fork between the point's screen and the
 * owner's. Amber is deliberately not red: a transfer «in transit» can sit
 * there for hours by design (the carrier drives in the evening) — that is
 * the process working, not an incident.
 */
const ICON: Record<TransferStatus, LucideIcon> = {
  sent: Truck,
  accepted: Check,
  disputed: TriangleAlert,
};

const TONE: Record<TransferStatus, string> = {
  sent: 'border-amber/40 text-amber',
  accepted: 'border-leaf/40 text-leaf',
  disputed: 'border-destructive/40 text-destructive',
};

export function TransferStatusBadge({
  status,
  resolvedAt = null,
}: {
  status: TransferStatus;
  /**
   * `Transfer.resolved_at` (fix round 1, finding 4) — `resolve()` never
   * touches `status` (transfers.service.ts's own doc comment: "THE STATUS
   * IS NOT TOUCHED"), so a dispute the owner settled weeks ago still carries
   * `status: 'disputed'` forever. Without this, the badge would keep
   * reading «Doesn't match» for a document that is no longer anyone's open
   * problem, with nothing anywhere saying otherwise. Pass `null`/omit for a
   * transfer that was never disputed at all — the badge then falls through
   * to the plain per-status look below.
   */
  resolvedAt?: string | null;
}) {
  const { t } = useTranslation();

  if (status === 'disputed' && resolvedAt != null) {
    return (
      <Badge variant="outline" className="border-leaf/40 text-leaf">
        <CircleCheck />
        {t('transfers.status.resolved')}
      </Badge>
    );
  }

  const Icon = ICON[status];
  return (
    <Badge variant="outline" className={TONE[status]}>
      <Icon />
      {t(`transfers.status.${status}`)}
    </Badge>
  );
}
