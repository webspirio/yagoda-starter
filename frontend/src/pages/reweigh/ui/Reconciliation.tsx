import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Eyebrow } from '@/shared/ui/eyebrow';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';
import { cn } from '@/shared/lib/cn';
import { cmp, formatDecimal, formatKg, formatUah, sub, sum } from '@/shared/lib/money';
import type {
  ReconciliationCrates,
  ReconciliationGrade,
  ReconciliationProduct,
} from '@/entities/reweigh';
import type { Draft } from '../model/draft';

const ZERO = '0.00';

/**
 * §3.7's звірка, one row per PRODUCT. EVERY FIGURE IS THE SERVER'S —
 * `intake_net_kg`, `reweigh_net_kg`, `missing_kg`, `rate`, `missing_amount`,
 * the crate counts and the day's `missing_total_*` all arrive computed; the
 * browser formats and colours them and derives none of them (spec 2026-10-23
 * W2: the browser total used to let one berry's surplus cancel another's
 * shortfall). The one sum here is the unposted drafts' preview line, which is
 * explicitly NOT part of the звірка.
 *
 * Colour is one concept: amber is недостача — «−1,40» and «1,40 × 189,42 =
 * 265,19 ₴», the formula a calculator re-checks (W3). A surplus is data, muted,
 * with no money claim (§8.2 правка: «надлишок неможливий»).
 *
 * Under each product, muted: the tare units point → base per type (W5, from
 * `intake_item_tare_types` / `reweigh_item_tare_types`, never inferred from kg),
 * and — when the product had more than one grade — a sub-row per grade with its
 * point and base kilograms, so a пересорт (crates moved between grades at equal
 * weight) reads at a glance.
 *
 * Three states never collapse into one another (spec §3.9/§3.15): a real
 * difference, «не перезважено» (a STATE, never a zero) and the shift still
 * open (every `missing_kg` null — the claim waits for the close).
 */
