import { cmp, parseCrateCount, parseDecimal } from '@/shared/lib/money';

/** One tare row on the draft line, while the operator is still typing.
 *  `units` is a STRING here (an editable input value), read only through
 *  `parseCrateCount` — a count that is not whole is refused, never rounded. */
export interface IntakeLineValues {
  product_grade_id: string;
  gross_kg: string;
  pallet_kg: string;
  bonus: string;
  tare: { tare_type_id: string; units: string }[];
}

/** RHF values for the reception form. Every money/weight field is a STRING
 *  the operator typed — nothing here is ever computed client-side (§2.4,
 *  §2.8, §2.9 reserve net weight, price and amount to the server).
 *
 *  `paid_amount` is the payout half of the SAME action (§2.1 ⑥, §3.1, §3.6) —
 *  `''` means "type nothing, pay out nothing" and is a legal value, not a
 *  half-filled field. */
export interface IntakeFormValues {
  supplier_id: string;
  items: IntakeLineValues[];
  paid_amount: string;
  /** «З них наших ящиків» — how many of the receipt's crate-tare units are
   *  our rented crates coming back full (2026-09-24). A digits-only STRING
   *  while typed; `''` means 0. */
  returned_crates: string;
}

/** A fresh draft line — pallet and bonus default to `'0.00'` (the same
 *  default the server applies when they are omitted from the wire body), and
 *  the one tare row starts at the caller's default tare type with a count of
 *  1, so a brand-new line already satisfies "at least one tare row with
 *  units ≥ 1" the moment a grade and a gross weight are typed. */
export function emptyLine(defaultTareTypeId: string): IntakeLineValues {
  return {
    product_grade_id: '',
    gross_kg: '',
    pallet_kg: '0.00',
    bonus: '0.00',
    tare: [{ tare_type_id: defaultTareTypeId, units: '1' }],
  };
}

/** A line nobody has started: no grade, no gross weight, no pallet. The
 *  default tare row does not count — `emptyLine` puts it there, not the
 *  operator, and without a weight it weighs nothing. */
export function isBlankLine(line: IntakeLineValues): boolean {
  const pallet = parseDecimal(line.pallet_kg);
  return (
    line.product_grade_id === '' &&
    line.gross_kg.trim() === '' &&
    (line.pallet_kg.trim() === '' || (pallet !== null && cmp(pallet, '0') === 0))
  );
}

/**
 * The receipt as it is meant: «Ще позиція» always leaves a fresh draft behind,
 * and an untouched one is not a line — it is dropped here before the preview
 * is asked or the receipt is sent, so the committed lines above it stay
 * priced and «Прийняти» works (client, 24.10). Only a TRAILING draft, and only
 * when a committed line remains, so every earlier index — the one server
 * errors are placed by — is unchanged. A half-filled draft still blocks, with
 * its hint and «Прибрати позицію».
 */
export function withoutBlankDraft(values: IntakeFormValues): IntakeFormValues {
  const last = values.items[values.items.length - 1];
  return values.items.length > 1 && last !== undefined && isBlankLine(last)
    ? { ...values, items: values.items.slice(0, -1) }
    : values;
}

/** One line as it crosses the wire — `units` is a whole count ≥ 1, not money. */
export interface PreviewIntakeItemBody {
  product_grade_id: string;
  gross_kg: string;
  pallet_kg: string;
  bonus: string;
  tare: { tare_type_id: string; units: number }[];
}

/** `POST /intakes/preview` body. */
export interface PreviewIntakeBody {
  /** Owner only — an operator's point is resolved server-side from their
   *  token, so this is omitted (not sent as `undefined`) for an operator. */
  collection_point_id?: string;
  supplier_id: string;
  items: PreviewIntakeItemBody[];
}

/** `POST /intakes` body — the same lines as the preview body (identical since
 *  2026-09-18, when the receipt number stopped being typed: the server
 *  numbers each shift itself), plus an OPTIONAL `paid_amount` for the payout
 *  half of the same action (§2.1 ⑥, §3.1, §3.6). Present only when it is a
 *  genuine positive figure — absent, `null`, `''` and `'0.00'` all mean "no
 *  payout" server-side, so `toCreateBody` sends the key at all only then. */
export interface CreateIntakeBody extends PreviewIntakeBody {
  paid_amount?: string;
  /** Our rented crates handed back with this receipt — sent only when > 0. */
  returned_crates?: number;
}

/** One line of `POST /intakes/preview`'s answer — mirrors the backend's
 *  `PreviewIntakeItemResponse`. Every money/weight field is a STRING; `tare`
 *  carries the resolved units the server actually counted (rows with
 *  `units < 1` dropped before the request went out). */
