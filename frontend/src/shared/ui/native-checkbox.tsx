import type { ComponentProps } from 'react';

/** Native checkbox in the brand accent — `Radio`'s counterpart, none of the Radix `Checkbox`'s
 *  bundle weight. Wrap it in a `<label>` with its text. */
export const NativeCheckbox = (props: Omit<ComponentProps<'input'>, 'type' | 'className'>) => (
  <input type="checkbox" className="mt-0.5 size-4 shrink-0 cursor-pointer accent-brand" {...props} />
);
