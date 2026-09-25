import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/shared/ui/card';
import { Button } from '@/shared/ui/button';
import { toast } from '@/shared/ui/toast';
import { formatLongDate, todayIso } from '@/shared/lib/date';
import { useMeQuery } from '@/entities/user';
import { useCurrentShiftQuery } from '@/entities/shift';
import { useCloseShiftMutation } from '../api/shiftActions';
import { CountDrawerDialog } from './CountDrawerDialog';

/**
 * «Зміна за … ще не закрита» — the one place an open shift left behind on an
 * earlier day is reachable from (#114).
 *
 * ЧОМУ ЦЕ ОКРЕМИЙ КОМПОНЕНТ, А НЕ ШМАТОК `pages/day`. Every screen reads the
 * shift of the day it is ABOUT (`useShiftOnDateQuery` on «Каса за день»,
 * `useCurrentShiftQuery`-for-today on «Прийомка»), so a shift opened five days
 * ago is invisible on both and the only way back to it used to be five clicks
 * on the day stepper. `GET /shifts/current` answers regardless of date, and
 * that answer belongs on every screen that would otherwise pretend the day is
 * clean — so the alert composes `entities/shift`'s read with this feature's
 * own close mutation and `CountDrawerDialog` and lives at the feature layer,
 * where both consumers (`pages/day`, `pages/reception`) can reach it.
 *
 * Closing happens IN PLACE: there is nothing on the stale day's screen an
 * operator needs in order to sign for the drawer, and sending them there
 * first is the five clicks this component exists to remove.
 *
 * STALE MEANS EARLIER THAN TODAY, not merely «some other day than the screen».
 * The looser rule nagged on «Каса за день» whenever anyone stepped back
 * through the week: today's shift is open exactly where it should be, and
 * «Зміна за сьогодні ще не закрита» over last Tuesday's feed is a warning
 * about nothing. It also stands down on the stale shift's OWN day, where the
 * toolbar's «Закрити зміну» is already the affordance — two buttons for one
 * action is worse than one.
 *
 * §10.3 — only the operator closes a shift, so the owner gets the same
 * warning with no button, exactly as `ShiftBanner` does for opening one.
 */
export function OpenShiftAlert({
  pointId,
  viewedDate,
  onGoToDate,
}: {
  pointId: string | null;
  /** The business date the SCREEN is about — today on «Прийомка», `?date=` on
   *  «Каса за день». It narrows the warning, it does not define it: a shift
   *  must be earlier than TODAY to be stale at all, and this only silences the
   *  alert on that shift's own day, where the screen already offers a close. */
  viewedDate: string;
  /**
   * Take the viewer to the stale shift's own day, or leave the action out
   * entirely when there is nowhere to send them.
   *
   * A CALLBACK TAKING THE DATE, not a `to=` link and not a ready-made node:
   * this component is the only one that knows WHICH date, and each page is
   * the only one that knows what «go there» means for it — `pages/day` writes
   * its own `?date=` (no navigation at all), `pages/reception` navigates to
   * `/day`. One shape covers both without either of them re-deriving the date.
   */
  onGoToDate?: (businessDate: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const { data: me } = useMeQuery();
  const shift = useCurrentShiftQuery(pointId);
  const close = useCloseShiftMutation();
  // Bumped on every open so the dialog remounts with fresh RHF defaults and no
  // banner from the refusal before it — the convention `ReopenShiftDialog`
  // (pages/day) documents.
  const [countInstance, setCountInstance] = useState(0);
  // The shift being closed, captured at CLICK time rather than read back off
  // `shift.data` at submit time — the same reason `DayPage`'s `CountTarget`
  // exists: a refetch landing under the open dialog must not change what the
  // submit closes (or turn it into a silent no-op).
  const [closingId, setClosingId] = useState<string | null>(null);

  // Читається саме `business_date`, а не статус: `/shifts/current` повертає
  // ЛИШЕ відкриту зміну. Строкове порівняння дат — `YYYY-MM-DD` сортується
  // лексикографічно так само, як хронологічно, тому арифметика тут зайва.
  const today = todayIso();
  const openShift = shift.data ?? null;
  const stale =
    openShift !== null && openShift.business_date < today && openShift.business_date !== viewedDate
      ? openShift
      : null;
  if (stale === null) return null;

  const canClose = me?.role === 'point_operator';

  return (
    <Card className="mb-5 flex flex-wrap items-center gap-3 border-amber/40 p-4">
      <AlertTriangle className="size-4 shrink-0 text-amber" />
      <div className="min-w-0">
        <p className="text-sm font-medium">
          {t('day.staleShift.title', {
            date: formatLongDate(stale.business_date, i18n.language),
          })}
        </p>
        <p className="text-xs text-muted-foreground">
          {t(canClose ? 'day.staleShift.hint' : 'day.staleShift.hintOwner')}
        </p>
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {onGoToDate ? (
          <Button variant="outline" onClick={() => onGoToDate(stale.business_date)}>
            {t('day.staleShift.goToDay')}
          </Button>
        ) : null}
        {canClose ? (
          <Button
            onClick={() => {
              setCountInstance((n) => n + 1);
              setClosingId(stale.id);
            }}
          >
            {t('day.close')}
          </Button>
        ) : null}
      </div>

      <CountDrawerDialog
        key={`stale-count-${countInstance}`}
        mode="close"
        shiftId={closingId}
        open={closingId !== null}
        onClose={() => setClosingId(null)}
        onConfirm={async (counted_amount, broken_crates) => {
          if (closingId === null || broken_crates === null) {
            // Діалог підтверджується лише поки він відкритий, а відкритий він
            // лише з `closingId`; у режимі закриття бій завжди число (`0`
            // включно). Обидва `null` тут — помилка коду, а не дія людини:
            // кинути краще, ніж тихо нічого не зробити — діалог покаже банер.
            throw new Error('stale-shift close confirmed without a target');
          }
          await close.mutateAsync({ id: closingId, counted_amount, broken_crates });
          toast.success(t('day.toast.closed'));
          setClosingId(null);
        }}
      />
    </Card>
  );
}
