import { useState, type ChangeEvent, type ReactNode } from 'react';
import { Layers, Minus, Package, Plus, Trash2 } from 'lucide-react';
import { Trans, useTranslation } from 'react-i18next';
import {
  useFieldArray,
  useWatch,
  type Control,
  type UseFormRegister,
  type UseFormSetValue,
} from 'react-hook-form';
import { Button } from '@/shared/ui/button';
import { Field } from '@/shared/ui/field';
import { SelectField } from '@/shared/ui/select-field';
import { DecimalInput } from '@/shared/ui/decimal-input';
import { useDecimalField } from '@/shared/ui/use-decimal-field';
import { TextInput } from '@/shared/ui/text-input';
import { TraceTerm } from '@/shared/ui/trace';
import { cn } from '@/shared/lib/cn';
import {
  add,
  clampDecimal,
  cmp,
  div,
  formatDecimal,
  formatKg,
  formatUah,
  formatUahPerKg,
  maskDecimalInput,
  mul,
  parseCrateCount,
  sub,
  unbreakable,
} from '@/shared/lib/money';
import type { PricedGrade } from '@/entities/product-grade';
import type { TareTypeOption } from '@/entities/tare-type';
import { formatBonusSign } from '../lib/formatBonusSign';
import { formatWholeHryvnia } from '../lib/formatWholeHryvnia';
import { WarningTooltip } from './WarningTooltip';
import { ENTRY_EXIT, ENTRY_FIELD, ENTRY_LINE, ENTRY_WAIT } from '../lib/entryFields';
import { ACCRUED_TRACE, DRAFT_TRACE } from '../lib/traceIds';
import type { IntakeFormValues, IntakePreviewItem } from '../model/intakeForm';

/** §5.2 — the largest line of the season was 701,5 kg; above this we ask. */
const IMPLAUSIBLE_GROSS = '750';
/** A Czech crate really carries 3…12 kg; outside 2…14 it is almost always a typo. */
const PER_CRATE_MIN = '2';
const PER_CRATE_MAX = '14';
/** One step of the «Ціна» stepper, in ₴/kg. */
const PRICE_STEP = '1';

/** ↑ and ↓ step the two stepper fields (the tare count and the price) the way
 *  their − and + do, so neither needs the mouse; any other key is the field's. */
function arrowDirection(key: string): 1 | -1 | null {
  if (key === 'ArrowUp') return 1;
  if (key === 'ArrowDown') return -1;
  return null;
}

/** A `<Trans>` slot that renders a node of its own — an optional part of the
 *  formula («− 14,30 кг піддон»), itself translated — ignoring the (empty) tag. */
