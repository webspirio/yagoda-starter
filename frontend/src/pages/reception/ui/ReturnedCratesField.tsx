import { useEffect, useEffectEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Field } from '@/shared/ui/field';
import { TextInput } from '@/shared/ui/text-input';
import { formatUah, isZero } from '@/shared/lib/money';
import { useDebouncedValue } from '@/shared/lib/useDebouncedValue';
import { useCrateBalanceQuery } from '@/entities/crate';
import { useReturnPreviewQuery } from '@/features/return-crates';
import { parseCount } from '../model/intakeForm';

/** Same window as the receipt's own live preview (`useIntakePreview`). */
const PREVIEW_DEBOUNCE_MS = 250;

/**
 * «З них наших ящиків» (spec §8.4, 2026-09-24) — how many of this receipt's
 * crate-tare units are OUR rented crates coming back full. Sent with the
 * receipt as `returned_crates`; the server writes the crate return in the same
 * transaction and refuses the whole receipt if it cannot.
 *
 * The ceiling is `min(crate tare on the form, crates this person holds)`.
 * Until the operator types here, the value FOLLOWS that ceiling (pre-fill);
 * once they have, it is theirs — only clamped on blur, or when the ceiling
 * drops below it. The page keys this component by supplier, so picking
 * another supplier remounts it and the «edited» flag starts over.
 *
 * The refund beside it is the SERVER's FIFO split (`POST /crate-returns/preview`),
 * never recomputed here — same reasoning as `ReturnCratesDialog`.
 */
export function ReturnedCratesField({
  supplierId,
  pointId,
  crateTareUnits,
  value,
  onChange,
  disabled,
}: {
  supplierId: string | null;
  /** The owner's picked point; omitted for an operator (their token has it). */
  pointId?: string;
  crateTareUnits: number;
  /** RHF's `returned_crates` — the page owns it. */
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? 'uk';
  const balance = useCrateBalanceQuery(supplierId);
  const held = balance.data?.outstanding_units ?? 0;
  const max = Math.min(crateTareUnits, held);
  const [edited, setEdited] = useState(false);

  // Reacts to the CEILING moving, not to keystrokes — a typed 50 stands until
  // blur. `useEffectEvent` reads the latest value/flag without making them
  // triggers.
  const followMax = useEffectEvent((ceiling: number) => {
    if (!edited) {
      if (value !== String(ceiling)) onChange(String(ceiling));
    } else if (parseCount(value) > ceiling) {
      onChange(String(ceiling));
    }
  });
  useEffect(() => {
    followMax(max);
  }, [max]);

  const units = parseCount(value);
  const debouncedUnits = useDebouncedValue(units, PREVIEW_DEBOUNCE_MS);
  const preview = useReturnPreviewQuery({ supplierId, units: debouncedUnits, pointId });
  const refund =
    units > 0 && debouncedUnits === units ? (preview.data?.deposit_refund ?? null) : null;

  if (supplierId === null || held === 0) return null;

  return (
    <div className="border-t border-border p-4">
      <Field
        name="returned_crates"
        label={t('reception.returned.label')}
        hint={t('reception.returned.held', { held })}
      >
        {(a11y) => (
          <div className="flex flex-wrap items-center gap-3">
            <TextInput
              {...a11y}
              inputMode="numeric"
              className="w-28 font-mono"
              value={value}
              disabled={disabled}
              onChange={(e) => {
                setEdited(true);
                onChange(e.target.value.replace(/\D/g, ''));
              }}
              onBlur={() => {
                if (value === '') return; // empty = 0, left as typed
                const canonical = String(Math.min(parseCount(value), max));
                if (canonical !== value) onChange(canonical);
              }}
            />
            {refund !== null ? (
              <span aria-live="polite" className="text-sm text-muted-foreground">
                {isZero(refund)
                  ? t('reception.returned.receipt')
                  : t('reception.returned.deposit', { amount: formatUah(refund, locale) })}
              </span>
            ) : null}
          </div>
        )}
      </Field>
    </div>
  );
}
