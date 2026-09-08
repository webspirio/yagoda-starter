import { useEffect, useRef, useState } from 'react';
import { cmp } from '@/shared/lib/money';
import { useDebouncedValue } from '@/shared/lib/useDebouncedValue';
import { usePreviewIntakeMutation } from '../api/intakes';
import { toPreviewBody, type IntakeFormValues, type IntakePreview } from '../model/intakeForm';
import { apiErrorToFields, type ApiFieldErrors } from './apiErrorToFields';

const PREVIEW_DEBOUNCE_MS = 250;

function normalizeDecimal(value: string): string {
  return value.trim().replace(',', '.');
}

/** `cmp` throws on a malformed decimal string — a half-typed `gross_kg`
 *  ("12.", "-", "") is not previewable, not an error to surface yet. */
function isPositiveDecimal(value: string): boolean {
  try {
    return cmp(normalizeDecimal(value), '0') === 1;
  } catch {
    return false;
  }
}

function hasValidTareRow(line: IntakeFormValues['items'][number]): boolean {
  return line.tare.some((row) => Number.parseInt(row.units, 10) >= 1);
}

function isLineComplete(line: IntakeFormValues['items'][number]): boolean {
  return (
    line.product_grade_id.trim() !== '' && isPositiveDecimal(line.gross_kg) && hasValidTareRow(line)
  );
}

/**
 * Whether the form is worth asking the server about: a chosen supplier AND
 * EVERY line complete (a grade, a positive gross weight, ≥1 tare row with
 * units ≥ 1). `toPreviewBody` always sends every line verbatim, incomplete
 * ones included, so the server's response items stay 1:1 with the form's
 * line indices — `apiErrorToFields` places a line-scoped error by that same
 * index. This gate is about when to bother firing, not what to send: an
 * incomplete line sent alone would just 400 on a rule the operator has not
 * finished typing yet, so the hook waits for every line to clear the bar
 * before it fires at all.
 */
function isPreviewable(values: IntakeFormValues): boolean {
  return (
    values.supplier_id.trim() !== '' &&
    values.items.length > 0 &&
    values.items.every(isLineComplete)
  );
}

/**
 * Live server preview for the reception form. Debounces the SERIALIZED
 * preview body 250ms after the last edit (serializing first, rather than
 * debouncing `values` itself, means an unrelated re-render that leaves the
 * body unchanged never resets the timer), then asks `POST /intakes/preview`
 * for the numbers §2.4/§2.8/§2.9 reserve to the server — net weight, price,
 * bonus, and the line/document amounts.
 *
 * `preview` keeps the LAST SUCCESSFUL response visible while a new request is
 * in flight, so the numbers do not flicker to blank on every keystroke
 * settling; it is cleared to `null` only when the form stops being
 * previewable (or the hook is disabled). `error` is cleared the moment a new
 * request starts, and mapped via `apiErrorToFields` on a failure — the last
 * good `preview` is left in place even then, so a bonus that just drifted out
 * of range does not also blank the numbers the operator was reading.
 *
 * A request superseded by a newer one before it resolves is a STALE response:
 * discarded by comparing a `useRef` counter, bumped once per fired request,
 * against its own snapshot after the `await` — the classic race a debounced
 * network call must guard against regardless of debounce.
 */
export function useIntakePreview(
  values: IntakeFormValues,
  pointId: string | null,
  { enabled }: { enabled: boolean },
): { preview: IntakePreview | null; error: ApiFieldErrors | null; isPending: boolean } {
  const { mutateAsync } = usePreviewIntakeMutation();
  // Captured via a ref, not the effect's dependency array: `mutateAsync`'s
  // identity is not guaranteed stable across renders, and depending on it
  // directly would re-run (and potentially re-fire) the effect on renders
  // that changed nothing the operator typed. Written in its own effect
  // (never during render) so it is always the latest function by the time
  // the fetch effect below reads it.
  const mutateRef = useRef(mutateAsync);
  useEffect(() => {
    mutateRef.current = mutateAsync;
  });

  const previewable = isPreviewable(values);
  const serializedBody = previewable ? JSON.stringify(toPreviewBody(values, pointId)) : null;
  const debounced = useDebouncedValue(serializedBody, PREVIEW_DEBOUNCE_MS);
  // Whether the debounced body is one worth showing/fetching for. Gating the
  // RETURNED preview/error/isPending on this (rather than resetting them with
  // a synchronous `setState` inside the effect below) keeps that effect doing
  // only the one thing an effect should: talking to an external system.
  const active = enabled && debounced !== null;

  const [preview, setPreview] = useState<IntakePreview | null>(null);
  const [error, setError] = useState<ApiFieldErrors | null>(null);
  const [isPending, setIsPending] = useState(false);
  const requestRef = useRef(0);

  useEffect(() => {
    if (!active || debounced === null) return;

    // The state updates below all happen inside this inner async function,
    // never directly in the effect body — an effect synchronously calling
    // `setState` on every run is exactly the "derive it during render
    // instead" smell `react-hooks/set-state-in-effect` flags. Here the
    // effect's only job is talking to the server; every update it makes is a
    // reaction to that call starting or settling, same as any other
    // subscription-style effect.
    const requestId = ++requestRef.current;
    const body = JSON.parse(debounced) as ReturnType<typeof toPreviewBody>;

    async function run() {
      setError(null);
      setIsPending(true);
      try {
        const result = await mutateRef.current(body);
        if (requestRef.current !== requestId) return; // superseded — discard
        setPreview(result);
        setIsPending(false);
      } catch (err) {
        if (requestRef.current !== requestId) return; // superseded — discard
        setError(apiErrorToFields(err, body.items.length));
        setIsPending(false);
      }
    }
    void run();
  }, [active, debounced]);

  return {
    preview: active ? preview : null,
    error: active ? error : null,
    isPending: active && isPending,
  };
}
