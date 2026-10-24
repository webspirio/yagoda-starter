/**
 * A tare type as the reception form and receipt need it — id, name, and the
 * two fields §2.5's automatic tare-weight subtraction actually reads:
 * `weight_kg` (per-unit weight to subtract) and `is_crate` (crates carry a
 * deposit the intake screen tracks separately from weight). `deposit_price`
 * rides along for «Видати ящики», which shows the deposit it is about to take
 * (audit 2026-10-24, F5); no `is_active` or `created_at` — this is a picker option, not
 * the admin registry row (`pages/catalog/model/tareType.ts`'s `TareType`
 * carries the full wire shape for that screen).
 *
 * `weight_kg` IS A STRING, same discipline as `TareType.weight_kg` and every
 * other money/weight `numeric` column in this codebase: carried end to end as
 * a string so no value passes through a binary float.
 */
export interface TareTypeOption {
  id: string;
  name: string;
  weight_kg: string;
  is_crate: boolean;
  /** The crate deposit per unit, a decimal STRING like `weight_kg`. Optional only so
   *  hand-built options in tests stay valid; the read always fills it. */
  deposit_price?: string;
}
