import { useTranslation } from 'react-i18next';
import { usePointOptionsQuery } from '@/entities/collection-point';
import { useHeaderSlotClaimed } from '@/shared/ui/header-slot-context';

/**
 * The top bar's scope when the screen has not put its own there.
 *
 * A screen that is about one point — or about «Усі точки» — renders its own select into
 * the bar's `scope` slot (reception, point cash, crates, reweigh, cost of day, debts,
 * journal), because only it knows which choices make sense there. Every OTHER screen is
 * not about a point at all (the overview, suppliers, prices, transfers, the admin
 * screens, the profile), so for the owner the place stays empty: a point select there
 * changed nothing on the screen and only read as if it did (audit 2026-10-24, rule 10 /
 * F4 — it replaced the 24.10 working-point select that sat on every screen).
 *
 * The operator is pinned to their point by the server; the chip names it, on every
 * screen — «ваша точка» only while the name is still loading.
 */
export function ShellScope({ pointId }: { pointId: string | null }) {
  // `pointId` is the OPERATOR's point; the owner passes null and gets nothing.
  const claimed = useHeaderSlotClaimed('scope');
  if (claimed || pointId === null) return null;
  return <OperatorPointChip pointId={pointId} />;
}

function OperatorPointChip({ pointId }: { pointId: string }) {
  return (
    <span className="max-w-[40vw] truncate rounded-md border border-line2 bg-card px-2.5 py-1 text-sm text-muted-foreground">
      <PointName pointId={pointId} />
    </span>
  );
}

/**
 * Whose scope the signed-in user works in, as words for the shell's small print: «усі
 * точки» for the owner, the point's NAME for an operator (rule 10 of the 2026-10-24
 * audit). A component, not a hook, so the owner never asks for the point list just to
 * print it.
 */
export function ScopeLabel({ isOwner, pointId }: { isOwner: boolean; pointId: string | null }) {
  const { t } = useTranslation();
  if (isOwner || pointId === null) return <>{t('shell.allPoints')}</>;
  return <PointName pointId={pointId} />;
}

function PointName({ pointId }: { pointId: string }) {
  const { t } = useTranslation();
  const { data: points } = usePointOptionsQuery();
  return <>{points?.find((p) => p.id === pointId)?.name ?? t('shell.yourPoint')}</>;
}
