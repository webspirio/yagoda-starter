/** One tare row on the draft line, while the operator is still typing.
 *  `units` is a STRING here (an editable input value) — parsed to an integer
 *  count only when the line crosses the wire; see `toPreviewBody`. */
export interface IntakeLineValues {
  product_grade_id: string;
  gross_kg: string;
  pallet_kg: string;
  bonus: string;
  tare: { tare_type_id: string; units: string }[];
}

/** RHF values for the reception form. Every money/weight field is a STRING
 *  the operator typed — nothing here is ever computed client-side (§2.4,
 *  §2.8, §2.9 reserve net weight, price and amount to the server). */
export interface IntakeFormValues {
  supplier_id: string;
  items: IntakeLineValues[];
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

/** One line as it crosses the wire — `units` is an integer count, not money;
 *  `Number.parseInt(…, 10)`, never float arithmetic. */
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

/** `POST /intakes` body. IDENTICAL to the preview body since 2026-09-18, when
 *  the receipt number stopped being typed: the server numbers each shift
 *  itself, so recording a document now asks for nothing that computing one
 *  did not already need. Kept as a named alias because the two requests still
 *  mean different things at the call site. */
export type CreateIntakeBody = PreviewIntakeBody;

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

/** Trims and swaps a comma for a dot — the only coercion applied to a typed
 *  decimal before it crosses the wire. The server is the sole authority on
 *  format (`@Matches`), so this never re-validates the result. */
function normalizeDecimal(value: string): string {
  return value.trim().replace(',', '.');
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
 * row's `units < 1` (or unparsable) is ever dropped — that is never a line
 * the operator is mid-typing, it is one they have not touched at all.
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
      tare: line.tare
        .map((row) => ({ tare_type_id: row.tare_type_id, units: Number.parseInt(row.units, 10) }))
        .filter((row) => Number.isInteger(row.units) && row.units >= 1),
    })),
  };
}

/** What `POST /intakes` sends — the same body a preview asks about. */
export function toCreateBody(values: IntakeFormValues, pointId: string | null): CreateIntakeBody {
  return toPreviewBody(values, pointId);
}
