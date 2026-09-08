import { useState } from 'react';
import { AlertTriangle, Minus, Package, Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  useFieldArray,
  useWatch,
  type Control,
  type UseFormRegister,
  type UseFormSetValue,
} from 'react-hook-form';
import { Button } from '@/shared/ui/button';
import { Eyebrow } from '@/shared/ui/eyebrow';
import { Field } from '@/shared/ui/field';
import { SelectField } from '@/shared/ui/select-field';
import { TextInput } from '@/shared/ui/text-input';
import { cn } from '@/shared/lib/cn';
import { add, cmp, div, formatDecimal, formatKg, formatUah, sub } from '@/shared/lib/money';
import type { PricedGrade } from '@/entities/product-grade';
import type { TareTypeOption } from '@/entities/tare-type';
import type { IntakeFormValues, IntakePreviewItem } from '../model/intakeForm';

/** §5.2 — the largest line of the season was 701,5 kg; above this we ask. */
const IMPLAUSIBLE_GROSS = '750';
/** A Czech crate really carries 3…12 kg; outside 2…14 it is almost always a typo. */
const PER_CRATE_MIN = '2';
const PER_CRATE_MAX = '14';
/** One step of the «Дод. ціна» stepper, in ₴/kg. */
const BONUS_STEP = '1';

/** `cmp` throws on a half-typed decimal ("12.", "-", ""), which is not an error
 *  to shout about — it is a value the operator has not finished. */
function compare(a: string, b: string): -1 | 0 | 1 | null {
  try {
    return cmp(a.trim().replace(',', '.'), b);
  } catch {
    return null;
  }
}

/**
 * The draft line: the receipt number, the weights and tare (§2.5), the priced
 * grade and its per-line extra price (§2.8). NOTHING here computes money — the
 * numbers under the line are `previewItem`, straight off `POST /intakes/preview`.
 *
 * The two hints are the mock's, and they are HINTS: an implausible gross weight
 * and an implausible per-crate load are the two most error-prone fields in the
 * business, and neither is a rule the server enforces — so they are amber text
 * that never disables anything.
 */
