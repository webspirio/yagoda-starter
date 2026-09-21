import { useTranslation } from 'react-i18next';
import { Eyebrow } from '@/shared/ui/eyebrow';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';
import { cn } from '@/shared/lib/cn';
import { cmp, formatKg, formatUah, isNegative, sub, sum } from '@/shared/lib/money';
import type { ReconciliationProduct } from '@/entities/reweigh';
import type { Draft } from '../model/draft';

const ZERO = '0.00';

/**
 * §3.7's звірка, one row per PRODUCT. Every cell but the two footnotes below
 * the table is the SERVER's own number — `intake_net_kg`, `reweigh_net_kg`,
 * `missing_kg`, `missing_amount` all arrive computed, and none of them is
 * re-derived from `drafts` here. Drafts get their own line beneath the
 * table (`check.drafted`) instead of being folded into «Наша»: `missing_kg`
 * is the server's verdict on «Наша» vs «Пункт», and mixing an unposted
 * draft into that sum would leave «Різниця» half-server, half-browser next
 * to a money claim.
 *
 * Three states never collapse into one another (spec §3.9/§3.15): a real
 * difference (`state: 'weighed'`, `missing_kg` non-null, SIGNED — negative
 * is a надлишок/surplus, never shown as a bare minus), «не перезважено»
 * (`state: 'not_reweighed'`, a STATE and never a zero, row tinted amber),
 * and the shift still open (every `missing_kg` null — the claim waits for
 * the close, §3.9).
 */
export function Reconciliation({
  products,
  drafts,
  shiftClosed,
  acceptedAnything,
  pointName,
}: {
  products: ReconciliationProduct[];
  drafts: Draft[];
  shiftClosed: boolean;
  acceptedAnything: boolean;
  pointName: string;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? 'uk';

  // Totals sum ONLY the products whose `missing_kg` is non-null — a product
  // still «не перезважено» or waiting on an open shift contributes nothing,
  // never a silent zero.
  const priced = products.filter((p) => p.missing_kg !== null);
  const totalKg = priced.length ? sum(priced.map((p) => p.missing_kg as string)) : null;
  const totalUah = priced.length ? sum(priced.map((p) => p.missing_amount as string)) : null;
  const totalIsSurplus = totalKg !== null && isNegative(totalKg);
  const notWeighedCount = products.filter((p) => p.state === 'not_reweighed').length;
  const draftedKg = drafts.length ? sum(drafts.map((d) => d.net_kg)) : null;
  const hasRows = acceptedAnything && products.length > 0;

  return (
    <div className="rounded-xl bg-card ring-1 ring-foreground/10">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/70 px-4 py-3">
        <Eyebrow>{t('reweigh.check.title')}</Eyebrow>
        <span className="text-xs text-muted-foreground">{t('reweigh.check.byProduct')}</span>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">{t('reweigh.check.product')}</TableHead>
            <TableHead scope="col" className="text-right">{t('reweigh.check.point')}</TableHead>
            <TableHead scope="col" className="text-right">{t('reweigh.check.ours')}</TableHead>
            <TableHead scope="col" className="text-right">{t('reweigh.check.diff')}</TableHead>
            <TableHead scope="col" className="text-right">{t('reweigh.check.money')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {hasRows ? (
            products.map((product) => (
              <ReconciliationRow key={product.product_id} product={product} locale={locale} notReweighedText={t('reweigh.check.notReweighed')} />
            ))
          ) : (
            <TableRow>
              <TableCell colSpan={5} className="text-sm text-muted-foreground">
                {t('reweigh.check.nothingAccepted', { point: pointName })}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      <div className="border-t border-border/70 px-4 py-3">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-sm text-muted-foreground">
            {totalKg === null
              ? '—'
              : t(totalIsSurplus ? 'reweigh.check.surplusTotal' : 'reweigh.check.shortfallTotal')}
          </span>
          {totalKg !== null && totalUah !== null ? (
            <span
              className={cn('font-mono font-semibold', !totalIsSurplus && 'text-destructive')}
            >
              {formatKg(totalIsSurplus ? sub(ZERO, totalKg) : totalKg, locale)} ·{' '}
              {formatUah(totalIsSurplus ? sub(ZERO, totalUah) : totalUah, locale)}
            </span>
          ) : null}
        </div>
        {totalKg === null && !shiftClosed ? (
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{t('reweigh.check.shiftOpen')}</p>
        ) : null}
        {notWeighedCount > 0 ? (
          <p className="mt-2 rounded-lg bg-[var(--amber)]/10 px-3 py-2 text-xs leading-relaxed text-[var(--amber)]">
            {t('reweigh.check.notWeighed', { count: notWeighedCount })}
          </p>
        ) : null}
        {draftedKg !== null ? (
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            {t('reweigh.check.drafted', { kg: formatKg(draftedKg, locale) })}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** One product's row — kept a plain function, not a component export: it has
 *  no reason to be reused outside this table. */
function ReconciliationRow({
  product,
  locale,
  notReweighedText,
}: {
  product: ReconciliationProduct;
  locale: string;
  notReweighedText: string;
}) {
  return (
    <TableRow className={product.state === 'not_reweighed' ? 'bg-[var(--amber)]/8' : undefined}>
      <TableCell className="font-medium">{product.product_name}</TableCell>
      <TableCell className="text-right font-mono tabular-nums">
        {formatKg(product.intake_net_kg, locale)}
      </TableCell>
      <TableCell className="text-right font-mono tabular-nums">
        {product.state === 'not_reweighed' ? (
          <span className="text-[var(--amber)]">{notReweighedText}</span>
        ) : (
          formatKg(product.reweigh_net_kg, locale)
        )}
      </TableCell>
      <SignedCell value={product.missing_kg} locale={locale} format={formatKg} />
      <SignedCell value={product.missing_amount} locale={locale} format={formatUah} />
    </TableRow>
  );
}

/**
 * `missing_kg`/`missing_amount` are SIGNED: negative is a надлишок/surplus,
 * which must read as a surplus (a leading `+` on the absolute value) and
 * never as a bare minus in front of what looks like a shortfall. `null`
 * (open shift, or a state that never prices) renders `—` — the one thing it
 * is never allowed to render is `0`.
 */
function SignedCell({
  value,
  locale,
  format,
}: {
  value: string | null;
  locale: string;
  format: (value: string, locale?: string) => string;
}) {
  if (value === null) {
    return <TableCell className="text-right font-mono tabular-nums">—</TableCell>;
  }
  const isSurplus = isNegative(value);
  const shortfall = !isSurplus && cmp(value, ZERO) > 0;
  const shown = isSurplus ? sub(ZERO, value) : value;
  return (
    <TableCell className={cn('text-right font-mono tabular-nums', shortfall && 'text-destructive')}>
      {isSurplus ? '+' : ''}
      {format(shown, locale)}
    </TableCell>
  );
}
