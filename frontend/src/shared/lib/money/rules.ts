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
}

/**
 * The ONE rule every money or weight `register()` field uses (#72). It takes no
 * message key on purpose: the message is the same on every form, so a form
 * cannot ask for a different one. Semantic checks (> 0, ≤ debt) stay in the
 * form and keep their own keys.
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
  };
}

/** Same shape as `decimalRules`, for an integer crates field — with its own key. */
export function cratesRules(errorKey: string): MoneyFieldRules {
  return {
    required: errorKey,
    validate: (value: string) => CRATES_INPUT.test(value.trim()) || errorKey,
  };
}
