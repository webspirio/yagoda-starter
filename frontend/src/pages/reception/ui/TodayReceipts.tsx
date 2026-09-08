import { useTranslation } from 'react-i18next';
import { Badge } from '@/shared/ui/badge';
import { Card } from '@/shared/ui/card';
import { Eyebrow } from '@/shared/ui/eyebrow';
import { cn } from '@/shared/lib/cn';
import { formatUah } from '@/shared/lib/money';
import { useIntakesQuery } from '@/entities/intake';

/**
 * The right column: every receipt of the CURRENT shift, newest first, each one
 * a way back into its own printable copy. Reads the same `intakes` journal the
 * day screen does — a saved receipt invalidates that prefix, so this list is
 * the confirmation that the document landed.
 */
export function TodayReceipts({
  shiftId,
  onOpen,
}: {
  shiftId: string | undefined;
  onOpen: (intakeId: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? 'uk';
  const intakes = useIntakesQuery({ shiftId });

  const rows = [...(intakes.data?.data ?? [])].sort((a, b) =>
    a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0,
  );

  return (
    <Card className="h-fit p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <Eyebrow className="truncate">{t('reception.today.title')}</Eyebrow>
        <Badge variant="secondary">{rows.length}</Badge>
      </div>

      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {t('reception.today.empty')}
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((row) => (
            <li key={row.id}>
              <button
                type="button"
                onClick={() => onOpen(row.id)}
                className={cn(
                  'flex w-full items-center gap-2 py-2 text-left text-sm transition-colors hover:text-brand',
                  row.voided_at !== null && 'text-muted-foreground line-through',
                )}
              >
                <span className="min-w-0 flex-1 truncate font-mono text-xs">{row.code}</span>
                {row.voided_at !== null ? (
                  <span className="shrink-0 text-xs">{t('reception.today.voided')}</span>
                ) : null}
                <span className="shrink-0 font-mono tabular-nums">
                  {formatUah(row.amount, locale)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
