import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn, focusRing } from '@/shared/lib/cn';

/**
 * The floor every text control shares, whatever chrome it wears. `text-base`
 * (16px) rather than `text-[15px]` stops iOS Safari/WebView from auto-zooming
 * the viewport on focus — anything below 16px triggers it, so this is a hard
 * minimum and not a style preference. Lives here so a borderless control can
 * inherit the rule without also inheriting a border.
 */
const fieldTextClass = cn('text-base text-foreground', focusRing);

/**
 * Shared control chrome — matches the prototype `.fld` (46px, radius 12, card
 * bg).
 */
export const fieldBaseClass = cn(
  fieldTextClass,
  'w-full rounded-xl bg-card border border-input px-3.5',
  'transition-colors placeholder:text-muted2',
  'focus:border-brand disabled:cursor-not-allowed disabled:opacity-50',
  // The mock's invalid state: a destructive hairline plus a soft destructive
  // ring, driven by the `aria-invalid` that `Field` already hands the control.
  'aria-invalid:border-destructive aria-invalid:ring-[3px] aria-invalid:ring-destructive/20',
);

/**
 * Chrome-less variant for controls that sit *inside* an already-bordered
 * surface — e.g. an inline-rename input in an already-carded list row, where
 * a second box inside the card would read as a nested field. Keeps the 16px
 * floor and the focus ring; drops the border, fill and horizontal padding.
 */
export const fieldGhostClass = cn(
  fieldTextClass,
  'min-w-0 rounded-lg bg-transparent px-2',
  'transition-[color,box-shadow] disabled:cursor-not-allowed disabled:opacity-50',
  'aria-invalid:ring-[3px] aria-invalid:ring-destructive/20',
);

/**
 * a11y attributes `Field` derives from `name` and hands to its control.
 *
 * Every property here is a real DOM attribute, so `{...a11y}` is always safe
 * to spread — that's why the label is passed as `aria-labelledby` rather
 * than a bare id. Native inputs get their name from `<label htmlFor>` and
 * treat `aria-labelledby` as redundant-but-correct; group controls (a chip
 * group has no labelable element) rely on it entirely.
 *
 * `id` must land on a FOCUSABLE element — a form that focuses the first
 * invalid control by `document.getElementById(name)` depends on that.
 */
export interface FieldA11y {
  id: string;
  'aria-labelledby': string | undefined;
  'aria-invalid': true | undefined;
  'aria-describedby': string | undefined;
  'aria-required': true | undefined;
}

interface FieldProps {
  /**
   * The RHF field name. Single source of the control id, label id, hint id and
   * error id — being required is what makes an unlabelled field a *compile*
   * error rather than something a reviewer has to notice.
   */
  name: string;
  label?: string;
  required?: boolean;
  /** Muted helper text shown under the control. */
  hint?: string;
  /** `'warning'` renders the hint amber instead of muted — a note the operator
   *  should actually notice (e.g. a clamp), not routine helper text. */
  hintTone?: 'muted' | 'warning';
  /** i18n key of a validation error (resolved here). Rendered under the hint. */
  error?: string;
  children: (a11y: FieldA11y) => ReactNode;
  className?: string;
}

/**
 * Label + control + hint/error wrapper matching the prototype's `.lbl`/`.hint`.
 * `error` is an i18n key (schema messages are keys) resolved with `t()`.
 *
 * The control is a render prop, not `children: ReactNode`, because the a11y
 * props must reach the *actual* control: for tag/choice fields the direct child
 * is RHF's `<Controller>`, which would swallow anything injected by cloning.
 */
export function Field({
  name,
  label,
  required,
  hint,
  hintTone = 'muted',
  error,
  children,
  className,
}: FieldProps) {
  const { t } = useTranslation();
  const labelId = `${name}-label`;
  const hintId = `${name}-hint`;
  const errorId = `${name}-error`;
  const describedBy =
    [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;

  return (
    <div className={className}>
      {label && (
        // The required marker is a *sibling* of `<label>`, not a child: once a
        // control carries `aria-labelledby` (always, here), Testing Library's
        // getByLabelText resolves the label's accessible text by recursing
        // into every descendant node — it does not consult `aria-hidden` — so
        // a marker nested inside `<label>` would leak its "*" into every
        // exact-text label query. Wrapping div carries the block layout/type
        // styling so both render on one line exactly as before.
        <div className="mb-[7px] text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          <label id={labelId} htmlFor={name}>
            {label}
          </label>
          {/* aria-hidden: `aria-required` carries this to AT without reading "*". */}
          {required && (
            <span aria-hidden="true" className="text-brand">
              {' *'}
            </span>
          )}
        </div>
      )}
      {children({
        id: name,
        'aria-labelledby': label ? labelId : undefined,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': describedBy,
        'aria-required': required ? true : undefined,
      })}
      {hint && (
        <p
          id={hintId}
          className={cn(
            'mt-1.5 text-xs leading-snug',
            hintTone === 'warning' ? 'text-amber' : 'text-muted-foreground',
          )}
        >
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className={cn('mt-1.5 text-xs leading-snug text-destructive')}>
          {t(error)}
        </p>
      )}
    </div>
  );
}
