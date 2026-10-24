import { useMemo } from 'react';
import { Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import { Eyebrow } from '@/shared/ui/eyebrow';
import { formatKg, sum } from '@/shared/lib/money';
import { useTareTypeOptionsQuery } from '@/entities/tare-type';
import type { Draft } from '../model/draft';
import { netFormula, netParts } from '../lib/formula';
import { NetFormula, type NetTraceIds } from './NetFormula';
import { DRAFTS_TOTAL_TRACE } from '../lib/traceIds';

/** A draft's own figures — only its net is shown again, at the row's end. */
const draftTrace = (key: string): NetTraceIds => ({
  gross: `dr:${key}:gross`,
  pallet: `dr:${key}:pallet`,
  units: (i) => `dr:${key}:units:${i}`,
  weight: (i) => `dr:${key}:weight:${i}`,
  tareKg: `dr:${key}:tareKg`,
  net: `dr:${key}:net`,
});

/**
 * The strip of positions typed so far — the mock's `:586-640`, verbatim in
 * structure — and, since the 2026-10-23 review, the «Провести» button that
 * posts them: form → drafts → post reads top to bottom in one column.
 * Nothing here is persisted: there is no document yet (Task 12 posts one line
 * at a time), so a page reload loses this list.
 *
 * Each line reads as its own formula (W4, «300,60 кг − 15,60 кг − 48 шт. ×
 * 1,20 кг = 227,40 кг») from the parts the draft already carries; the per-unit weights come
 * from `useTareTypeOptionsQuery` — the same catalogue the form computed the
 * preview with, and React Query dedupes it against `WeighingForm`'s call.
 */
export function DraftLines({
  drafts,
  onRemove,
  onPost,
  posting,
  canPost,
}: {
  drafts: Draft[];
  onRemove: (key: string) => void;
  onPost: () => void;
  posting: boolean;
  canPost: boolean;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? 'uk';
  const tareTypes = useTareTypeOptionsQuery();

  const weightById = useMemo(
    () => new Map((tareTypes.data ?? []).map((tt) => [tt.id, tt.weight_kg])),
    [tareTypes.data],
  );

  // A PREVIEW total of unposted drafts, not a printed figure: the server
  // computes every posted line again.
  const total = drafts.length ? sum(drafts.map((d) => d.net_kg)) : '0.00';

  return (
    <div className="rounded-xl border border-line2 bg-card">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/70 px-4 py-3">
        <Eyebrow>{t('reweigh.drafts.title')}</Eyebrow>
        <span className="text-xs text-muted-foreground">{t('reweigh.drafts.hint')}</span>
      </div>
      {drafts.length ? (
        <ul className="divide-y divide-border/60">
          {drafts.map((draft) => {
            // Same ambiguity as the day table (`DayLines.tsx`): «Стандарт»
            // alone doesn't say which of eight products it is.
            const productGrade = t('reweigh.productGrade', {
              product: draft.product_name,
              grade: draft.product_grade_name,
            });
            const line = {
              gross: draft.gross_kg,
              pallet: draft.pallet_kg,
              tare: draft.tare.map((term) => ({
                units: term.units,
                unitWeightKg: weightById.get(term.tare_type_id) ?? null,
              })),
              tareKg: draft.tare_weight_kg,
              net: draft.net_kg,
            };
            const formula = netFormula(t, locale, line);
            const parts = netParts(line);
            const ids = draftTrace(draft.key);
            return (
              <li
                key={draft.key}
                title={formula ?? undefined}
                className="flex flex-wrap items-center gap-x-2.5 gap-y-1 px-4 py-2.5 text-sm"
              >
                <span className="font-medium">{productGrade}</span>
                {parts ? (
                  <span className="font-mono text-xs text-muted-foreground">
                    <NetFormula line={line} parts={parts} ids={ids} />
                  </span>
                ) : null}
                <span data-trace={ids.net} className="ml-auto rounded-md font-mono font-semibold">
                  {formatKg(draft.net_kg, locale)}
                </span>
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
            <span data-trace={DRAFTS_TOTAL_TRACE} className="rounded-md font-mono font-semibold">
              {formatKg(total, locale)}
            </span>
          </li>
        </ul>
      ) : (
        <p className="px-4 py-4 text-center text-sm text-muted-foreground">
          {t('reweigh.drafts.empty')}
        </p>
      )}
      {drafts.length ? (
        <div className="border-t border-border/70 p-4">
          <Button size="lg" className="w-full" onClick={onPost} disabled={!canPost || posting}>
            {t('reweigh.post', { kg: formatKg(total, locale) })}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
