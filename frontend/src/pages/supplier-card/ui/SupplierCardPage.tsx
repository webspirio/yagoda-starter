import { useState } from 'react';
import { useParams, Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/shared/ui/page-header';
import { StatGrid } from '@/shared/ui/stat-grid';
import { StatTile } from '@/shared/ui/stat-tile';
import { SectionCard } from '@/shared/ui/section-card';
import { Button } from '@/shared/ui/button';
import { Spinner } from '@/shared/ui/spinner';
import { ApiError } from '@/shared/api';
import { sum, cmp, isZero, formatUah } from '@/shared/lib/money';
import { useSupplierQuery, useSupplierBalanceQuery, supplierName } from '@/entities/supplier';
import { useIntakesQuery } from '@/entities/intake';
import { usePayoutsQuery, type Payout } from '@/entities/payout';
import { useMeQuery } from '@/entities/user';
import { usePointOptionsQuery } from '@/entities/collection-point';
import { PayoutDialog } from '@/features/settle-payout';
import { VoidDocumentDialog } from '@/features/void-document';
import { ReceiptDialog } from '@/widgets/receipt';
import { SupplierTimeline } from './SupplierTimeline';

/**
 * `/suppliers/:id` — one supplier's card: header, season tiles and the
 * merged history of their receipts and payouts (spec §5.4). A balance is
 * ONE number here too (§3) — the tiles total the loaded documents, they
 * never reconstruct `/balance` from them. Kind and phone stay editable only
 * from the suppliers list's own dialog; this page is read (plus a payout).
 */
export function SupplierCardPage() {
  const { t, i18n } = useTranslation();
  const { id } = useParams<{ id: string }>();

  const supplier = useSupplierQuery(id ?? null);
  const balance = useSupplierBalanceQuery(id ?? null);
  const intakes = useIntakesQuery({ supplierId: id, limit: 100 });
  const payouts = usePayoutsQuery({ supplierId: id, limit: 100 });
  const me = useMeQuery();
  const points = usePointOptionsQuery();

  const [payoutOpen, setPayoutOpen] = useState(false);
  const [payoutKey, setPayoutKey] = useState(0);
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [voidTarget, setVoidTarget] = useState<Payout | null>(null);
  const [voidOpen, setVoidOpen] = useState(false);
  const [voidKey, setVoidKey] = useState(0);

  const openPayout = () => {
    setPayoutKey((k) => k + 1);
    setPayoutOpen(true);
  };
  const openReceipt = (intakeId: string) => {
    setReceiptId(intakeId);
    setReceiptOpen(true);
  };
  const openVoid = (target: Payout) => {
    setVoidTarget(target);
    setVoidKey((k) => k + 1);
    setVoidOpen(true);
  };

  // §3: 404 is the one case with its own page — a supplier that never
  // existed or was somehow deleted (suppliers are never actually deleted,
  // but a stale/hand-edited link is still possible). Every other query
  // failure (including a non-404 supplier error) is the shared banner.
  const notFound =
    supplier.isError && supplier.error instanceof ApiError && supplier.error.status === 404;

  if (notFound) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center text-muted-foreground">
        <p>{t('supplierCard.notFound')}</p>
        <Link to="/suppliers" className="text-sm underline">
          {t('supplierCard.backLink')}
        </Link>
      </div>
    );
  }

  if (supplier.isError || balance.isError || intakes.isError || payouts.isError) {
    return (
      <div className="flex flex-col items-center gap-3 py-6 text-center">
        <p role="alert" className="text-destructive">
          {t('common.somethingWentWrong')}
        </p>
        <Link to="/suppliers" className="text-sm underline">
          {t('supplierCard.backLink')}
        </Link>
      </div>
    );
  }

  if (
    supplier.isPending ||
    balance.isPending ||
    intakes.isPending ||
    payouts.isPending ||
    !supplier.data ||
    !balance.data
  ) {
    return (
      <div className="flex justify-center py-12">
        <Spinner />
      </div>
    );
  }

  const s = supplier.data;
  const debt = balance.data.debt;
  const pointName = (points.data ?? []).find((p) => p.id === s.collection_point_id)?.name ?? '';

  const intakeRows = intakes.data?.data ?? [];
  const payoutRows = payouts.data?.data ?? [];
  const liveIntakes = intakeRows.filter((i) => i.voided_at === null);
  const livePayouts = payoutRows.filter((p) => p.voided_at === null);
  const accrued = sum(liveIntakes.map((i) => i.amount));
  const paid = sum(livePayouts.map((p) => p.amount));
  // Both journals are read at a fixed `limit: 100` (spec §5.4) — past that
  // the «Нараховано»/«Видано» tiles would under-report the season, so each
  // says so instead of quietly summing only what happened to load.
  const truncated = intakes.data ? intakes.data.total > intakes.data.data.length : false;
  const payoutsTruncated = payouts.data ? payouts.data.total > payouts.data.data.length : false;

  return (
    <>
      <Link
        to="/suppliers"
        className="mb-3 inline-block text-sm text-muted-foreground hover:text-foreground hover:underline"
      >
        ← {t('supplierCard.backLink')}
      </Link>

      <PageHeader
        eyebrow={t('supplierCard.eyebrow', {
          point: pointName,
          kind: t(`suppliers.kindLabel.${s.kind}`),
        })}
        title={supplierName(s)}
        description={
          <>
            {s.phone ?? t('supplierCard.noPhone')}
            {s.note ? <> · {t('supplierCard.note', { note: s.note })}</> : null}
          </>
        }
        actions={
          cmp(debt, '0') === 1 ? (
            <Button onClick={openPayout}>
              {t('supplierCard.payOut', { uah: formatUah(debt, i18n.language) })}
            </Button>
          ) : undefined
        }
      />

      <StatGrid columns={4} className="mb-5">
        <StatTile
          label={t('supplierCard.tiles.seasonIntakes')}
          value={String(intakes.data?.total ?? 0)}
        />
        <StatTile
          label={t('supplierCard.tiles.accrued')}
          value={formatUah(accrued, i18n.language)}
          hint={truncated ? t('supplierCard.tiles.accruedHint') : undefined}
        />
        <StatTile
          label={t('supplierCard.tiles.paid')}
          value={formatUah(paid, i18n.language)}
          hint={payoutsTruncated ? t('supplierCard.tiles.accruedHint') : undefined}
        />
        <StatTile
          label={t('supplierCard.tiles.balance')}
          value={formatUah(debt, i18n.language)}
          tone={cmp(debt, '0') === 1 ? 'amber' : 'leaf'}
          hint={isZero(debt) ? t('supplierCard.tiles.balanceHint') : undefined}
        />
      </StatGrid>

      <SectionCard eyebrow={t('supplierCard.timeline.title')}>
        <SupplierTimeline
          intakes={intakeRows}
          payouts={payoutRows}
          me={me.data}
          onOpenReceipt={openReceipt}
          onVoidPayout={openVoid}
        />
        {truncated || payoutsTruncated ? (
          <p className="mt-3 text-xs text-muted-foreground">
            {t('supplierCard.timeline.truncated')}
          </p>
        ) : null}
      </SectionCard>

      <ReceiptDialog
        key={receiptId ?? 'none'}
        intakeId={receiptId}
        open={receiptOpen}
        onClose={() => setReceiptOpen(false)}
      />

      {voidTarget ? (
        <VoidDocumentDialog
          key={voidKey}
          kind="payout"
          id={voidTarget.id}
          code={voidTarget.code}
          open={voidOpen}
          onClose={() => setVoidOpen(false)}
        />
      ) : null}

      <PayoutDialog
        key={payoutKey}
        supplier={{ id: s.id, first_name: s.first_name, last_name: s.last_name }}
        pointId={s.collection_point_id}
        debt={debt}
        defaultAmount={debt}
        open={payoutOpen}
        onClose={() => setPayoutOpen(false)}
      />
    </>
  );
}
