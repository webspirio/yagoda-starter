import { useState } from 'react';
import { Boxes, PackageCheck, PackagePlus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/shared/ui/page-header';
import { Card } from '@/shared/ui/card';
import { Button } from '@/shared/ui/button';
import { Badge } from '@/shared/ui/badge';
import { SelectField } from '@/shared/ui/select-field';
import { EmptyState } from '@/shared/ui/empty-state';
import { Spinner } from '@/shared/ui/spinner';
import { formatUah, isZero } from '@/shared/lib/money';
import { useMeQuery, usePointScope } from '@/entities/user';
import { usePointOptionsQuery } from '@/entities/collection-point';
import { useCrateBalancesQuery } from '@/entities/crate';
import { IssueCratesDialog } from '@/features/issue-crates';
import { ReturnCratesDialog } from '@/features/return-crates';

/**
 * «ЯЩИКИ» — who at this point is still holding crates, and on what terms.
 *
 * WHAT THIS SCREEN DELIBERATELY DOES NOT SHOW. The mock's standing bar carries
 * four figures — Наділ, Пустих на точці, У людей, У нас з ягодою — and a
 * «Відправлення за сьогодні» dialog. Two of those and the shipments dialog
 * rest on on-hand and shipment tracking, and `crate_shipments` is NOT among
 * the DBML's seventeen tables: there is no backend for it and no honest number
 * to print. They are absent rather than faked, and the caption below the
 * table says so, because a reader who knows the mock will otherwise assume a
 * bug.
 *
 * TWO FIGURES ARE REAL: the allotment (`collection_points.target_crates`) and
 * what is out with people (`GET /crate-balances`).
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
 */
export function CratesPage() {
  const { t, i18n } = useTranslation();
  const { data: me } = useMeQuery();
  const { pointId, canPick, setPointId } = usePointScope();
  const { data: points } = usePointOptionsQuery();

  const isOwner = me?.role === 'network_owner';
  const balances = useCrateBalancesQuery({ pointId, isOwner: Boolean(isOwner) });

  const [issueOpen, setIssueOpen] = useState(false);
  const [issueKey, setIssueKey] = useState(0);
  const [returnOpen, setReturnOpen] = useState(false);
  const [returnKey, setReturnKey] = useState(0);

  const point = (points ?? []).find((p) => p.id === pointId);
  const rows = balances.data?.data ?? [];
  // A row COUNT. Never summed with a money value — see `entities/crate`'s header.
  const inField = rows.reduce((total, row) => total + row.outstanding_units, 0);
  const allotment = point?.target_crates ?? null;
  const overAllotment = allotment !== null && inField > allotment;

  const needsPoint = Boolean(isOwner) && pointId === null;

  return (
    <>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-6">
        <PageHeader
          eyebrow={t('crates.eyebrow')}
          title={t('crates.title')}
          description={t('crates.description')}
          actions={
            canPick ? (
              <div className="w-full max-w-xs">
                <SelectField
                  aria-label={t('crates.pickPoint')}
                  value={pointId ?? ''}
                  onChange={(e) => setPointId(e.target.value || null)}
                >
                  <option value="">{t('crates.pickPoint')}</option>
                  {(points ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </SelectField>
              </div>
            ) : undefined
          }
        />

        {needsPoint ? (
          <EmptyState title={t('crates.empty.title')} hint={t('crates.empty.hint')} />
        ) : balances.isPending ? (
          <div className="flex justify-center py-12">
            <Spinner />
          </div>
        ) : balances.isError ? (
          <p role="alert" className="py-6 text-center text-destructive">
            {t('common.somethingWentWrong')}
          </p>
        ) : (
          <>
            <Card className="flex flex-wrap items-baseline gap-x-8 gap-y-3 px-4 py-3.5">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  {t('crates.standing.allotment')}
                </p>
                <p className="mt-1 font-mono text-[26px] leading-none font-semibold">
                  {/* «—» is «не задано», NOT zero: a zero would claim there
                      should be no crates here at all. */}
                  {allotment === null ? '—' : allotment}
                </p>
              </div>
              <div>
                <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  {t('crates.standing.inField')}
                </p>
                <p className="mt-1 font-mono text-[26px] leading-none font-semibold">{inField}</p>
              </div>
              {overAllotment ? (
                <p className="w-full rounded-lg bg-[var(--amber)]/12 px-2.5 py-1.5 text-xs text-[var(--amber)]">
                  {t('crates.standing.overAllotment', { over: inField - (allotment ?? 0) })}
                </p>
              ) : null}
            </Card>

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
            </div>

            {rows.length === 0 ? (
              <EmptyState
                title={t('crates.inField.empty.title')}
                hint={t('crates.inField.empty.hint')}
              />
            ) : (
              <Card className="overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-sm">
                    <caption className="sr-only">{t('crates.inField.title')}</caption>
                    <thead>
                      <tr className="border-b border-line2">
                        <th scope="col" className="px-4 py-3 text-left font-medium text-muted-foreground">
                          {t('crates.inField.col.person')}
                        </th>
                        <th scope="col" className="px-4 py-3 text-right font-medium text-muted-foreground">
                          {t('crates.inField.col.units')}
                        </th>
                        <th scope="col" className="px-4 py-3 text-left font-medium text-muted-foreground">
                          {t('crates.inField.col.how')}
                        </th>
                        <th scope="col" className="px-4 py-3 text-right font-medium text-muted-foreground">
                          {t('crates.inField.col.deposit')}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr key={row.supplier_id} className="border-b border-line2/60 last:border-0">
                          <th scope="row" className="px-4 py-2.5 text-left font-medium">
                            {row.first_name} {row.last_name}
                            {row.is_active ? null : (
                              <Badge variant="outline" className="ml-2">
                                {t('crates.inField.inactive')}
                              </Badge>
                            )}
                          </th>
                          <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                            {row.outstanding_units}
                          </td>
                          <td className="px-4 py-2.5 text-left">
                            {/* A person can hold BOTH kinds at once — two
                                issuances, two modes, one balance — so this
                                cannot be a two-way branch on `has_receipt`
                                alone. Calling that row «розписка» would be a
                                half-truth about where the money is. */}
                            {!row.has_receipt
                              ? t('crates.mode.deposit')
                              : isZero(row.deposit_held)
                                ? t('crates.mode.receipt')
                                : t('crates.mode.mixed')}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                            {/* «—» ONLY when there is no cash cover at all.
                                A zero would read as «the deposit came back»,
                                and a dash over a real 2 400 ₴ would hide money
                                the point is actually holding — which is why
                                this reads the AMOUNT, not just the flag. */}
                            {row.has_receipt && isZero(row.deposit_held) ? (
                              <span className="text-muted-foreground">—</span>
                            ) : (
                              formatUah(row.deposit_held, i18n.language)
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-line2 font-medium">
                        <th scope="row" className="px-4 py-2.5 text-left">
                          {t('crates.inField.total')}
                        </th>
                        <td className="px-4 py-2.5 text-right font-mono tabular-nums">{inField}</td>
                        <td colSpan={2} />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </Card>
            )}

            <p className="text-xs leading-relaxed text-muted-foreground">
              {t('crates.note.receiptVsDeposit')}
            </p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              <Boxes className="mr-1 inline size-3.5" aria-hidden="true" />
              {t('crates.note.notTracked')}
            </p>
          </>
        )}
      </div>

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
