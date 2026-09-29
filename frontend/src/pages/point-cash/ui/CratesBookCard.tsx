import { useTranslation } from 'react-i18next';
import { SectionCard } from '@/shared/ui/section-card';
import { formatUah } from '@/shared/lib/money';

/**
 * «Каса за ящики» (R1, R8) — the crates book, on its own, beside the berry
 * book on `PointCashPage`. The mock's dark «У шухляді має бути» block, which
 * ADDS the two books into one figure, is NOT ported: the client's «Правка»
 * under the 20:50 story says berry cash and crate deposits do not lie in one
 * drawer, and `point-cash.service.ts` (backend) already refuses to sum them.
 * The muted line at the bottom of this card prints BOTH figures side by
 * side — never their sum — for exactly the same reason.
 */
export function CratesBookCard({
  crateDeposits,
  crateDepositUnits,
  berryCash,
}: {
  /** `PointCashRow.crate_deposits` — money still held against issued crates. */
  crateDeposits: string;
  /** `PointCashRow.crate_deposit_units` (§R8) — issued «за кошти», not yet returned. */
  crateDepositUnits: number;
  /** `PointCashRow.cash` — the berry book's own figure, for the two-books line only. */
  berryCash: string;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage;

  return (
    <SectionCard eyebrow={t('pointCash.crates.title')}>
      <div className="font-mono text-[26px] leading-none font-semibold tracking-tight">
        {formatUah(crateDeposits, locale)}
      </div>
      <div className="mt-1.5 text-xs text-muted-foreground">
        {crateDepositUnits === 0
          ? t('pointCash.crates.captionZero')
          : t('pointCash.crates.caption', { count: crateDepositUnits })}
      </div>
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        {t('pointCash.crates.footnote')}
      </p>
      <p className="mt-3 text-xs text-muted-foreground opacity-70">
        {t('pointCash.crates.twoBooks', {
          berry: formatUah(berryCash, locale),
          crates: formatUah(crateDeposits, locale),
        })}
      </p>
    </SectionCard>
  );
}
