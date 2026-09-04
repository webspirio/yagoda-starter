import { useEffect, useRef, useState } from 'react';
import { Camera } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/cn';

interface ImagePickerProps {
  value: File | null;
  onChange: (file: File | null) => void;
  title: string;
  hint?: string;
  required?: boolean;
  /** i18n key of a validation error. */
  error?: string;
  /** Lands on the *button* — the file input is display:none and can't take focus. */
  id?: string;
}

/** Centered circular image upload with live preview (e.g. a profile avatar). */
export function ImagePicker({
  value,
  onChange,
  title,
  hint,
  required,
  error,
  id = 'photo',
}: ImagePickerProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  // Create the preview URL in an effect, not during render. Render-phase
  // createObjectURL is not guaranteed to run once — under StrictMode it leaks
  // one URL and revokes the one the committed <img> is actually using. The
  // cleanup is keyed to the File, so each URL is revoked exactly once.
  //
  // The "no file" case is *not* handled here with a matching setState call:
  // with nothing to hand to an external system, that setState would be
  // flagged by react-hooks/set-state-in-effect (a synchronous setState with
  // no external-system work is just derived state — see `preview` below).
  //
  // The setObjectUrl below *is* a legitimate synchronous setState-in-effect:
  // URL.createObjectURL is an impure, one-shot browser API call (allocates a
  // handle in the Blob URL registry) that cannot run during render — that's
  // the bug this component had. Deferring the setState via a microtask
  // dodges the lint rule but is actively wrong here: it decouples the state
  // update from React's commit, so image-picker.test.tsx (and any real
  // caller that reads the DOM synchronously after mount) observes a
  // stale/missing preview, and RTL flags the update as happening outside
  // `act()`. This is the one place in this file the rule's heuristic (any
  // sync setState-in-effect is "derivable state") doesn't fit: the value
  // isn't derivable without the side effect.
  useEffect(() => {
    if (!value) return;
    const url = URL.createObjectURL(value);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- see comment above the effect; verified safe under StrictMode by the tests in image-picker.test.tsx.
    setObjectUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [value]);

  // objectUrl can lag one render behind value (e.g. it still holds the prior
  // file's URL for the instant after value flips to null, until the effect
  // above revokes it) — gating on value keeps that stale URL out of the DOM.
  const preview = value ? objectUrl : null;

  const inputId = `${id}-input`;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy =
    [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;

  return (
    <div className="text-center">
      <button
        type="button"
        id={id}
        onClick={() => inputRef.current?.click()}
        aria-label={title}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cn(
          'mx-auto flex size-24 items-center justify-center overflow-hidden rounded-full border-2 bg-card text-muted-foreground transition-colors',
          preview ? 'border-solid border-brand' : 'border-dashed border-line2',
        )}
      >
        {preview ? (
          // Decorative: the button already carries the name via aria-label.
          <img src={preview} alt="" className="size-full object-cover" />
        ) : (
          <Camera className="size-7" aria-hidden="true" />
        )}
      </button>
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept="image/*"
        tabIndex={-1}
        className="hidden"
        onChange={(e) => onChange(e.target.files?.[0] ?? null)}
      />
      {/* A real <label> for the hidden input: gives it a name and makes the
          caption open the picker too. */}
      <label htmlFor={inputId} className="mt-2.5 block cursor-pointer text-[13px] font-bold">
        {title}
        {required && <span className="text-brand"> *</span>}
      </label>
      {hint && (
        <p id={hintId} className="mt-0.5 text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="mt-1 text-xs text-destructive">
          {t(error)}
        </p>
      )}
    </div>
  );
}
