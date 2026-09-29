import { useState } from 'react';
import { useParams, Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/shared/ui/page-header';
import { StatGrid } from '@/shared/ui/stat-grid';
import { StatTile } from '@/shared/ui/stat-tile';
import { SectionCard } from '@/shared/ui/section-card';
import { Button } from '@/shared/ui/button';
import { Spinner } from '@/shared/ui/spinner';
import { ApiError, isTruncated } from '@/shared/api';
import { add, cmp, isZero, formatUah, formatKg } from '@/shared/lib/money';
import {
  useSupplierQuery,
  useSupplierBalanceQuery,
  useSupplierSettlementQuery,
  supplierName,
} from '@/entities/supplier';
import { useIntakesQuery, type Intake } from '@/entities/intake';
import { usePayoutsQuery, type Payout } from '@/entities/payout';
import { useIntakeTopUpsQuery, type IntakeTopUp } from '@/entities/intake-top-up';
import { useMeQuery } from '@/entities/user';
import { usePointOptionsQuery } from '@/entities/collection-point';
import { daysBetween, todayIso, formatShortDate } from '@/shared/lib/date';
import { PayoutDialog } from '@/features/settle-payout';
import { VoidDocumentDialog, reopenedCodes } from '@/features/void-document';
import { TopUpDialog } from '@/features/top-up-intake';
import { ReceiptDialog, useReceiptOpener } from '@/widgets/receipt';
import { OpenBalances } from './OpenBalances';
import { SupplierTimeline } from './SupplierTimeline';

/**
 * `/suppliers/:id` — one supplier's card: header, season tiles and the
 * merged history of their receipts and payouts (spec §5.4). Since #103/#148
 * the tiles are READ FACTS — `intakes_count` and `kg_total` off `/balance`,
 * `debt`, «Нараховано» and the breakdown line off `/settlement`'s one
 * snapshot (see `debt` below) — never a sum over
 * `intakes`/`payouts`/`topUps`, which stay capped at `limit: 100` and would
 * silently under-report past that for any supplier with a long season. Kind
 * and phone stay editable only from the suppliers list's own dialog; this
 * page is read (plus a payout).
 */
export function SupplierCardPage() {
  const { t, i18n } = useTranslation();
  const { id } = useParams<{ id: string }>();

  const supplier = useSupplierQuery(id ?? null);
  // The season counters (#103). No money on the card reads this — see `debt` below.
  const balance = useSupplierBalanceQuery(id ?? null);
  // `expandItems`: §148 — a receipt row shows what was handed over without a
  // click, which needs each intake's lines nested onto the list read.
  const intakes = useIntakesQuery({ supplierId: id, limit: 100, expandItems: true });
  const payouts = usePayoutsQuery({ supplierId: id, limit: 100 });
  const topUps = useIntakeTopUpsQuery({ supplierId: id, limit: 100 });
  // THE FOURTH QUERY — spec 2026-09-25 §3.8. The three lists stay for the
  // history (voided rows, reasons, authors); this one carries the arithmetic.
  const settlement = useSupplierSettlementQuery(id ?? null);
  const me = useMeQuery();
  const points = usePointOptionsQuery();

  const [payoutOpen, setPayoutOpen] = useState(false);
  const [payoutKey, setPayoutKey] = useState(0);
  const receipt = useReceiptOpener();
  const { openReceipt } = receipt;
  // ONE void dialog for both kinds. `features/void-document` grew a fourth
  // `kind` rather than this page growing a second dialog — a top-up is voided
  // by the same §9.3 rule, with the same required reason.
  const [voidTarget, setVoidTarget] = useState<
    | { kind: 'payout'; id: string; code: string; amount: string; shiftClosed: boolean }
    | { kind: 'topUp'; id: string; code: string }
    | null
  >(null);
  const [voidOpen, setVoidOpen] = useState(false);
  const [voidKey, setVoidKey] = useState(0);
  const [topUpTarget, setTopUpTarget] = useState<Intake | null>(null);
  const [topUpOpen, setTopUpOpen] = useState(false);
  const [topUpKey, setTopUpKey] = useState(0);

  const openPayout = () => {
    setPayoutKey((k) => k + 1);
    setPayoutOpen(true);
  };
  const openVoidPayout = (target: Payout) => {
    setVoidTarget({
      kind: 'payout',
      id: target.id,
      code: target.code,
      amount: target.amount,
      shiftClosed: target.shift_closed,
    });
    setVoidKey((k) => k + 1);
    setVoidOpen(true);
  };
  // A top-up has no code of its own, so the dialog is titled with its PARENT
  // receipt's — that is what the owner recognises.
  const openVoidTopUp = (target: IntakeTopUp) => {
    setVoidTarget({ kind: 'topUp', id: target.id, code: target.intake.code });
    setVoidKey((k) => k + 1);
    setVoidOpen(true);
  };
  const openTopUp = (intake: Intake) => {
    setTopUpTarget(intake);
    setTopUpKey((k) => k + 1);
    setTopUpOpen(true);
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

  if (
    supplier.isError ||
    intakes.isError ||
    payouts.isError ||
    topUps.isError ||
    settlement.isError ||
    balance.isError
  ) {
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
    intakes.isPending ||
    payouts.isPending ||
    topUps.isPending ||
    settlement.isPending ||
    balance.isPending ||
    !supplier.data ||
    !settlement.data ||
    !balance.data
  ) {
    return (
      <div className="flex justify-center py-12">
        <Spinner />
      </div>
    );
  }

  const s = supplier.data;
  // EVERY MONEY FIGURE ON THE CARD READS ONE SNAPSHOT: `settlement.data` —
  // the balance tile, its hint, «Нараховано», the breakdown line under them
  // and OpenBalances. Two separate requests can land either side of a write
  // (or one can be served from cache), and then the line explaining the tile
  // would not add up to it (#153). `balance.data` feeds only the two counters.
  const debt = settlement.data.debt;
  const pointName = (points.data ?? []).find((p) => p.id === s.collection_point_id)?.name ?? '';

  const intakeRows = intakes.data?.data ?? [];
  const payoutRows = payouts.data?.data ?? [];
  const topUpRows = topUps.data?.data ?? [];
  // All three journals are read at a fixed `limit: 100` (spec §5.4) — the
  // TIMELINE below can under-report past that, so it says so. The tiles
  // above it cannot: they read server-computed season totals this flag never
  // touches (§103/#148).
  const truncated =
    isTruncated(intakes.data) || isTruncated(payouts.data) || isTruncated(topUps.data);

  const st = settlement.data;
  const intakesById = new Map(intakeRows.map((i) => [i.id, i]));
  const openByLineId = new Map(st.lines.map((l) => [l.id, l.open]));
  const lineDate = new Map(st.lines.map((l) => [l.id, l.business_date]));
  const coversByPayoutId = new Map(
    st.payouts.map((p) => {
      const dates = [...new Set(p.covers.map((c) => lineDate.get(c.line_id) ?? ''))]
        .filter((d) => d !== '')
        .sort();
      return [p.id, { dates, unallocated: p.unallocated }];
    }),
  );
  const oldestOpen = st.lines.find((l) => !isZero(l.open));
  const balanceHint = oldestOpen
    ? t('supplierCard.open.oldest', {
        date: formatShortDate(oldestOpen.business_date, i18n.language),
        // A business_date after "today" (a reopened-shift receipt, a clock
        // skew) must never print a negative day count.
        count: Math.max(0, daysBetween(oldestOpen.business_date, todayIso())),
      })
    : isZero(debt)
      ? t('supplierCard.tiles.balanceHint')
      : undefined;

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

      <StatGrid columns={4} className="mb-1.5">
        <StatTile
          label={t('supplierCard.tiles.seasonIntakes')}
          value={String(balance.data.intakes_count)}
        />
        <StatTile
          label={t('supplierCard.tiles.kgTotal')}
          value={formatKg(balance.data.kg_total, i18n.language)}
        />
        {/* Credited to the supplier: receipts AND top-ups, so it can never
            read less than a balance nothing has been paid against (#153). */}
        <StatTile
          label={t('supplierCard.tiles.accrued')}
          value={formatUah(add(st.intakes_total, st.top_ups_total), i18n.language)}
        />
        <StatTile
          label={t('supplierCard.tiles.balance')}
          value={formatUah(debt, i18n.language)}
          tone={cmp(debt, '0') === 1 ? 'amber' : 'leaf'}
          hint={balanceHint}
        />
      </StatGrid>

      {/* §103: `debt` decomposed into the same three terms the SQL sums it
          from, each one named — the only place the season's payout total
          appears on the card. A zero top-up term is dropped, not printed. */}
      <p className="mb-5 text-right text-xs text-muted-foreground">
        {t(isZero(st.top_ups_total) ? 'supplierCard.breakdownNoTopUps' : 'supplierCard.breakdown', {
          intakes: formatUah(st.intakes_total, i18n.language),
          topUps: formatUah(st.top_ups_total, i18n.language),
          payouts: formatUah(st.payouts_total, i18n.language),
        })}
      </p>

      <OpenBalances
        lines={st.lines}
        unallocated={st.unallocated}
        intakesById={intakesById}
        locale={i18n.language}
      />

      <SectionCard eyebrow={t('supplierCard.timeline.title')}>
        <SupplierTimeline
          intakes={intakeRows}
          payouts={payoutRows}
          topUps={topUpRows}
          me={me.data}
          openByLineId={openByLineId}
          coversByPayoutId={coversByPayoutId}
          onOpenReceipt={openReceipt}
          onVoidPayout={openVoidPayout}
          onAddTopUp={openTopUp}
          onVoidTopUp={openVoidTopUp}
        />
        {truncated ? (
          <p className="mt-3 text-xs text-muted-foreground">
            {t('supplierCard.timeline.truncated')}
          </p>
        ) : null}
      </SectionCard>

      <ReceiptDialog
        key={receipt.receiptId ?? 'none'}
        intakeId={receipt.receiptId}
        open={receipt.open}
        startWithVoid={receipt.startWithVoid}
        onClose={receipt.close}
      />

      {voidTarget ? (
        <VoidDocumentDialog
          key={voidKey}
          kind={voidTarget.kind}
          id={voidTarget.id}
          code={voidTarget.code}
          open={voidOpen}
          onClose={() => setVoidOpen(false)}
          {...(voidTarget.kind === 'payout'
            ? {
                shiftClosed: voidTarget.shiftClosed,
                payoutAmount: voidTarget.amount,
                reopens: reopenedCodes(st, voidTarget.id, null),
              }
            : {})}
        />
      ) : null}

      {topUpTarget ? (
        <TopUpDialog
          key={topUpKey}
          intake={{ id: topUpTarget.id, code: topUpTarget.code }}
          supplierName={supplierName(s)}
          open={topUpOpen}
          onClose={() => setTopUpOpen(false)}
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
