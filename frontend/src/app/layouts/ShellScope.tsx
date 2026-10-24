import { useTranslation } from 'react-i18next';
import { usePointOptionsQuery } from '@/entities/collection-point';
import { useWorkingPoint } from '@/features/point-scope';
import { useHeaderSlotClaimed } from '@/shared/ui/header-slot-context';
import { SelectField } from '@/shared/ui/select-field';

/**
 * The top bar's scope, when the screen has not put its own there (client, 24.10).
 *
 * A screen that is about one point — or about «Усі точки» — renders its own select into
 * the bar's `scope` slot, because only it knows which choices make sense there (reweigh
 * lists the reception points, «Залишки» and «Собівартість» add «Усі точки»). Every other
 * screen gets this one: for the owner, the WORKING point — the same `?point=` and remembered
 * choice `useWorkingPoint` resolves for every point screen, so a point picked here is the
 * one reception, point cash and the rest open on next. The operator is pinned to their
 * point by the server and keeps the plain chip.
 */
export function ShellScope({ isOwner }: { isOwner: boolean }) {
  const { t } = useTranslation();
  const claimed = useHeaderSlotClaimed('scope');
  if (claimed) return null;
  if (!isOwner) {
    return (
      <span className="rounded-md bg-card px-2.5 py-1 text-sm text-muted-foreground ring-1 ring-foreground/10">
        {t('shell.yourPoint')}
      </span>
    );
  }
  return <WorkingPointSelect />;
}

function WorkingPointSelect() {
  const { t } = useTranslation();
  const { pointId, setPointId } = useWorkingPoint();
  const { data: points } = usePointOptionsQuery();

  return (
    <SelectField
      aria-label={t('shell.pickPoint')}
      value={pointId ?? ''}
      onChange={(e) => setPointId(e.target.value || null)}
      className="w-44"
    >
      {/* A deactivated point reached by `?point=` is not among the active ones. */}
      {pointId && points && !points.some((p) => p.id === pointId) ? (
        <option value={pointId}>{t('common.inactivePoint')}</option>
      ) : null}
      {(points ?? []).map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </SelectField>
  );
}
