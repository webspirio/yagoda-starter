import { AlertTriangle } from 'lucide-react';

/**
 * A field-level warning — amber text, never a block. `grossHint`/`tareHint`
 * (Task 6) resolve to copy the caller passes here; this component just
 * renders it. Mirrors the mock's `:871-878` verbatim.
 */
export function FieldWarning({ text }: { text: string }) {
  return (
    <div className="mt-2 flex items-start gap-2 text-xs text-[var(--amber)]">
      <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden="true" />
      <span>{text}</span>
    </div>
  );
}
