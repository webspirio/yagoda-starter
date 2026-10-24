import { useState } from 'react';
import { PackageCheck, PackagePlus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { DashboardPage } from '@/shared/ui/templates/dashboard-page';
import { Button } from '@/shared/ui/button';
import { SelectField } from '@/shared/ui/select-field';
import { HeaderSlot } from '@/shared/ui/header-slot';
import { EmptyState } from '@/shared/ui/empty-state';
import { Spinner } from '@/shared/ui/spinner';
import { Switch } from '@/shared/ui/switch';
import { isTruncated } from '@/shared/api';
import { useMeQuery } from '@/entities/user';
import { usePointOptionsQuery } from '@/entities/collection-point';
import { useWorkingPoint } from '@/features/point-scope';
import { useCrateBalancesQuery, useCrateStandingQuery } from '@/entities/crate';
import { IssueCratesDialog } from '@/features/issue-crates';
import { ReturnCratesDialog } from '@/features/return-crates';
import { CrateStandingBar } from './CrateStandingBar';
import { InFieldTable } from './InFieldTable';
import { PersonCrateDocs } from './PersonCrateDocs';

/**
 * «ЯЩИКИ» — who at this point is still holding crates, and on what terms.
 *
 * EVERY FIGURE ON THE BAR IS REAL. Allotment, received, empty, with people,
 * with berries, total and shortfall all come from ONE server read,
 * `GET /crate-standing` — nothing here is re-derived from `/crate-balances`,
 * which is paginated and would undercount past its first page.
 *
 * THE SHIPMENTS DIALOG IS ABSENT. The mock's «Відправлення за сьогодні» window
 * rests on shipment tracking, and `crate_shipments` stays deferred. The screen
 * no longer says so — a note about a window that does not exist is a developer
 * note, not help (audit 2026-10-24, rule 7); the note that stayed explains what
 * «У нас з ягодою» counts.
 *
 * THE ALLOTMENT IS A GUIDE, NOT A GATE. §6.1 — an allotment BELOW what is
 * already out is allowed with a WARNING, never a refusal, and an empty
 * `target_crates` means «не задано», not zero, so it blocks nothing (правка 14
 * overrides §9.1's «кнопка видачі неактивна»). Both gestures stay live either
 * way.
 *
 * BOTH ROLES ISSUE AND ACCEPT. The operator is the one standing at the table;
 * §10.2 gates only the ALLOTMENT, which the owner changes on the points
 * screen — and for an operator that control is ABSENT, not disabled.
 *
 * VOIDING FROM THIS SCREEN — each holder's row expands to `PersonCrateDocs`,
 * whose buttons follow the server's §9.4-as-amended rule.
 */
export function CratesPage() {
  const { t } = useTranslation();
  const { data: me } = useMeQuery();
  const { pointId, canPick, setPointId, isLoading } = useWorkingPoint();
  const { data: points } = usePointOptionsQuery();

  const isOwner = me?.role === 'network_owner';
  const [includeZero, setIncludeZero] = useState(false);
  const balances = useCrateBalancesQuery({ pointId, isOwner: Boolean(isOwner), includeZero });
  const standing = useCrateStandingQuery({ pointId, isOwner: Boolean(isOwner) });

  const [issueOpen, setIssueOpen] = useState(false);
  const [issueKey, setIssueKey] = useState(0);
  const [returnOpen, setReturnOpen] = useState(false);
  const [returnKey, setReturnKey] = useState(0);

  const rows = balances.data?.data ?? [];

  // `useWorkingPoint` resolves the owner to a point once the list is in, so
  // a `null` after that means the network has no active point at all.
  const needsPoint = Boolean(isOwner) && !isLoading && pointId === null;

  return (
    <>
      {/* `<main>` pads the page; the template sets the width (audit 2026-10-24, F9). */}
      <DashboardPage
        maxWidth={1024}
        eyebrow={t('crates.eyebrow')}
        title={t('crates.title')}
        description={t('crates.description')}
        actions={
          canPick ? (
            <HeaderSlot slot="scope">
              <SelectField
                aria-label={t('crates.pickPoint')}
                value={pointId ?? ''}
                onChange={(e) => setPointId(e.target.value)}
                className="w-48"
              >
                {/* A deactivated point reached by `?point=` is not in
                        `points` (active only); without its own entry the
                        select would show the first active point instead. */}
                {pointId && points && !points.some((p) => p.id === pointId) ? (
                  <option value={pointId}>{t('common.inactivePoint')}</option>
                ) : null}
                {(points ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </SelectField>
            </HeaderSlot>
          ) : undefined
        }
      >
        <div className="flex flex-col gap-5">
          {needsPoint ? (
            <EmptyState title={t('crates.empty.title')} hint={t('crates.empty.hint')} />
          ) : balances.isPending || standing.isPending ? (
            <div className="flex justify-center py-12">
              <Spinner />
            </div>
          ) : balances.isError || standing.isError ? (
            <p role="alert" className="py-6 text-center text-destructive">
              {t('common.somethingWentWrong')}
            </p>
          ) : (
            <>
              {standing.data ? <CrateStandingBar standing={standing.data} /> : null}

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  onClick={() => {
                    setIssueKey((k) => k + 1);
                    setIssueOpen(true);
                  }}
                >
                  <PackagePlus className="size-4" />
                  {t('crates.issue.title')}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setReturnKey((k) => k + 1);
                    setReturnOpen(true);
                  }}
                >
                  <PackageCheck className="size-4" />
                  {t('crates.return.title')}
                </Button>

                <label className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
                  <Switch checked={includeZero} onCheckedChange={setIncludeZero} />
                  {t('crates.showZero')}
                </label>
              </div>

              {rows.length === 0 ? (
                <EmptyState
                  title={t('crates.inField.empty.title')}
                  hint={t('crates.inField.empty.hint')}
                />
              ) : (
                <InFieldTable
                  rows={rows}
                  total={balances.data?.total ?? rows.length}
                  standing={standing.data}
                  truncated={isTruncated(balances.data)}
                  renderDocs={(supplierId) => (
                    <PersonCrateDocs supplierId={supplierId} isOwner={Boolean(isOwner)} />
                  )}
                />
              )}

              <p className="text-xs leading-relaxed text-muted-foreground">
                {t('crates.note.receiptVsDeposit')}
              </p>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {t('crates.note.withBerry')}
              </p>
            </>
          )}
        </div>
      </DashboardPage>

      {!needsPoint ? (
        <>
          <IssueCratesDialog
            key={`issue-${issueKey}`}
            pointId={isOwner ? (pointId ?? undefined) : undefined}
            open={issueOpen}
            onClose={() => setIssueOpen(false)}
          />
          <ReturnCratesDialog
            key={`return-${returnKey}`}
            pointId={isOwner ? (pointId ?? undefined) : undefined}
            open={returnOpen}
            onClose={() => setReturnOpen(false)}
          />
        </>
      ) : null}
    </>
  );
}
