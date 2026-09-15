import { DECIMAL_INPUT, CRATES_INPUT, normalizeAmount } from './input';

/**
 * Only `required`/`validate` — not the full react-hook-form `RegisterOptions`
 * shape. `RegisterOptions<TFieldValues, TFieldName>` narrows fields like
 * `deps` to the concrete field-name union of whichever form calls `register`,
 * and that union is a different type at every one of this factory's six call
 * sites; a return type that repeated the whole (wider) `RegisterOptions`
 * shape would make TypeScript reject the result at every one of them. This
 * narrower object carries none of those field-name-typed properties, so it
 * satisfies `RegisterOptions<T, N>` — a `Partial<{...}>` — for ANY `T`/`N`.
 */
interface MoneyFieldRules {
  required: string;
  validate: (value: string) => boolean | string;
}

/**
 * The `required` + `validate` pair every money-string field repeats by hand
 * — six dialogs (`SendTransferDialog`, `DisputeTransferDialog`,
 * `ResolveTransferDialog`, `SetTargetCashDialog`, `CountDrawerDialog`,
 * `PayoutDialog`) wrote this out before this factory existed. `errorKey`
 * plays both roles at once: react-hook-form's own convention is that a
 * `validate`/`required` failure returns the i18n KEY itself, resolved later
 * by `shared/ui/field.tsx` (see `frontend/CLAUDE.md`'s i18n note) — so there
 * is exactly one key to name per field, not a `required` key and a separate
 * `validate` key that could drift apart.
 */
export function amountRules(errorKey: string): MoneyFieldRules {
  return {
    required: errorKey,
    validate: (value: string) => DECIMAL_INPUT.test(normalizeAmount(value)) || errorKey,
  };
}

/** Same shape as `amountRules`, for an integer crates field. */
export function cratesRules(errorKey: string): MoneyFieldRules {
  return {
    required: errorKey,
    validate: (value: string) => CRATES_INPUT.test(value.trim()) || errorKey,
  };
}