export interface IntakePreviewItem {
  item_order: number;
  product_grade_id: string;
  gross_kg: string;
  pallet_kg: string;
  tare_weight_kg: string;
  net_kg: string;
  price: string;
  bonus: string;
  amount: string;
  /** `net_kg × (price + bonus)` at 2 decimals, half-up — the calculator's
   *  figure before §2.12's whole-hryvnia rounding (`amount`). The server's,
   *  never multiplied here (spec 2026-10-23 R4). */
  amount_exact: string;
  tare: { tare_type_id: string; units: number }[];
}

/** `POST /intakes/preview`'s answer — mirrors the backend's
 *  `PreviewIntakeResponse`. Nothing here is persisted: no `id`, no `code`,
 *  no `shift_id` — a preview is not a document. */
export interface IntakePreview {
  collection_point_id: string;
  supplier_id: string;
  business_date: string;
  amount: string;
  items: IntakePreviewItem[];
}

/** A line's typed decimal as it crosses the wire: `parseDecimal`'s canonical
 *  form when it parses, otherwise VERBATIM — the preview must still see an
 *  unfinished line so its errors keep their indices, and the server is the
 *  sole authority on format (`@Matches`). The minus is allowed here because
 *  `bonus` carries one; a negative weight is refused by the server. */
function normalizeDecimal(value: string): string {
  return parseDecimal(value, { allowNegative: true }) ?? value;
}

/**
 * The preview/create body's shared line-and-supplier shape. `collection_point_id`
 * is omitted (not sent as `null`/`undefined`) when `pointId` is null — an
 * operator's point comes from their token, and the backend's `@IsOptional()`
 * only skips validation for an ABSENT key, not an explicit `null`.
 *
 * Every line is sent VERBATIM, including one the operator has not finished
 * typing — dropping incomplete lines would break the 1:1 correspondence
 * between the form's `items` array and the server's response/error indices
 * that `apiErrorToFields` and `useIntakePreview` both rely on. Only a tare
 * row counting 0 (empty or `0`) is ever dropped — one not touched at all.
 *
 * A count that is not whole («0,5», «1.2.3») never gets here: the form names
 * it under the tare and `useIntakePreview` asks nothing while it stands (#233
 * review), so the `null` filtered out below is unreachable, not a silent drop.
 */
export function toPreviewBody(values: IntakeFormValues, pointId: string | null): PreviewIntakeBody {
  return {
    ...(pointId ? { collection_point_id: pointId } : {}),
    supplier_id: values.supplier_id,
    items: values.items.map((line) => ({
      product_grade_id: line.product_grade_id,
      gross_kg: normalizeDecimal(line.gross_kg),
      pallet_kg: normalizeDecimal(line.pallet_kg),
      bonus: normalizeDecimal(line.bonus),
      tare: line.tare.flatMap((row) => {
        const units = parseCrateCount(row.units);
        return units ? [{ tare_type_id: row.tare_type_id, units }] : [];
      }),
    })),
  };
}

/**
 * What `POST /intakes` sends — the same body a preview asks about, plus
 * `paid_amount` when the operator's typed figure is a genuine positive
 * amount. `parseDecimal` is the same shape the server's own `@Matches`
 * enforces; a malformed or non-positive value is simply never sent — the
 * server's own reading of "absent" already means "no payout" (§2.1 ⑥, §3.1).
 */
export function toCreateBody(values: IntakeFormValues, pointId: string | null): CreateIntakeBody {
  const body: CreateIntakeBody = toPreviewBody(values, pointId);
  const paid = parseDecimal(values.paid_amount);
  if (paid !== null && cmp(paid, '0') === 1) body.paid_amount = paid;
  // A crate COUNT, not money. Empty or 0 is "nothing came back", which the
  // server reads the same as an absent key — so the key rides only when > 0.
  const returned = parseCount(values.returned_crates);
  if (returned > 0) body.returned_crates = returned;
  return body;
}

/** A digits-only count typed into the form — `''` (or anything unparsable)
 *  is 0. Integer counts, never money. */
export function parseCount(value: string): number {
  const n = Number.parseInt(value, 10);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

/**
 * Σ units of every tare row, on every line (committed and draft alike — the
 * whole form is the receipt), whose tare type is a crate. The server checks
 * `returned_crates` against exactly this (`RETURNED_EXCEEDS_TARE`); the form
 * uses it as the field's ceiling. Rows the body would drop (0, or a count the
 * form refuses) count for nothing here either.
 */
export function crateTareUnits(
  items: IntakeLineValues[],
  tareTypes: ReadonlyArray<{ id: string; is_crate: boolean }>,
): number {
  const crateIds = new Set(tareTypes.filter((type) => type.is_crate).map((type) => type.id));
  let total = 0;
  for (const line of items) {
    for (const row of line.tare) {
      if (crateIds.has(row.tare_type_id)) total += parseCrateCount(row.units) ?? 0;
    }
  }
  return total;
}