function Slot({ node }: { node: ReactNode }) {
  return <>{node}</>;
}

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
 * The draft line, one dashed block in two rows (spec §4): the weights and tare
 * (§2.5) on top, the priced grade and this line's price under them — the
 * grade's price, adjustable within the grade's own bounds (§2.8, §2.10), then the server's numbers, the hints, and a footer that commits it
 * («Ще позиція») or drops it. NOTHING here computes money — the
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
  errorAt,
  disabled,
  canAdd,
  addWaiting,
  atCap,
  onAdd,
  onRemoveDraft,
  priceHintKey,
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
  errorAt: (field: string) => string | null;
  disabled: boolean;
  /** Removes THIS draft from the field array — the escape hatch «Ще позиція»
   *  needs the moment it appends an empty draft: `index > 0` (this is not
   *  line 0) is the only condition for showing it, since line 0 is the form's
   *  one unremovable line. Removing the draft promotes the last committed
   *  line back into the editor — a coherent un-commit, not a delete. */
  onRemoveDraft: () => void;
  /** Whether «Ще позиція» may commit this draft — the page's gate, unchanged. */
  canAdd: boolean;
  /** The draft is finished and only the preview is still to come: Enter
   *  waits on «Ще позиція» instead of jumping past it (`ENTRY_WAIT`). */
  addWaiting: boolean;
  /** Five lines already (§2.3): the cap hint replaces the multi-grade one. */
  atCap: boolean;
  /** Commits the draft: the page appends a fresh empty line after it. */
  onAdd: () => void;
  /** The picked supplier's §2.11 hint («Це оптовик — перевірте ціну»), an
   *  i18n key, or null — said on «Ціна», the field it asks to check. */
  priceHintKey: string | null;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? 'uk';

  const tare = useFieldArray({ control, name: `items.${index}.tare` });
  const gross = useWatch({ control, name: `items.${index}.gross_kg` }) ?? '';
  const pallet = useWatch({ control, name: `items.${index}.pallet_kg` }) ?? '0.00';
  const bonus = useWatch({ control, name: `items.${index}.bonus` }) ?? '';
  const gradeId = useWatch({ control, name: `items.${index}.product_grade_id` }) ?? '';
  const tareRows = useWatch({ control, name: `items.${index}.tare` }) ?? [];

  const [showPallet, setShowPallet] = useState(false);
  // The price as typed, held only while the operator is mid-edit: the form
  // stores the BONUS (what the server takes, §2.8), and the price shown is
  // derived from it — so a draft restore or a stepper click needs no syncing.
  const [priceDraft, setPriceDraft] = useState<string | null>(null);
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

  // Each row's count, read once: `null` is a count the form refuses.
  const tareCounts = tareRows.map((row) => parseCrateCount(row.units));
  // The tare block has no `Field` of its own (a type select plus a stepper is
  // not one control), so it carries every tare error: a count that is not
  // whole, refused here at once — a separator in a count is never on its way
  // to anything (#233 review) — ahead of the server's two, the business-rule
  // one it pins to row 0 and a class-validator complaint about any row's `units`.
  const tareError =
    (tareCounts.includes(null) ? 'crates.errors.unitsFormat' : null) ??
    errorAt(`items.${index}.tare.0.tare_type_id`) ??
    tareRows.reduce<string | null>(
      (found, _row, rowIndex) => found ?? errorAt(`items.${index}.tare.${rowIndex}.units`),
      null,
    );
  // #72 — the shape of a weight or a surcharge is the field's own business,
  // not the preview's: with no supplier picked yet there IS no preview, and a
  // «1.2.3» must not sit there unremarked. Shown once the field is left.
  // A tare row's crate count takes the money fields' mask (#233 review):
  // spaces and letters never get in, a digit or a separator is never dropped.
  // `\D`-stripping read «2,0» as 20 — ten times the tare, a silent change of
  // the net weight and so the sum (#72). A separator stays visible instead,
  // and `tareError` refuses it.
  const unitsField = (rowIndex: number) => {
    const field = register(`items.${index}.tare.${rowIndex}.units`);
    return {
      ...field,
      onChange: (e: ChangeEvent<HTMLInputElement>) => {
        // The count starts at 0 (`emptyLine`), and the caret lands after it:
        // a leading zero goes, so typing «12» over it reads 12, not «012».
        const masked = maskDecimalInput(e.target.value).replace(/^0+(?=\d)/, '');
        if (masked !== e.target.value) e.target.value = masked;
        return field.onChange(e);
      },
    };
  };
  const grossField = useDecimalField(gross);
  const palletField = useDecimalField(pallet);

  // The operator edits a PRICE; the form keeps the BONUS the server takes
  // (§2.8), always price − the grade's price. Bounds are the GRADE's, not a
  // global setting (§3): `max_discount` is a magnitude, and a price never
  // goes below zero (RATE_NEGATIVE). §2.10 / #117 — the bound is a LIMIT
  // applied silently (blur, stepper), never a number shown on screen.
  const bonusValue =
    compare(bonus, '0') === null ? '0.00' : add(bonus.trim().replace(',', '.'), '0');
  const priceFloor = grade
    ? (() => {
        const floor = sub(grade.base_price, grade.max_discount);
        return cmp(floor, '0') === -1 ? '0.00' : floor;
      })()
    : null;
  const priceCeil = grade ? add(grade.base_price, grade.max_markup) : null;
  const shownPrice = grade ? add(grade.base_price, bonusValue) : '';
  const priceText = priceDraft ?? shownPrice;
  // At rest the price reads like every other figure on the screen — «28,00»,
  // the locale's comma (R8); while typed into it is exactly what was typed.
  const priceDisplay = priceDraft ?? (grade ? formatDecimal(shownPrice, locale) : '');

  const setBonusFromPrice = (price: string) => {
    if (!grade) return;
    setValue(`items.${index}.bonus`, sub(price, grade.base_price), { shouldDirty: true });
  };
  const priceField = useDecimalField(priceText, {
    onBlur: () => {
      if (!grade || priceFloor === null || priceCeil === null) return;
      if (priceText.trim() === '') {
        setBonusFromPrice(grade.base_price);
        setPriceDraft(null);
        return;
      }
      const clamped = clampDecimal(priceText, priceFloor, priceCeil);
      // A malformed price stays on screen, refused, rather than vanishing.
      if (compare(clamped, '0') === null) return;
      setBonusFromPrice(clamped);
      setPriceDraft(null);
    },
  });
  const onPriceChange = (value: string) => {
    setPriceDraft(value);
    if (!grade) return;
    if (value.trim() === '') {
      setBonusFromPrice(grade.base_price);
      return;
    }
    // A half-typed price reaches the bonus as-is, so the form's own gate
    // refuses a submit instead of sending the last valid bonus.
    if (compare(value, '0') === null) {
      setValue(`items.${index}.bonus`, value, { shouldDirty: true });
      return;
    }
    setBonusFromPrice(add(value.trim().replace(',', '.'), '0'));
  };

  const grossError = grossField.error ?? errorAt(`items.${index}.gross_kg`);
  const palletError = palletField.error ?? errorAt(`items.${index}.pallet_kg`);
  const bonusError = priceField.error ?? errorAt(`items.${index}.bonus`);
  const gradeError = errorAt(`items.${index}.product_grade_id`);
  const hasLineError = Boolean(grossError || palletError || bonusError || gradeError || tareError);

  const stepPrice = (direction: 1 | -1) => {
    if (!grade || priceFloor === null || priceCeil === null) return;
    const next = direction === 1 ? add(shownPrice, PRICE_STEP) : sub(shownPrice, PRICE_STEP);
    setPriceDraft(null);
    setBonusFromPrice(clampDecimal(next, priceFloor, priceCeil));
  };
  // A new grade starts at its own price: a bonus agreed for one grade is not
  // a bonus for the next.
  const resetPrice = () => {
    setPriceDraft(null);
    setValue(`items.${index}.bonus`, '0.00', { shouldDirty: true });
  };
  const gradeSelect = register(`items.${index}.product_grade_id`);

  // A tare row that counts nothing is still a row — zero is a real (if
  // incomplete) state the mock lets an operator sit in while they weigh out
  // the crates; «remove» is how a row goes away entirely. The stepper floors
  // at 0 rather than 1, and steps a refused count from 0.
  const stepUnits = (row: number, direction: 1 | -1) => {
    const current = tareCounts[row] ?? 0;
    setValue(`items.${index}.tare.${row}.units`, String(Math.max(0, current + direction)), {
      shouldDirty: true,
    });
  };

  // Integer unit COUNTS, never money; a refused count adds nothing.
  const totalUnits = tareCounts.reduce<number>((n, c) => n + (c ?? 0), 0);
  // What the tare rows take off, for the heading — the same `{weight ×
  // units}` each row used to show, added up exactly. The server's own figure
  // is in the formula line under the line once it is priced.
  const tareKg = tareRows.reduce((kg, row, rowIndex) => {
    const type = tareTypes.find((candidate) => candidate.id === row.tare_type_id);
    return type ? add(kg, mul(type.weight_kg, tareCounts[rowIndex] ?? 0)) : kg;
  }, '0.00');

  // ONE normalization, fed to both the comparison and the formatter: they use
  // different regexes, and `formatDecimal`'s admits no surrounding whitespace —
  // so a pasted " 800" used to pass the comparison and then throw mid-render.
  const normalizedGross = gross.trim().replace(',', '.');
  const grossWarning = compare(normalizedGross, IMPLAUSIBLE_GROSS) === 1;
  const grossPositive = compare(normalizedGross, '0') === 1;
  // The pallet field auto-reveals once it has something to say: a manual
  // «+ Pallet» click, a server refusal pinned to it, twenty tare units (the
  // mock's own threshold — a pallet is likely under that much), or a value
  // already typed into it (e.g. a refusal round-trip that left it non-zero).
  const revealPallet =
    showPallet || palletError !== null || totalUnits >= 20 || compare(pallet, '0.00') !== 0;
  // Per crate is read off the SERVER's net weight and the integer unit counts it
  // resolved — never off a typed weight, and never through a float (`div` is
  // BigInt kopiykas).
  const previewUnits = (previewItem?.tare ?? []).reduce((total, row) => total + row.units, 0);
  const perCrate = previewItem && previewUnits > 0 ? div(previewItem.net_kg, previewUnits) : null;
  const perCrateWarning =
    perCrate !== null &&
    (cmp(perCrate, PER_CRATE_MIN) === -1 || cmp(perCrate, PER_CRATE_MAX) === 1);

  // The warnings are amber HINTS — none of them disables anything. Each is
  // said on the control it is about: the control turns amber and gives the
  // reason on hover (`WarningTooltip`), rather than a line under the preview
  // that pops in mid-typing and shifts the card (client, 24.10). `tareError`
  // is a refusal, not a hint, and keeps its line.
  const perCrateText =
    perCrateWarning && perCrate !== null
      ? t('reception.line.perCrateWarning', { kg: formatDecimal(perCrate, locale) })
      : null;
  // An implausible gross first; the per-crate one names the gross too.
  const grossHint = grossWarning
    ? t('reception.line.grossWarning', { gross: formatDecimal(normalizedGross, locale) })
    : perCrateText;
  // A gross weight with no tare counted would all go into the net.
  const tareHint =
    grossPositive && totalUnits === 0 && !tareError
      ? t('reception.line.tareMissing')
      : perCrateText;
  const priceHint = priceHintKey !== null ? t(priceHintKey) : null;
  const gradeHint =
    grossPositive && totalUnits > 0 && gradeId === '' ? t('reception.line.gradeMissing') : null;
  const hintIds = {
    gross: `items.${index}.gross-hint`,
    tare: `items.${index}.tare-hint`,
    grade: `items.${index}.grade-hint`,
    price: `items.${index}.price-hint`,
  };
  const describedBy = (own: string | undefined, hint: string | null, hintId: string) =>
    [own, hint !== null ? hintId : null].filter(Boolean).join(' ') || undefined;
  const amber = 'border-amber bg-amber/10';

  return (
    <div className="px-4 pb-4" {...ENTRY_LINE}>
      <div className="flex flex-col gap-3 rounded-lg border border-dashed border-border p-3">
        {/* Row 1 — pricing: the product, its grade at the day's price, and
            this line's own extra price (§2.8). First, ahead of the weighing
            (client, 24.10): the operator sees the berry before it is on the
            scale, and Tab and Enter follow this same order. */}
        <div className="flex flex-wrap items-start gap-3">
          <Field
            size="large"
            name={`product-line-${index}`}
            label={t('reception.grade.product')}
            className="min-w-[130px] flex-1"
          >
            {(a11y) => (
              <SelectField
                {...a11y}
                {...ENTRY_FIELD}
                // An empty «Товар» on a line after the first: Enter leaves the
                // line for «Видано готівкою» (client, 24.10).
                {...(index > 0 && product === '' ? ENTRY_EXIT : {})}
                value={product}
                disabled={disabled}
                className="h-10"
                onChange={(e) => {
                  setPickedProduct(e.target.value);
                  // Changing the product must never leave a grade of the OTHER
                  // product selected — the first grade of the new one, or none.
                  const first = grades.find((g) => g.productName === e.target.value);
                  setValue(`items.${index}.product_grade_id`, first?.id ?? '', {
                    shouldDirty: true,
                  });
                  resetPrice();
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
            size="large"
            name={`items.${index}.product_grade_id`}
            label={t('reception.grade.grade')}
            required
            error={gradeError ?? undefined}
            className="min-w-[160px] flex-[1.3]"
          >
            {(a11y) => (
              <WarningTooltip text={gradeHint}>
                <SelectField
                  {...a11y}
                  aria-describedby={describedBy(a11y['aria-describedby'], gradeHint, hintIds.grade)}
                  // A hybrid of `register` (so a user pick still updates RHF the
                  // normal way) plus an explicit `value`: the grade OPTIONS are
                  // scoped to `product`, which itself is derived from the grade
                  // (one render behind a programmatic `setValue`, e.g. the
                  // page's pre-select effect) — a plain uncontrolled `register`
                  // select would try to apply that value before its matching
                  // `<option>` exists and silently drop it, with no later
                  // render retrying since nothing marks it controlled. `value`
                  // makes React re-apply it on every render until it sticks.
                  {...ENTRY_FIELD}
                  value={gradeId}
                  disabled={disabled || product === ''}
                  className={cn('h-10', gradeHint !== null && amber)}
                  {...gradeSelect}
                  onChange={(e) => {
                    resetPrice();
                    return gradeSelect.onChange(e);
                  }}
                >
                  <option value="">{t('reception.grade.gradePlaceholder')}</option>
                  {productGrades.map((g) => (
                    <option key={g.id} value={g.id}>
                      {t('reception.grade.gradeOption', {
                        name: g.name,
                        price: formatDecimal(g.base_price, locale),
                      })}
                    </option>
                  ))}
                </SelectField>
              </WarningTooltip>
            )}
          </Field>

          <Field
            size="large"
            name={`items.${index}.bonus`}
            label={t('reception.grade.price')}
            error={bonusError ?? undefined}
            // The deviation from the grade's price, never the bounds (§2.10):
            // the operator and whoever checks the receipt see a non-base price.
            // The bare signed figure, in the label's row (client, 24.10); the
            // whole sentence is what a screen reader hears.
            labelAside={
              grade && cmp(bonusValue, '0') !== 0 ? (
                <>
                  <span aria-hidden="true" className="font-mono text-amber">
                    {formatBonusSign(bonusValue, locale)}
                  </span>
                  <span className="sr-only">
                    {t('reception.grade.priceDelta', {
                      delta: formatBonusSign(bonusValue, locale),
                    })}
                  </span>
                </>
              ) : undefined
            }
            className="w-full sm:w-auto"
          >
            {(a11y) => (
              <WarningTooltip text={priceHint}>
                <div
                  data-trace={DRAFT_TRACE.price}
                  className={cn(
                    'flex h-10 items-center gap-1 rounded-lg border p-1',
                    priceHint !== null ? amber : 'border-border bg-background',
                  )}
                >
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('reception.grade.priceDown')}
                    // Out of Tab, like the tare steppers: the price is typed
                    // or stepped with ↑/↓.
                    tabIndex={-1}
                    disabled={disabled || !grade}
                    onClick={() => stepPrice(-1)}
                  >
                    <Minus className="size-3.5" />
                  </Button>
                  <DecimalInput
                    {...a11y}
                    aria-describedby={describedBy(
                      a11y['aria-describedby'],
                      priceHint,
                      hintIds.price,
                    )}
                    {...ENTRY_FIELD}
                    variant="ghost"
                    value={priceDisplay}
                    onChange={(e) => onPriceChange(e.target.value)}
                    {...priceField.inputProps}
                    onKeyDown={(e) => {
                      const direction = arrowDirection(e.key);
                      if (direction === null) return;
                      e.preventDefault();
                      stepPrice(direction);
                    }}
                    disabled={disabled || !grade}
                    className="w-20 flex-1 text-center font-mono font-semibold sm:flex-none"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('reception.grade.priceUp')}
                    tabIndex={-1}
                    disabled={disabled || !grade}
                    onClick={() => stepPrice(1)}
                  >
                    <Plus className="size-3.5" />
                  </Button>
                </div>
              </WarningTooltip>
            )}
          </Field>
        </div>

        {/* Row 2 — weighing: Брутто, then everything taken off it in
            §2.4's order — the pallet first, then the tare — as rows of ONE
            column. Every row is the same 40 px: a name on the left, the amount
            in a fixed-width box, the weight it takes off, a remove slot. */}
        <div className="flex flex-wrap items-start gap-3">
          <Field
            size="large"
            name={`items.${index}.gross_kg`}
            label={t('reception.weight.gross')}
            required
            error={grossError ?? undefined}
            className="min-w-[140px] flex-1"
          >
            {(a11y) => (
              <WarningTooltip text={grossHint}>
                <div className="relative">
                  <DecimalInput
                    {...a11y}
                    aria-describedby={describedBy(
                      a11y['aria-describedby'],
                      grossHint,
                      hintIds.gross,
                    )}
                    {...ENTRY_FIELD}
                    value={gross}
                    onChange={(e) =>
                      setValue(`items.${index}.gross_kg`, e.target.value, { shouldDirty: true })
                    }
                    {...grossField.inputProps}
                    data-trace={DRAFT_TRACE.gross}
                    disabled={disabled}
                    placeholder="0,00"
                    className={cn(
                      'h-10 pr-12 font-mono text-xl font-semibold',
                      grossHint !== null && amber,
                    )}
                  />
                  <span className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 font-mono text-sm text-muted-foreground">
                    {t('reception.weight.unit')}
                  </span>
                </div>
              </WarningTooltip>
            )}
          </Field>

          {/* «Інша тара» and «Піддон» (in the footer) add rows here; they
              stack and push the block down rather than widen it (spec §4). */}
          <div className="min-w-0 basis-full sm:min-w-[260px] sm:basis-0 sm:flex-[2.4]">
            {/* The tare's weight, every row added up, in the heading's own
                row (client, 24.10) — so the steppers end flush with the
                price stepper above instead of a figure hanging past them. */}
            <div className="mb-1.5 flex items-baseline justify-between gap-2 text-sm font-medium text-muted-foreground">
              <span>{t('reception.weight.tare')}</span>
              <span data-trace={DRAFT_TRACE.tare} className="font-mono font-normal">
                {formatKg(tareKg, locale)}
              </span>
            </div>
            <div className="flex flex-col gap-1.5">
              {revealPallet ? (
                <div>
                  <div className="flex items-center gap-2">
                    <label
                      htmlFor={`items.${index}.pallet_kg`}
                      className="flex h-10 min-w-0 flex-1 items-center rounded-xl border border-input bg-muted/30 px-3.5 text-base"
                    >
                      {t('reception.weight.pallet')}
                    </label>
                    <div className="relative w-32 shrink-0">
                      <DecimalInput
                        id={`items.${index}.pallet_kg`}
                        {...ENTRY_FIELD}
                        aria-invalid={palletError ? true : undefined}
                        aria-describedby={
                          palletError ? `items.${index}.pallet_kg-error` : undefined
                        }
                        value={pallet}
                        onChange={(e) =>
                          setValue(`items.${index}.pallet_kg`, e.target.value, {
                            shouldDirty: true,
                          })
                        }
                        {...palletField.inputProps}
                        data-trace={DRAFT_TRACE.pallet}
                        disabled={disabled}
                        className="h-10 rounded-lg pr-9 text-center font-mono font-semibold"
                      />
                      <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 font-mono text-sm text-muted-foreground">
                        {t('reception.weight.unit')}
                      </span>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t('reception.weight.removePallet')}
                      disabled={disabled}
                      onClick={() => {
                        setValue(`items.${index}.pallet_kg`, '0.00', { shouldDirty: true });
                        setShowPallet(false);
                      }}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                  {palletError ? (
                    <p
                      id={`items.${index}.pallet_kg-error`}
                      role="alert"
                      className="mt-1.5 text-sm leading-snug text-destructive"
                    >
                      {t(palletError)}
                    </p>
                  ) : null}
                </div>
              ) : null}
              {tare.fields.map((row, rowIndex) => {
                return (
                  <div key={row.id} className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <SelectField
                        aria-label={t('reception.weight.tareType', { n: rowIndex + 1 })}
                        {...ENTRY_FIELD}
                        disabled={disabled}
                        className="h-10"
                        {...register(`items.${index}.tare.${rowIndex}.tare_type_id`)}
                      >
                        {tareTypes.map((type) => (
                          <option key={type.id} value={type.id}>
                            {t('reception.weight.tareOption', {
                              name: type.name,
                              weight: formatDecimal(type.weight_kg, locale),
                            })}
                          </option>
                        ))}
                      </SelectField>
                    </div>
                    <WarningTooltip text={tareHint}>
                      <div
                        className={cn(
                          'flex h-10 w-32 shrink-0 items-center gap-1 rounded-lg border p-1 transition-colors',
                          tareHint !== null ? amber : 'border-border bg-background',
                        )}
                      >
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={t('reception.weight.fewer', { n: rowIndex + 1 })}
                          // Out of Tab: the count beside it is typed, or stepped
                          // with ↑/↓ (client, 24.10).
                          tabIndex={-1}
                          disabled={disabled}
                          onClick={() => stepUnits(rowIndex, -1)}
                        >
                          <Minus className="size-3.5" />
                        </Button>
                        <TextInput
                          variant="ghost"
                          aria-label={t('reception.weight.units', { n: rowIndex + 1 })}
                          aria-describedby={tareHint !== null ? hintIds.tare : undefined}
                          {...ENTRY_FIELD}
                          inputMode="numeric"
                          autoComplete="off"
                          disabled={disabled}
                          className="w-full min-w-0 flex-1 text-center font-mono font-semibold"
                          {...unitsField(rowIndex)}
                          onKeyDown={(e) => {
                            const direction = arrowDirection(e.key);
                            if (direction === null) return;
                            e.preventDefault();
                            stepUnits(rowIndex, direction);
                          }}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={t('reception.weight.more', { n: rowIndex + 1 })}
                          tabIndex={-1}
                          disabled={disabled}
                          onClick={() => stepUnits(rowIndex, 1)}
                        >
                          <Plus className="size-3.5" />
                        </Button>
                      </div>
                    </WarningTooltip>
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
                    ) : revealPallet ? (
                      // Holds the remove column so a lone tare row lines up
                      // with the pallet row's own remove button above it.
                      <span className="size-8 shrink-0" aria-hidden="true" />
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* The line's numbers, kept visible (dimmed) while a newer preview is in
            flight — §3. A mapped refusal is shown at the FIELD it names (above),
            so this reads destructive rather than repeating the message: one
            alert per refusal, not two.
            R4 (spec 2026-10-23): the line reads as its own formula, §2.4's
            order, every figure the server's and every one with its unit —
            «52,30 кг − 1,20 кг тара = 51,10 кг × 28,00 ₴/кг = 1 430,80 ₴ →
            1 431 ₴» (2026-10-24), no term ever broken across a line. The pallet only when there is one; the
            exact product (`amount_exact`) only when §2.12's whole-hryvnia
            rounding moved it. */}
        <p
          data-testid="line-formula"
          className={cn(
            'rounded-md bg-muted/50 px-3 py-2 font-mono text-sm tabular-nums',
            hasLineError
              ? 'text-destructive'
              : previewItem
                ? 'text-foreground'
                : 'text-muted-foreground',
            isPreviewPending && 'opacity-60',
          )}
        >
          {previewItem ? (
            <DraftFormula item={previewItem} locale={locale} />
          ) : (
            t('reception.line.pending')
          )}
        </p>

        {/* The hints' text for a screen reader, which never hovers — each
            linked to its control through `aria-describedby`. */}
        {grossHint !== null ? (
          <span id={hintIds.gross} className="sr-only">
            {grossHint}
          </span>
        ) : null}
        {tareHint !== null ? (
          <span id={hintIds.tare} className="sr-only">
            {tareHint}
          </span>
        ) : null}
        {gradeHint !== null ? (
          <span id={hintIds.grade} className="sr-only">
            {gradeHint}
          </span>
        ) : null}
        {priceHint !== null ? (
          <span id={hintIds.price} className="sr-only">
            {priceHint}
          </span>
        ) : null}
        {tareError ? (
          <p role="alert" className="-mt-1.5 text-sm text-destructive">
            {t(tareError)}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3 xl:flex-nowrap">
          {/* «Інша тара» lives here, not under the tare rows, so row 1 stays
              one control tall; in DOM order it still follows the tare and
              precedes «Прибрати позицію» / «Ще позиція» (spec §5.2). */}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="-ml-2 shrink-0"
            disabled={disabled || !freeTareType}
            onClick={() =>
              freeTareType && tare.append({ tare_type_id: freeTareType.id, units: '0' })
            }
          >
            <Package className="size-3.5" />
            {t('reception.weight.otherTare')}
          </Button>
          {revealPallet ? null : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="shrink-0"
              disabled={disabled}
              onClick={() => setShowPallet(true)}
            >
              <Layers className="size-3.5" />
              {t('reception.weight.pallet')}
            </Button>
          )}
          {/* «Ще позиція» always leaves a fresh draft behind. An untouched one
              is ignored (`withoutBlankDraft`), but a half-filled one cannot
              preview (`isPreviewable` wants every line complete) — this is the
              way back from it, offered the moment there IS a committed line
              to fall back to. */}
          {index > 0 ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="shrink-0 text-muted-foreground"
              disabled={disabled}
              onClick={onRemoveDraft}
            >
              <Trash2 className="size-3.5" />
              {t('reception.lines.remove')}
            </Button>
          ) : null}
          {/* Its own row on a phone (B9): beside the tare buttons it was
              squeezed under its button, which then overlapped «Піддон». */}
          <div className="flex min-w-0 basis-full items-center justify-end gap-3 sm:flex-1 sm:basis-0">
            {/* At five lines the cap hint is said out loud; below it the
                multi-grade hint rides on the button's title. The hint truncates
                (whole sentence on hover) and claims no width of its own, so
                it never forces a wrap; the footer wraps only when the buttons
                themselves do not fit. */}
            {atCap ? (
              <span
                title={t('reception.lines.capHint')}
                className="min-w-0 flex-1 truncate text-right text-sm text-muted-foreground"
              >
                {t('reception.lines.capHint')}
              </span>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              title={atCap ? t('reception.lines.capHint') : t('reception.lines.hint')}
              // Enter's walk ends on the line here; Enter on it adds the line.
              {...ENTRY_FIELD}
              {...(addWaiting ? ENTRY_WAIT : {})}
              disabled={!canAdd}
              onClick={onAdd}
              className="shrink-0"
            >
              <Plus className="size-4" />
              {t('reception.lines.add')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The draft line as its own formula (R4): «52,30 кг − 1,20 кг тара = 51,10 кг ×
 * 28,00 ₴/кг = 1 430,80 ₴ → 1 431 ₴», every figure the server's preview and every
 * one a `TraceTerm` that lights up the field it came from — Брутто, Піддон, the
 * tare heading, Ціна — while the amount lights «Нараховано сьогодні», which it is
 * part of. The pallet only when there is one; the exact product only when
 * §2.12's whole-hryvnia rounding moved it.
 */
function DraftFormula({ item, locale }: { item: IntakePreviewItem; locale: string }) {
  const { t } = useTranslation();
  const kg = (value: string) => unbreakable(formatKg(value, locale));
  // An empty term: `<Trans>` fills it with the tag's own (formatted) figure.
  const term = (refs: string, hintKey: string) => (
    <TraceTerm refs={refs} hint={t(hintKey)}>
      {null}
    </TraceTerm>
  );
  const rounded = cmp(item.amount, item.amount_exact) !== 0;
  const pallet =
    cmp(item.pallet_kg, '0') !== 0 ? (
      <Trans
        t={t}
        i18nKey="reception.line.palletPart"
        values={{ kg: kg(item.pallet_kg) }}
        components={{ kg: term(DRAFT_TRACE.pallet, 'reception.line.trace.pallet') }}
      />
    ) : null;
  const amount = (
    <Trans
      t={t}
      i18nKey={rounded ? 'reception.line.amountRounded' : 'reception.line.amountWhole'}
      values={{
        exact: unbreakable(formatUah(item.amount_exact, locale)),
        amount: formatWholeHryvnia(item.amount, locale),
      }}
      components={{
        exact: term(DRAFT_TRACE.exact, 'reception.line.trace.exact'),
        amount: term(ACCRUED_TRACE, 'reception.line.trace.amount'),
      }}
    />
  );
  return (
    <Trans
      t={t}
      i18nKey="reception.line.formula"
      values={{
        gross: kg(item.gross_kg),
        tare: kg(item.tare_weight_kg),
        net: kg(item.net_kg),
        // The line's own price, as the operator set it in «Ціна» — not the
        // grade's price plus a signed bonus to add up.
        price: unbreakable(formatUahPerKg(add(item.price, item.bonus), locale)),
      }}
      components={{
        gross: term(DRAFT_TRACE.gross, 'reception.line.trace.gross'),
        tare: term(DRAFT_TRACE.tare, 'reception.line.trace.tare'),
        net: term(DRAFT_TRACE.net, 'reception.line.trace.net'),
        price: term(DRAFT_TRACE.price, 'reception.line.trace.price'),
        pallet: <Slot node={pallet} />,
        amount: <Slot node={amount} />,
      }}
    />
  );
}
