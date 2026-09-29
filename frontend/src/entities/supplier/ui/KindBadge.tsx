import { useTranslation } from 'react-i18next';
import { Badge } from '@/shared/ui/badge';
import type { SupplierKind } from '../model/supplier';

/** §2.11 — the marker on the PERSON. One look everywhere it appears; nothing
 *  at all for «Звичайний», so the common case carries no label. */
export function KindBadge({ kind, className }: { kind: SupplierKind; className?: string }) {
  const { t } = useTranslation();
  if (kind === 'none') return null;
  return (
    <Badge variant={kind === 'wholesale' ? 'secondary' : 'outline'} className={className}>
      {t(`suppliers.kindBadge.${kind}`)}
    </Badge>
  );
}
