import { CRATES_INPUT, parseDecimal } from './input';

/**
 * Only `required`/`validate` — not the full react-hook-form `RegisterOptions`
 * shape. `RegisterOptions<TFieldValues, TFieldName>` narrows fields like
 * `deps` to the concrete field-name union of whichever form calls `register`,
 * and that union is a different type at every one of these factories' call
 * sites; a return type that repeated the whole (wider) `RegisterOptions`
 * shape would make TypeScript reject the result at every one of them. This
 * narrower object carries none of those field-name-typed properties, so it
 * satisfies `RegisterOptions<T, N>` — a `Partial<{...}>` — for ANY `T`/`N`.
 */
interface MoneyFieldRules {
  required: string | false;
  validate: (value: string) => boolean | string;
  setValueAs?: (value: string) => string;
}

/**
 * The ONE rule every money or weight `register()` field uses (#72). It takes no
 * message key on purpose: the message is the same on every form, so a form
 * cannot ask for a different one. Semantic checks (> 0, ≤ debt) stay in the
 * form and keep their own keys.
 *
 * `setValueAs` stores `parseDecimal`'s canonical form in the form values, so a
 * submit handler sends `values.amount` as it is — there is no second
 * normalisation to forget. A refused text is stored as typed, so `validate`
 * still sees (and refuses) it. Defaults and `setValue` are not passed through
 * `setValueAs` until edited: a prefill goes in as `toDecimalField` shows it
 * («500,00» in uk), so a form that prefills reads its values back through
 * `parseDecimal` before comparing or sending them.
 */
export function decimalRules({
  required = true,
  allowNegative = false,
}: { required?: boolean; allowNegative?: boolean } = {}): MoneyFieldRules {
  return {
    required: required ? 'errors.decimalFormat' : false,
    validate: (value: string) =>
      (!required && value.trim() === '') ||
      parseDecimal(value, { allowNegative }) !== null ||
      'errors.decimalFormat',
    setValueAs: (value: string) => parseDecimal(value, { allowNegative }) ?? value,
  };
}

/** Same shape as `decimalRules`, for an integer crates field — with its own key. */
export function cratesRules(errorKey: string): MoneyFieldRules {
  return {
    required: errorKey,
    validate: (value: string) => CRATES_INPUT.test(value.trim()) || errorKey,
  };
}
