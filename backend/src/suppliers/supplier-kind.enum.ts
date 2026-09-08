/**
 * §2.11 — a REPORTING marker on the person, nothing more. «Базова ціна від
 * маркера не залежить ніколи»: `wholesale` does not change any price, which is
 * also why there is no «ОПТ» product grade (see `ProductGrade`'s doc comment —
 * a grade with its own daily price would apply the same premium twice).
 *
 * String values match the `supplier_kind` Postgres enum exactly.
 */
export enum SupplierKind {
  None = 'none',
  Wholesale = 'wholesale',
  Farmer = 'farmer',
}
