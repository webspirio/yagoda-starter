import * as React from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn, focusRing } from '@/shared/lib/cn';
import { TextInput, type TextInputProps } from './text-input';

/**
 * A password field with the eye: the same `TextInput` everything else uses,
 * plus a toggle that flips `type` between `password` and `text`.
 *
 * It reveals ONLY what is being typed in this field right now — a person
 * checking their own entry before submitting. Reading someone ELSE's stored
 * password is a different thing entirely and lives on the owner's registry
 * screen behind `GET /users/:id/password`.
 *
 * THREE DETAILS THAT LOOK COSMETIC AND ARE NOT:
 *   - `type="button"`, because the default inside a form is `submit` and the
 *     eye would post a half-typed password.
 *   - `aria-pressed` rather than two unrelated buttons, so a screen reader
 *     announces the state rather than a label that changed underneath it.
 *   - The input keeps its own state across the flip (nothing remounts), so the
 *     value survives — this control is reached for MID-ENTRY.
 *
 * `...props` reaches the input, never the wrapper: `Field` hands its a11y
 * props to its render-prop child, and `id` in particular must land on the
 * focusable element.
 */
export const PasswordInput = React.forwardRef<HTMLInputElement, Omit<TextInputProps, 'type'>>(
  function PasswordInput({ className, ...props }, ref) {
    const { t } = useTranslation();
    const [revealed, setRevealed] = React.useState(false);

    return (
      <div className="relative">
        <TextInput
          ref={ref}
          // A revealed password is a plain text field, which is what stops the
          // browser from re-masking it; `autoComplete` still comes from the
          // caller, since only it knows whether this is a new password.
          type={revealed ? 'text' : 'password'}
          // Room for the button, so a long password does not run under it.
          className={cn('pr-11', className)}
          {...props}
        />
        <button
          type="button"
          onClick={() => setRevealed((shown) => !shown)}
          aria-pressed={revealed}
          aria-label={t(revealed ? 'common.hidePassword' : 'common.showPassword')}
          title={t(revealed ? 'common.hidePassword' : 'common.showPassword')}
          className={cn(
            'absolute inset-y-0 right-0 flex w-11 items-center justify-center',
            'rounded-r-xl text-muted-foreground transition-colors hover:text-foreground',
            focusRing,
          )}
        >
          {revealed ? <EyeOff className="size-4.5" /> : <Eye className="size-4.5" />}
        </button>
      </div>
    );
  },
);
