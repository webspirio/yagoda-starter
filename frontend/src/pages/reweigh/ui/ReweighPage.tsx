import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/shared/ui/page-header';
import { SelectField } from '@/shared/ui/select-field';
import { DateStepper } from '@/shared/ui/date-stepper';
import { Button } from '@/shared/ui/button';
import { Spinner } from '@/shared/ui/spinner';
import { toast } from '@/shared/ui/toast';
import { useUrlParam } from '@/shared/lib/url-state';
import { todayIso, addDaysIso, isRealIsoDate, formatShortDate } from '@/shared/lib/date';
import { cmp, formatKg, sum } from '@/shared/lib/money';
import { apiErrorToBanner } from '@/shared/lib/api-error';
import { useWorkingPoint } from '@/features/point-scope';
import { usePointOptionsQuery } from '@/entities/collection-point';
import { useShiftOnDateQuery } from '@/entities/shift';
import {
  useReweighQuery,
  useAddReweighItemMutation,
  type AddReweighItemInput,
} from '@/entities/reweigh';
import { useDayReweighs } from '../api/useDayReweighs';
import type { Draft } from '../model/draft';
import { WeighingForm } from './WeighingForm';
import { DraftLines } from './DraftLines';
import { Reconciliation } from './Reconciliation';
import { DayLines } from './DayLines';

/**
 * «Переважування» — the mock's `.reference/yagoda-crm/src/pages/ReweighPage.tsx`,
 * reproduced with this repo's kit: the owner stands at the scale at the base,
 * weighs pallets that arrived from a collection point, and sees the недостача
 * against what the point claims it sent (§8).
 *
 * THE DATE HEADER copies `pages/day/ui/DayPage.tsx` verbatim — `useUrlParam`,
 * the same clamp, `useWorkingPoint`, `DateStepper` — rather than inventing a
 * second one. It is deliberately LOCAL to this screen: the owner works
 * through yesterday's trucks while the points are still buying today, and a
 * global date would move the working day under the very people this screen
 * is checking (the mock says the same: «Перемикач дати локальний»).
 *
 * THE POINT is «from the point» — which RECEPTION point's berries are on the
 * scale — not the base itself, so the picker is filtered to `kind ===
 * 'reception'`. `shiftId` is that point's shift for the date, and every
 * write here (`POST .../reweigh-items`) is scoped to it.
 *
 * `useWorkingPoint()`'s own default (§4.8's склад, or the first active point)
 * is the right first-visit answer for a MONEY screen in general, but on a
 * genuinely fresh owner session it can resolve to the BASE — a point this
 * screen's own picker never offers, since only a reception point sends
 * berries to be reweighed. Left uncorrected, that leaves a blank `<select>`
 * beside a banner still naming the base (resolved off the unfiltered list).
 * Rather than patch the shared hook — it serves other screens whose pickers
 * are not reception-only — a resolved id absent from `receptionPoints` is
 * treated as unset HERE, falling back to the network's first reception
 * point, so the picker and every reading below it (the shift, the banner,
 * the звірка) always agree on the same point.
 *
 * DRAFTS live only in this component's state — there is no document until a
 * line posts (Task 5's `model/draft.ts`). They are cleared, with a toast,
 * the moment `(date, pointId)` changes: a draft typed against one point's
 * intake cannot silently become a line against another.
 *
 * POSTING IS SEQUENTIAL AND STOPS AT THE FIRST REFUSAL — see `post()` below.
 */
