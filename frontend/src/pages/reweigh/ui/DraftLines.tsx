import { useMemo } from 'react';
import { Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import { Eyebrow } from '@/shared/ui/eyebrow';
import { cmp, formatDecimal, formatKg, sum } from '@/shared/lib/money';
import { useTareTypeOptionsQuery } from '@/entities/tare-type';
import type { Draft } from '../model/draft';

/**
 * The strip of positions typed so far — the mock's `:586-640`, verbatim in
 * structure. Nothing here is persisted: there is no document yet (Task 12
 * posts one line at a time), so a page reload loses this list, and
 * `reweigh.drafts.empty` says so.
 *
 * Resolves its own tare-type names via `useTareTypeOptionsQuery` — `Draft`
 * (Task 5's `model/draft.ts`) carries only `tare_type_id`, not a name, and
 * React Query dedupes this against `WeighingForm`'s own call to the same
 * query key rather than firing a second request.
 */
export function DraftLines({
  drafts,
  onRemove,
}: {
  drafts: Draft[];
  onRemove: (key: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? 'uk';
  const tareTypes = useTareTypeOptionsQuery();

  const nameById = useMemo(
    () => new Map((tareTypes.data ?? []).map((tt) => [tt.id, tt.name])),
    [tareTypes.data],
  );

  const total = sum(drafts.map((d) => d.net_kg));

  return (
    <div className="rounded-xl bg-card ring-1 ring-foreground/10">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/70 px-4 py-3">
        <Eyebrow>{t('reweigh.drafts.title')}</Eyebrow>
        <span className="text-xs text-muted-foreground">{t('reweigh.drafts.hint')}</span>
      </div>
      {drafts.length ? (
        <ul className="divide-y divide-border/60">
          {drafts.map((draft) => {
            const firstTare = draft.tare[0];
            // Same ambiguity as the day table (`DayLines.tsx`): «Стандарт»
            // alone doesn't say which of eight products it is. `Draft`
            // carries both names as plain strings, so no fallback is needed
            // here the way `DayLines` needs one for an optional relation.
            const productGrade = t('reweigh.productGrade', {
              product: draft.product_name,
              grade: draft.product_grade_name,
            });
            return (
              <li
                key={draft.key}
                className="flex flex-wrap items-center gap-x-2.5 gap-y-1 px-4 py-2.5 text-sm"
              >
                <span className="text-muted-foreground">▪</span>
                <span className="font-medium">{productGrade}</span>
                <span className="font-mono text-xs text-muted-foreground">
                  {formatDecimal(draft.gross_kg, locale)} {t('reweigh.drafts.grossSuffix')}
                </span>
                {firstTare ? (
                  <span className="font-mono text-xs text-muted-foreground">
                    {firstTare.units} × {nameById.get(firstTare.tare_type_id) ?? t('reweigh.drafts.tareFallback')}
                  </span>
                ) : null}
                {cmp(draft.pallet_kg, '0.00') > 0 ? (
                  <span className="font-mono text-xs text-muted-foreground">
                    {t('reweigh.drafts.palletPrefix')} {formatDecimal(draft.pallet_kg, locale)}
                  </span>
                ) : null}
                <span className="ml-auto font-mono font-semibold">{formatKg(draft.net_kg, locale)}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('reweigh.drafts.remove')}
                  onClick={() => onRemove(draft.key)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </li>
            );
          })}
          <li className="flex items-baseline justify-between px-4 py-2.5 text-sm">
            <span className="text-muted-foreground">{t('reweigh.drafts.total')}</span>
            <span className="font-mono font-semibold">{formatKg(total, locale)}</span>
          </li>
        </ul>
      ) : (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">
          {t('reweigh.drafts.empty')}
        </p>
      )}
    </div>
  );
}
