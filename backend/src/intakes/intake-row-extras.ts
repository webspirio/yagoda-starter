/**
 * The four columns a list row carries beyond the `intakes` table itself
 * (spec 2026-09-21 §2.4 — the programme's first shared read). Computed IN
 * POSTGRES so no kilogram or kopiyka passes through JavaScript on its way to
 * the page, and defined ONCE: `list` adds them as selects on its query
 * builder, every single-document path (`findOne`, `create`, `void`) reads
 * them through `ROW_EXTRAS_SQL`. Two definitions of «paid_amount» would drift
 * on the first `voided_at` filter somebody forgot.
 */
export interface IntakeRowExtras {
  net_kg: string;
  lines_count: number;
  supplier_name: string;
  paid_amount: string;
}

/** `alias` is the intakes alias, `supplierAlias` the joined suppliers row.
 *  `alias`/`supplierAlias` are code literals at both call sites — never
 *  request input — so interpolating them straight into the SQL text is
 *  safe. */
export function rowExtrasSelects(
  alias: string,
  supplierAlias: string,
): ReadonlyArray<{ sql: string; alias: keyof IntakeRowExtras }> {
  return [
    {
      // COALESCE must wrap the ::text cast, not the number — COALESCE(SUM(x),
      // 0) makes an integer zero, which Postgres renders '0', not '0.00'
      // (the trap `supplier-balance.service.ts` already documents).
      sql: `(SELECT COALESCE(SUM(ii.net_kg)::text, '0.00') FROM intake_items ii WHERE ii.intake_id = ${alias}.id)`,
      alias: 'net_kg',
    },
    {
      sql: `(SELECT COUNT(ii.id)::int FROM intake_items ii WHERE ii.intake_id = ${alias}.id)`,
      alias: 'lines_count',
    },
    {
      // Live payouts only: a voided payout was never really paid (the DEBT
      // reading of `voided_at`, same as `supplier-balance`). COALESCE wraps
      // the ::text cast — see the `net_kg` comment above.
      sql: `(SELECT COALESCE(SUM(p.amount)::text, '0.00') FROM payouts p WHERE p.intake_id = ${alias}.id AND p.voided_at IS NULL)`,
      alias: 'paid_amount',
    },
    {
      sql: `btrim(${supplierAlias}.first_name || ' ' || ${supplierAlias}.last_name)`,
      alias: 'supplier_name',
    },
  ];
}

/** One document's extras, by id — `$1` is the intake id. */
export const ROW_EXTRAS_SQL = `
  SELECT
    ${rowExtrasSelects('i', 'sup')
      .map((s) => `${s.sql} AS ${s.alias}`)
      .join(',\n    ')}
  FROM intakes i
  JOIN suppliers sup ON sup.id = i.supplier_id
  WHERE i.id = $1`;