export function ReweighPage() {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? 'uk';

  const { pointId: resolvedPointId, canPick, setPointId } = useWorkingPoint();
  const { data: points } = usePointOptionsQuery();
  const receptionPoints = (points ?? []).filter((p) => p.kind === 'reception');
  // `useWorkingPoint()` can hand back a point this screen's own picker never
  // offers (the base — see the header doc above). Anything not in
  // `receptionPoints` is treated as unset and corrected to the network's
  // first reception point, so `pointId` below is always one the `<select>`
  // actually lists.
  const pointId =
    resolvedPointId !== null && receptionPoints.some((p) => p.id === resolvedPointId)
      ? resolvedPointId
      : (receptionPoints[0]?.id ?? null);
  const [dateParam, setDateParam] = useUrlParam('date');
  const today = todayIso();
  // A hand-edited (or stale-link) date is clamped rather than sent on — same
  // guard as DayPage: there is no shift in the future.
  const date = isRealIsoDate(dateParam) && dateParam <= today ? dateParam : today;

  const shift = useShiftOnDateQuery(pointId, date);
  const shiftId = shift.data?.id;
  const reweigh = useReweighQuery(shiftId);
  const addLine = useAddReweighItemMutation();
  const dayReweighs = useDayReweighs(receptionPoints, date);

  // THREE states, not two. A failed read leaves `shift.data` and
  // `accepted_anything` undefined, which is indistinguishable from the
  // genuine §6.1 answers («зміну не відкривали», «нічого не приймали») — so
  // without this split a 500 is reported to the owner as a business fact
  // about their own shift. `pointId !== null` / `shiftId !== undefined`
  // guard the DISABLED queries: TanStack reports `isPending` on a query it
  // never ran, and gating on it bare would park the screen on a spinner
  // whenever there is legitimately no point or no shift. Same shape as
  // `pages/day`'s `isLoadingShift`.
  const readsPending =
    (pointId !== null && shift.isPending) || (shiftId !== undefined && reweigh.isPending);
  const readsFailed = shift.isError || reweigh.isError;

  const hasShift = shift.data != null;
  const shiftClosed = shift.data?.status === 'closed';
  const acceptedAnything = reweigh.data?.accepted_anything ?? false;
  const grades = reweigh.data?.grades ?? [];
  const products = reweigh.data?.products ?? [];

  const pointName = (points ?? []).find((p) => p.id === pointId)?.name ?? '';

  const [drafts, setDrafts] = useState<Draft[]>([]);

  // Drafts belong to the (date, point) pair — changing either clears them,
  // and ONLY when there was something to clear (a toast on an empty list is
  // noise). Keyed on a string rather than a two-value effect dependency list
  // so the comparison is one equality check, not two.
  const context = `${date}|${pointId ?? ''}`;
  const previousContext = useRef(context);
  useEffect(() => {
    if (previousContext.current === context) return;
    previousContext.current = context;
    setDrafts((current) => {
      if (current.length > 0) toast.info(t('reweigh.draftsCleared'));
      return [];
    });
  }, [context, t]);

  function addDraft(draft: Draft) {
    setDrafts((current) => [...current, draft]);
  }

  function removeDraft(key: string) {
    setDrafts((current) => current.filter((d) => d.key !== key));
  }

  /**
   * §3.1 — the drafts are posted ONE LINE AT A TIME, because that is what
   * this API writes. Sequential, not `Promise.all`: `item_order` is
   * allocated under a lock on the header row, so parallel lines would queue
   * on each other anyway, and a failure in the middle of a parallel batch
   * leaves an order nobody could reconstruct from the screen.
   *
   * STOPS AT THE FIRST REFUSAL, and the survivors stay. The alternative —
   * carrying on and reporting a list of failures — leaves the owner holding
   * a screen whose contents match neither the server nor what they typed.
   */
  async function post() {
    if (!shiftId || drafts.length === 0) return;
    const total = sum(drafts.map((d) => d.net_kg));
    const remaining = [...drafts];
    while (remaining.length > 0) {
      const draft = remaining[0];
      try {
        // Typed against `AddReweighItemInput` explicitly, not just handed an
        // object literal the mutation happens to accept structurally — it is
        // the ONE place this page states, in a type the compiler checks,
        // that `net_kg`/`tare_weight_kg` are never part of the wire body.
        const payload: AddReweighItemInput = {
          shiftId,
          product_grade_id: draft.product_grade_id,
          gross_kg: draft.gross_kg,
          // `pallet_kg` is omitted when zero — the DTO defaults it
          // server-side; a browser-side default is a second place for that
          // rule to drift.
          ...(cmp(draft.pallet_kg, '0.00') > 0 ? { pallet_kg: draft.pallet_kg } : {}),
          tare: draft.tare,
        };
        await addLine.mutateAsync(payload);
      } catch (error) {
        setDrafts(remaining);
        toast.error(t('reweigh.postFailed', { grade: draft.product_grade_name }), {
          // The POST path's own fallback, NOT the day table's
          // `reweigh.day.errors.failed` («Позицію не сторновано») — that
          // sentence describes a failed STORNO and would report the wrong
          // operation entirely. §6.4 wants the backend's own code named,
          // which `CODE` now carries for all five this endpoint throws.
          description: t(apiErrorToBanner(error, 'reweigh.errors.postFailed')),
        });
        return;
      }
      remaining.shift();
      setDrafts([...remaining]);
    }
    toast.success(t('reweigh.posted', { kg: formatKg(total, locale) }));
  }

  const draftsTotal = drafts.length ? sum(drafts.map((d) => d.net_kg)) : '0.00';

  const actions = (
    <div className="flex flex-wrap items-center gap-2">
      {canPick ? (
        <>
          <span className="text-xs text-muted-foreground">{t('reweigh.fromPoint')}</span>
          <SelectField
            aria-label={t('reweigh.fromPoint')}
            value={pointId ?? ''}
            onChange={(e) => setPointId(e.target.value || null)}
            className="w-44"
          >
            <option value="">{t('reweigh.fromPoint')}</option>
            {receptionPoints.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </SelectField>
        </>
      ) : null}
      <span className="text-xs text-muted-foreground">{t('reweigh.berryOn')}</span>
      <DateStepper
        label={formatShortDate(date, locale)}
        onPrev={() => setDateParam(addDaysIso(date, -1))}
        onNext={() => setDateParam(addDaysIso(date, 1))}
        canNext={date < today}
      />
    </div>
  );

  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-5 px-4 py-6">
      <PageHeader
        eyebrow={t('reweigh.eyebrow')}
        title={t('reweigh.title')}
        description={t('reweigh.description')}
        actions={actions}
      />

      {readsFailed ? (
        <p role="alert" className="py-6 text-center text-destructive">
          {t('common.somethingWentWrong')}
        </p>
      ) : readsPending ? (
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      ) : (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(340px,1fr)]">
          <div className="flex flex-col gap-5">
            <WeighingForm
              grades={grades}
              hasShift={hasShift}
              acceptedAnything={acceptedAnything}
              pointName={pointName}
              date={date}
              onAdd={addDraft}
            />
            <DraftLines drafts={drafts} onRemove={removeDraft} />
          </div>

          <div className="flex flex-col gap-5">
            <Reconciliation
              products={products}
              drafts={drafts}
              shiftClosed={shiftClosed}
              acceptedAnything={acceptedAnything}
              pointName={pointName}
            />

            <div className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
              <Button
                size="lg"
                className="w-full"
                onClick={post}
                disabled={!shiftId || drafts.length === 0 || addLine.isPending}
              >
                {t('reweigh.post', { kg: formatKg(draftsTotal, locale) })}
              </Button>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                {t('reweigh.postNote')}
              </p>
              {!hasShift ? (
                <p className="mt-2 text-xs leading-relaxed text-[var(--amber)]">
                  {t('reweigh.noShift', { date: formatShortDate(date, locale), point: pointName })}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      )}

      <DayLines
        lines={dayReweighs.lines}
        isPending={dayReweighs.isPending}
        isError={dayReweighs.isError}
        date={date}
      />
    </div>
  );
}