export function Reconciliation({
  products,
  grades,
  missingTotalKg,
  missingTotalAmount,
  drafts,
  shiftClosed,
  acceptedAnything,
  pointName,
}: {
  products: ReconciliationProduct[];
  grades: ReconciliationGrade[];
  missingTotalKg: string | null;
  missingTotalAmount: string | null;
  drafts: Draft[];
  shiftClosed: boolean;
  acceptedAnything: boolean;
  pointName: string;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? 'uk';

  const notWeighedCount = products.filter((p) => p.state === 'not_reweighed').length;
  const draftedKg = drafts.length ? sum(drafts.map((d) => d.net_kg)) : null;
  const hasRows = acceptedAnything && products.length > 0;
  const totalShort =
    missingTotalKg !== null && missingTotalAmount !== null && cmp(missingTotalKg, ZERO) > 0;
  // E5 — each priced shortfall's rate, written as the division it is.
  const rated = products.filter(
    (p) => p.rate !== null && p.missing_kg !== null && cmp(p.missing_kg, ZERO) > 0,
  );

  return (
    <div className="rounded-xl border border-line2 bg-card">
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
            products.map((product) => {
              const productGrades = grades.filter((g) => g.product_id === product.product_id);
              return (
                <Fragment key={product.product_id}>
                  <ReconciliationRow product={product} locale={locale} t={t} />
                  {productGrades.length > 1
                    ? productGrades.map((grade) => (
                        <GradeRow key={grade.product_grade_id} grade={grade} locale={locale} t={t} />
                      ))
                    : null}
                </Fragment>
              );
            })
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
          <span className="text-sm text-muted-foreground">{t('reweigh.check.shortfallTotal')}</span>
          <span
            data-testid="missing-total"
            className={cn(
              'font-mono font-semibold whitespace-nowrap',
              totalShort ? 'text-amber' : 'text-muted-foreground',
            )}
          >
            {/* Unsigned: the label already says «Недостача» (rule 5 of the
                2026-10-24 audit — a label agrees with its sign). */}
            {missingTotalKg === null || missingTotalAmount === null
              ? '—'
              : t('reweigh.check.totalValue', {
                  kg: formatKg(missingTotalKg, locale),
                  amount: formatUah(missingTotalAmount, locale),
                })}
          </span>
        </div>
        {rated.map((p) => (
          <p
            key={p.product_id}
            data-testid="rate-line"
            className="mt-2 font-mono text-xs leading-relaxed text-muted-foreground"
          >
            {t(p.top_ups === ZERO ? 'reweigh.check.rate' : 'reweigh.check.rateTopUps', {
              product: p.product_name,
              accrued: formatDecimal(p.accrued, locale),
              kg: formatDecimal(p.intake_net_kg, locale),
              rate: formatDecimal(p.rate as string, locale),
            })}
          </p>
        ))}
        {missingTotalKg === null && !shiftClosed ? (
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{t('reweigh.check.shiftOpen')}</p>
        ) : null}
        {notWeighedCount > 0 ? (
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
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

/** «Ящик 136 → 136 · Лубянка 4 → 4» — `null` when neither side counted a unit. */
function cratesLine(t: TFunction, crates: ReconciliationCrates): { text: string; differs: boolean } | null {
  if (crates.by_type.length === 0) return null;
  return {
    text: crates.by_type
      .map((type) =>
        t('reweigh.check.cratesType', { name: type.tare_type_name, point: type.point, base: type.base }),
      )
      .join(t('reweigh.check.cratesJoin')),
    differs: crates.by_type.some((type) => type.point !== type.base),
  };
}

function CratesNote({ t, crates }: { t: TFunction; crates: ReconciliationCrates }) {
  const line = cratesLine(t, crates);
  if (!line) return null;
  return (
    <div
      data-testid="crates-line"
      className={cn('mt-0.5 font-mono text-xs font-normal', line.differs ? 'text-amber' : 'text-muted-foreground')}
    >
      {line.text}
    </div>
  );
}

/** One product's row — kept a plain function, not a component export: it has
 *  no reason to be reused outside this table. */
function ReconciliationRow({
  product,
  locale,
  t,
}: {
  product: ReconciliationProduct;
  locale: string;
  t: TFunction;
}) {
  return (
    <TableRow>
      <TableCell className="font-medium">
        {product.product_name}
        <CratesNote t={t} crates={product.crates} />
      </TableCell>
      <TableCell className="text-right font-mono tabular-nums whitespace-nowrap">
        {formatDecimal(product.intake_net_kg, locale)}
      </TableCell>
      <TableCell className="text-right font-mono tabular-nums whitespace-nowrap">
        {product.state === 'not_reweighed' ? (
          <span className="text-muted-foreground">{t('reweigh.check.notReweighed')}</span>
        ) : (
          formatDecimal(product.reweigh_net_kg, locale)
        )}
      </TableCell>
      <DiffCell value={product.missing_kg} locale={locale} t={t} />
      <MoneyCell product={product} locale={locale} t={t} />
    </TableRow>
  );
}

/** A grade under its product: point kg next to base kg, muted, no money —
 *  пересорт is information, the недостача belongs to the product. */
function GradeRow({ grade, locale, t }: { grade: ReconciliationGrade; locale: string; t: TFunction }) {
  return (
    <TableRow className="text-xs text-muted-foreground hover:bg-transparent">
      <TableCell className="py-1.5 pl-6">
        {grade.product_grade_name}
        <CratesNote t={t} crates={grade.crates} />
      </TableCell>
      <TableCell className="py-1.5 text-right font-mono tabular-nums whitespace-nowrap">
        {formatDecimal(grade.intake_net_kg, locale)}
      </TableCell>
      <TableCell className="py-1.5 text-right font-mono tabular-nums whitespace-nowrap">
        {/* '0.00' is the server's «nothing weighed for this grade» — a dash, never a zero. */}
        {cmp(grade.reweigh_net_kg, ZERO) === 0 ? '—' : formatDecimal(grade.reweigh_net_kg, locale)}
      </TableCell>
      <TableCell className="py-1.5" />
      <TableCell className="py-1.5" />
    </TableRow>
  );
}

/**
 * `missing_kg` is SIGNED: positive is a недостача, printed «−1,40» in
 * amber (§8.2's «НЕДОСТАЧА −10 кг»); negative is a surplus, printed «+x кг»
 * muted. `null` (open shift, or a state that never prices) renders `—` — the
 * one thing it is never allowed to render is `0`.
 */
function DiffCell({ value, locale, t }: { value: string | null; locale: string; t: TFunction }) {
  if (value === null) {
    return <TableCell className="text-right font-mono tabular-nums">—</TableCell>;
  }
  const sign = cmp(value, ZERO);
  return (
    <TableCell
      className={cn(
        'text-right font-mono tabular-nums whitespace-nowrap',
        sign > 0 ? 'text-amber' : 'text-muted-foreground',
      )}
    >
      {sign > 0
        ? t('reweigh.check.shortfallKg', { kg: formatDecimal(value, locale) })
        : sign < 0
          ? // Negating a sign for display — the figure itself is the server's.
            t('reweigh.check.surplusKg', { kg: formatDecimal(sub(ZERO, value), locale) })
          : formatDecimal(value, locale)}
    </TableCell>
  );
}

/** «1,40 × 189,42 = 265,19» for a shortfall (₴ in the header); nothing for a surplus or an
 *  exact match — a surplus makes no money claim (§8.2 правка). */
function MoneyCell({ product, locale, t }: { product: ReconciliationProduct; locale: string; t: TFunction }) {
  const { missing_kg: kg, missing_amount: amount, rate } = product;
  if (kg === null || amount === null) {
    return <TableCell className="text-right font-mono tabular-nums">—</TableCell>;
  }
  if (cmp(kg, ZERO) <= 0) return <TableCell />;
  return (
    <TableCell className="text-right font-mono tabular-nums whitespace-nowrap text-amber">
      {rate === null
        ? formatDecimal(amount, locale)
        : t('reweigh.check.moneyFormula', {
            kg: formatDecimal(kg, locale),
            rate: formatDecimal(rate, locale),
            amount: formatDecimal(amount, locale),
          })}
    </TableCell>
  );
}