export function LineEditor({
  index,
  control,
  register,
  setValue,
  grades,
  tareTypes,
  previewItem,
  isPreviewPending,
  codeError,
  errorAt,
  disabled,
}: {
  index: number;
  control: Control<IntakeFormValues>;
  register: UseFormRegister<IntakeFormValues>;
  setValue: UseFormSetValue<IntakeFormValues>;
  grades: PricedGrade[];
  tareTypes: TareTypeOption[];
  /** This line's row of the server preview, or null while there is none yet. */
  previewItem: IntakePreviewItem | null;
  isPreviewPending: boolean;
  codeError: string | null;
  errorAt: (field: string) => string | null;
  disabled: boolean;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? 'uk';

  const tare = useFieldArray({ control, name: `items.${index}.tare` });
  const gross = useWatch({ control, name: `items.${index}.gross_kg` }) ?? '';
  const bonus = useWatch({ control, name: `items.${index}.bonus` }) ?? '';
  const gradeId = useWatch({ control, name: `items.${index}.product_grade_id` }) ?? '';
  const tareRows = useWatch({ control, name: `items.${index}.tare` }) ?? [];

  const [showPallet, setShowPallet] = useState(false);
  // A product with no grade chosen yet has nowhere to live in the form — the
  // document carries a grade, not a product. Once a grade IS chosen the product
  // is derived from it, so this only ever holds the in-between state.
  const [pickedProduct, setPickedProduct] = useState('');

  const grade = grades.find((g) => g.id === gradeId) ?? null;
  const product = grade?.productName ?? pickedProduct;
  const products = [...new Set(grades.map((g) => g.productName))];
  const productGrades = grades.filter((g) => g.productName === product);

  const usedTareTypeIds = new Set(tareRows.map((row) => row.tare_type_id));
  const freeTareType = tareTypes.find((type) => !usedTareTypeIds.has(type.id));

  // The tare block has no `Field` of its own (a type select plus a stepper is
  // not one control), so it carries both of the tare errors the mapper can
  // produce: the business-rule one it pins to row 0, and a class-validator
  // complaint about any row's `units`.
  const tareError =
    errorAt(`items.${index}.tare.0.tare_type_id`) ??
    tareRows.reduce<string | null>(
      (found, _row, rowIndex) => found ?? errorAt(`items.${index}.tare.${rowIndex}.units`),
      null,
    );
  const grossError = errorAt(`items.${index}.gross_kg`);
  const palletError = errorAt(`items.${index}.pallet_kg`);
  const bonusError = errorAt(`items.${index}.bonus`);
  const gradeError = errorAt(`items.${index}.product_grade_id`);
  const hasLineError = Boolean(grossError || palletError || bonusError || gradeError || tareError);

  // Bounds are the GRADE's, not a global setting (§3): `max_discount` is a
  // magnitude, so the floor is its negation.
  const bonusFloor = grade ? sub('0', grade.max_discount) : null;
  const bonusOutOfRange =
    grade !== null &&
    bonusFloor !== null &&
    (compare(bonus, grade.max_markup) === 1 || compare(bonus, bonusFloor) === -1);

  const stepBonus = (direction: 1 | -1) => {
    const current = compare(bonus, '0') === null ? '0.00' : bonus.trim().replace(',', '.');
    setValue(
      `items.${index}.bonus`,
      direction === 1 ? add(current, BONUS_STEP) : sub(current, BONUS_STEP),
      { shouldDirty: true },
    );
  };

  // A tare row that counts nothing is not a row — the stepper floors at 1 and
  // «remove» is how a row goes away. (A typed 0 is still possible, and
  // `toPreviewBody` drops it before the request.)
  const stepUnits = (row: number, direction: 1 | -1) => {
    const parsed = Number.parseInt(tareRows[row]?.units ?? '', 10);
    const current = Number.isInteger(parsed) ? parsed : 0;
    setValue(`items.${index}.tare.${row}.units`, String(Math.max(1, current + direction)), {
      shouldDirty: true,
    });
  };

  // ONE normalization, fed to both the comparison and the formatter: they use
  // different regexes, and `formatDecimal`'s admits no surrounding whitespace —
  // so a pasted " 800" used to pass the comparison and then throw mid-render.
  const normalizedGross = gross.trim().replace(',', '.');
  const grossWarning = compare(normalizedGross, IMPLAUSIBLE_GROSS) === 1;
  // Per crate is read off the SERVER's net weight and the integer unit counts it
  // resolved — never off a typed weight, and never through a float (`div` is
  // BigInt kopiykas).
  const previewUnits = (previewItem?.tare ?? []).reduce((total, row) => total + row.units, 0);
  const perCrate = previewItem && previewUnits > 0 ? div(previewItem.net_kg, previewUnits) : null;
  const perCrateWarning =
    perCrate !== null && (cmp(perCrate, PER_CRATE_MIN) === -1 || cmp(perCrate, PER_CRATE_MAX) === 1);

  return (
    <>
      <div className="border-t border-border p-4">
        <Field
          name="code"
          label={t('reception.code.label')}
          required
          hint={t('reception.code.hint')}
          error={codeError ?? undefined}
          className="max-w-xs"
        >
          {(a11y) => (
            <TextInput
              {...a11y}
              {...register('code')}
              disabled={disabled}
              autoComplete="off"
              className="font-mono uppercase"
            />
          )}
        </Field>
      </div>

      <div className="border-t border-border p-4">
        <Eyebrow className="mb-2">{t('reception.weight.eyebrow')}</Eyebrow>

        <div className="flex flex-wrap items-start gap-3">
          <Field
            name={`items.${index}.gross_kg`}
            label={t('reception.weight.gross')}
            required
            error={grossError ?? undefined}
            className="min-w-[180px] flex-1"
          >
            {(a11y) => (
              <div className="relative">
                <TextInput
                  {...a11y}
                  {...register(`items.${index}.gross_kg`)}
                  disabled={disabled}
                  inputMode="decimal"
                  placeholder="0,00"
                  autoComplete="off"
                  className="h-14 pr-12 font-mono text-2xl font-semibold"
                />
                <span className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 font-mono text-sm text-muted-foreground">
                  {t('reception.weight.unit')}
                </span>
              </div>
            )}
          </Field>

          {showPallet || palletError !== null ? (
            <Field
              name={`items.${index}.pallet_kg`}
              label={t('reception.weight.pallet')}
              error={palletError ?? undefined}
              className="w-[124px]"
            >
              {(a11y) => (
                <TextInput
                  {...a11y}
                  {...register(`items.${index}.pallet_kg`)}
                  disabled={disabled}
                  inputMode="decimal"
                  autoComplete="off"
                  className="h-14 font-mono"
                />
              )}
            </Field>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-6 text-muted-foreground"
              disabled={disabled}
              onClick={() => setShowPallet(true)}
            >
              <Plus className="size-3.5" />
              {t('reception.weight.pallet')}
            </Button>
          )}
        </div>

        {grossWarning ? (
          <p className="mt-1.5 flex items-start gap-2 text-xs text-amber">
            <AlertTriangle className="mt-px size-3.5 shrink-0" />
            {t('reception.line.grossWarning', { gross: formatDecimal(normalizedGross, locale) })}
          </p>
        ) : null}

        <p className="mt-3 mb-1.5 text-xs text-muted-foreground">{t('reception.weight.tare')}</p>
        <div className="flex flex-col gap-2">
          {tare.fields.map((row, rowIndex) => (
            <div key={row.id} className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <SelectField
                  aria-label={t('reception.weight.tareType')}
                  disabled={disabled}
                  className="h-10"
                  {...register(`items.${index}.tare.${rowIndex}.tare_type_id`)}
                >
                  {tareTypes.map((type) => (
                    <option key={type.id} value={type.id}>
                      {t('reception.weight.tareOption', {
                        name: type.name,
                        weight: type.weight_kg,
                      })}
                    </option>
                  ))}
                </SelectField>
              </div>
              <div className="flex items-center gap-1 rounded-lg border border-border bg-background p-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('reception.weight.fewer')}
                  disabled={disabled}
                  onClick={() => stepUnits(rowIndex, -1)}
                >
                  <Minus className="size-3.5" />
                </Button>
                <TextInput
                  variant="ghost"
                  aria-label={t('reception.weight.units')}
                  inputMode="numeric"
                  autoComplete="off"
                  disabled={disabled}
                  className="w-12 text-center font-mono font-semibold"
                  {...register(`items.${index}.tare.${rowIndex}.units`)}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('reception.weight.more')}
                  disabled={disabled}
                  onClick={() => stepUnits(rowIndex, 1)}
                >
                  <Plus className="size-3.5" />
                </Button>
              </div>
              {tare.fields.length > 1 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('reception.weight.removeTare')}
                  disabled={disabled}
                  onClick={() => tare.remove(rowIndex)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              ) : null}
            </div>
          ))}
          <div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled || !freeTareType}
              onClick={() => freeTareType && tare.append({ tare_type_id: freeTareType.id, units: '1' })}
            >
              <Package className="size-3.5" />
              {t('reception.weight.otherTare')}
            </Button>
          </div>
          {tareError ? (
            <p role="alert" className="text-xs text-destructive">
              {t(tareError)}
            </p>
          ) : null}
        </div>
      </div>

      <div className="border-t border-border p-4">
        <Eyebrow className="mb-2">{t('reception.grade.eyebrow')}</Eyebrow>

        <div className="flex flex-wrap items-start gap-3">
          <Field
            name={`product-line-${index}`}
            label={t('reception.grade.product')}
            className="min-w-[150px] flex-1"
          >
            {(a11y) => (
              <SelectField
                {...a11y}
                value={product}
                disabled={disabled}
                onChange={(e) => {
                  setPickedProduct(e.target.value);
                  // Changing the product must never leave a grade of the OTHER
                  // product selected — the first grade of the new one, or none.
                  const first = grades.find((g) => g.productName === e.target.value);
                  setValue(`items.${index}.product_grade_id`, first?.id ?? '', {
                    shouldDirty: true,
                  });
                }}
              >
                <option value="">{t('reception.grade.productPlaceholder')}</option>
                {products.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </SelectField>
            )}
          </Field>

          <Field
            name={`items.${index}.product_grade_id`}
            label={t('reception.grade.grade')}
            required
            error={gradeError ?? undefined}
            className="min-w-[180px] flex-1"
          >
            {(a11y) => (
              <SelectField
                {...a11y}
                disabled={disabled || product === ''}
                {...register(`items.${index}.product_grade_id`)}
              >
                <option value="">{t('reception.grade.gradePlaceholder')}</option>
                {productGrades.map((g) => (
                  <option key={g.id} value={g.id}>
                    {t('reception.grade.gradeOption', { name: g.name, price: g.base_price })}
                  </option>
                ))}
              </SelectField>
            )}
          </Field>
        </div>

        <div className="mt-3 flex flex-wrap items-end gap-3">
          <Field
            name={`items.${index}.bonus`}
            label={t('reception.grade.bonus')}
            error={bonusError ?? undefined}
          >
            {(a11y) => (
              <div
                className={cn(
                  'flex items-center gap-1 rounded-lg border bg-background p-1',
                  bonusOutOfRange ? 'border-amber' : 'border-border',
                )}
              >
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('reception.grade.bonusDown')}
                  disabled={disabled}
                  onClick={() => stepBonus(-1)}
                >
                  <Minus className="size-3.5" />
                </Button>
                <TextInput
                  {...a11y}
                  variant="ghost"
                  inputMode="decimal"
                  autoComplete="off"
                  disabled={disabled}
                  className="w-16 text-center font-mono font-semibold"
                  {...register(`items.${index}.bonus`)}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('reception.grade.bonusUp')}
                  disabled={disabled}
                  onClick={() => stepBonus(1)}
                >
                  <Plus className="size-3.5" />
                </Button>
              </div>
            )}
          </Field>
          {grade ? (
            <p className="pb-2 text-xs text-muted-foreground">
              {t('reception.grade.bounds', {
                discount: grade.max_discount,
                markup: grade.max_markup,
              })}
            </p>
          ) : null}
          {bonusOutOfRange ? (
            <p className="flex items-center gap-1.5 pb-2 text-xs text-amber">
              <AlertTriangle className="size-3.5 shrink-0" />
              {t('reception.grade.outOfRange')}
            </p>
          ) : null}
        </div>

        {/* The line's numbers, kept visible (dimmed) while a newer preview is in
            flight — §3. A mapped refusal is shown at the FIELD it names (above),
            so this reads destructive rather than repeating the message: one
            alert per refusal, not two. */}
        <p
          className={cn(
            'mt-3 font-mono text-sm',
            hasLineError
              ? 'text-destructive'
              : previewItem
                ? 'text-foreground'
                : 'text-muted-foreground',
            isPreviewPending && 'opacity-60',
          )}
        >
          {previewItem
            ? t('reception.line.preview', {
                tare: formatKg(previewItem.tare_weight_kg, locale),
                net: formatKg(previewItem.net_kg, locale),
                price: formatDecimal(previewItem.price, locale),
                bonus: formatDecimal(previewItem.bonus, locale),
                amount: formatUah(previewItem.amount, locale),
              })
            : t('reception.line.pending')}
        </p>

        {perCrateWarning && perCrate !== null ? (
          <p className="mt-1.5 flex items-start gap-2 text-xs text-amber">
            <AlertTriangle className="mt-px size-3.5 shrink-0" />
            {t('reception.line.perCrateWarning', { kg: formatDecimal(perCrate, locale) })}
          </p>
        ) : null}
      </div>
    </>
  );
}
