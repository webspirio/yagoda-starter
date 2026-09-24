import { useMemo, useState, type ChangeEvent } from 'react';
import { Minus, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import { Eyebrow } from '@/shared/ui/eyebrow';
import { Field } from '@/shared/ui/field';
import { SelectField } from '@/shared/ui/select-field';
import { TextInput } from '@/shared/ui/text-input';
import { DECIMAL_INPUT, cmp, formatDecimal, formatKg, normalizeAmount } from '@/shared/lib/money';
import { formatShortDate } from '@/shared/lib/date';
import { useTareTypeOptionsQuery } from '@/entities/tare-type';
import type { ReconciliationGrade } from '@/entities/reweigh';
import { netOf, newDraftKey, tareWeightOf, type Draft } from '../model/draft';
import { addBlockReason, grossHint, tareHint } from '../lib/hints';
import { FieldWarning } from './FieldWarning';

/**
 * A decimal field's RAW typed text, made safe for `@/shared/lib/money`
 * arithmetic — normalized (comma/space) and checked against the same
 * `DECIMAL_INPUT` shape the server accepts. An in-progress keystroke like
 * `"120."` would make `money.ts` throw; falling back to `'0.00'` here keeps
 * the FIELD itself unrestricted while typing (same discipline as every other
 * money field in this repo — see `TopUpDialog`/`amountRules`, which validate
 * on submit rather than filtering keystrokes), so a live чиста вага never
 * crashes mid-type.
 */
function toCalcAmount(raw: string): string {
  const normalized = normalizeAmount(raw);
  return DECIMAL_INPUT.test(normalized) ? normalized : '0.00';
}

interface ProductGroup {
  product_id: string;
  product_name: string;
  grades: ReconciliationGrade[];
}

/**
 * `grades[]` arrives ordered by product name then grade name
 * (`entities/reweigh`'s `ReconciliationGrade`) — this groups CONSECUTIVE rows
 * by `product_id` rather than re-sorting, so the picker's optgroups keep
 * exactly the server's own order.
 */
function groupByProduct(grades: ReconciliationGrade[]): ProductGroup[] {
  const groups: ProductGroup[] = [];
  for (const grade of grades) {
    const last = groups[groups.length - 1];
    if (last && last.product_id === grade.product_id) {
      last.grades.push(grade);
    } else {
      groups.push({
        product_id: grade.product_id,
        product_name: grade.product_name,
        grades: [grade],
      });
    }
  }
  return groups;
}

/**
 * Mock steps 1–3 (`.reference/yagoda-crm/src/pages/ReweighPage.tsx:431-583`):
 * вага з ягодою → піддон → кількість ящиків → сорт → «Додати позицію», in that
 * order and no other. Чиста вага is DERIVED — `netOf` (Task 5), never a field
 * anyone types into — and «+ Додати позицію» is gated by `addBlockReason`
 * (Task 6), a hard ladder distinct from the two amber warnings
 * (`grossHint`/`tareHint`) that never disable anything.
 *
 * Five `useState`s, no `react-hook-form`: `LoginForm`'s reasoning applies
 * here too — this is a handful of fields with no schema to validate against,
 * just the decimal-string shape `DECIMAL_INPUT` already checks.
 */
export function WeighingForm({
  grades,
  hasShift,
  acceptedAnything,
  pointName,
  date,
  onAdd,
}: {
  grades: ReconciliationGrade[];
  hasShift: boolean;
  acceptedAnything: boolean;
  pointName: string;
  date: string;
  onAdd: (draft: Draft) => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? 'uk';
  const tareTypes = useTareTypeOptionsQuery();

  const [gross, setGross] = useState('');
  const [pallet, setPallet] = useState('');
  const [tareId, setTareId] = useState<string | null>(null);
  // A STRING, not the count itself — an empty string is how the field looks
  // mid-edit (the user cleared it before typing a new number), and forcing
  // that back to "0" immediately would undo the clear the next keystroke
  // relies on.
  const [tareCountInput, setTareCountInput] = useState('0');
  const [gradeId, setGradeId] = useState<string | null>(null);

  const weightById = useMemo(
    () => new Map((tareTypes.data ?? []).map((tt) => [tt.id, tt.weight_kg])),
    [tareTypes.data],
  );

  // The crate type does not change between pallets (per the task's own
  // requirement), so `tareId` is never reset by `handleAdd` — it only
  // defaults to the catalogue's first entry until the owner picks one.
  const effectiveTareId = tareId ?? tareTypes.data?.[0]?.id ?? null;
  const tareCount = tareCountInput === '' ? 0 : Number(tareCountInput);

  const grossForCalc = toCalcAmount(gross);
  const palletForCalc = toCalcAmount(pallet);

  const tare =
    tareCount > 0 && effectiveTareId ? [{ tare_type_id: effectiveTareId, units: tareCount }] : [];
  const tareWeight = tareWeightOf(tare, weightById);
  const net = netOf(grossForCalc, palletForCalc, tareWeight);
  // Clamp at zero for DISPLAY only — the mock does the same with
  // `Math.max(0, …)`. `addBlockReason` (below) is what actually refuses a
  // non-positive line; this clamp never touches the value handed to `onAdd`.
  const netForDisplay = cmp(net, '0.00') < 0 ? '0.00' : net;

  const block = addBlockReason({
    hasShift,
    acceptedAnything,
    gradeId,
    grossKg: grossForCalc,
    netKg: net,
  });

  const blockCopy: string | null =
    block === 'noShift'
      ? t('reweigh.block.noShift')
      : block === 'nothingAccepted'
        ? t('reweigh.block.nothingAccepted', { point: pointName, date: formatShortDate(date, locale) })
        : block === 'noGrade'
          ? t('reweigh.block.noGrade')
          : block === 'noGross'
            ? t('reweigh.block.noGross')
            : block === 'noNet'
              ? t('reweigh.block.noNet')
              : null;

  const grossWarningText = grossHint(grossForCalc)
    ? t('reweigh.warn.gross', { value: formatKg(grossForCalc, locale) })
    : null;

  const tareHintReason = tareHint(tareCount, grossForCalc);
  const tareWarningText =
    tareHintReason === 'tooMany'
      ? t('reweigh.warn.tareTooMany', { units: tareCount })
      : tareHintReason === 'none'
        ? t('reweigh.warn.tareNone')
        : null;

  const productGroups = useMemo(() => groupByProduct(grades), [grades]);

  function handleAdd() {
    const grade = grades.find((g) => g.product_grade_id === gradeId);
    if (block || !grade) return;
    const draft: Draft = {
      key: newDraftKey(),
      product_grade_id: grade.product_grade_id,
      product_grade_name: grade.product_grade_name,
      product_id: grade.product_id,
      product_name: grade.product_name,
      gross_kg: grossForCalc,
      pallet_kg: palletForCalc,
      tare,
      tare_weight_kg: tareWeight,
      net_kg: net,
    };
    onAdd(draft);
    setGross('');
    setPallet('');
    setTareCountInput('0');
    setGradeId(null);
    // `tareId` is deliberately NOT reset — see the comment above.
  }

  function handleTareCountChange(e: ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value;
    // Only ever a whole non-negative count — `Number()` here is safe because
    // the regex already rejected anything that isn't digits.
    if (raw === '' || /^\d+$/.test(raw)) setTareCountInput(raw);
  }

  const stepTare = (delta: number) => () =>
    setTareCountInput(String(Math.max(0, tareCount + delta)));

  return (
    <div className="rounded-xl bg-card ring-1 ring-foreground/10">
      <div className="border-b border-border/70 p-4">
        <Eyebrow className="mb-2">{t('reweigh.step1')}</Eyebrow>
        <div className="flex flex-wrap items-start gap-3">
          <Field name="rw-gross" label={t('reweigh.gross')} required>
            {(a11y) => (
              <div className="relative w-[200px]">
                <TextInput
                  {...a11y}
                  value={gross}
                  onChange={(e) => setGross(e.target.value)}
                  onBlur={() => setGross((current) => (current === '' ? current : normalizeAmount(current)))}
                  inputMode="decimal"
                  placeholder="0.00"
                  className="h-14 pr-12 font-mono text-2xl font-semibold"
                />
                <span className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 font-mono text-sm text-muted-foreground">
                  {t('reweigh.unit')}
                </span>
              </div>
            )}
          </Field>
          <Field name="rw-pallet" label={t('reweigh.pallet')}>
            {(a11y) => (
              <div className="relative w-[132px]">
                <TextInput
                  {...a11y}
                  value={pallet}
                  onChange={(e) => setPallet(e.target.value)}
                  onBlur={() =>
                    setPallet((current) => (current === '' ? current : normalizeAmount(current)))
                  }
                  inputMode="decimal"
                  placeholder="0.0"
                  className="h-14 pr-9 font-mono text-lg font-semibold"
                />
                <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 font-mono text-xs text-muted-foreground">
                  {t('reweigh.unit')}
                </span>
              </div>
            )}
          </Field>
        </div>
        {grossWarningText ? <FieldWarning text={grossWarningText} /> : null}
      </div>

      <div className="border-b border-border/70 p-4">
        <Eyebrow className="mb-2">{t('reweigh.step2')}</Eyebrow>
        <div className="flex flex-wrap items-center gap-2">
          <SelectField
            aria-label={t('reweigh.tareType')}
            className="h-10 w-[168px]"
            value={effectiveTareId ?? ''}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => setTareId(e.target.value)}
          >
            {(tareTypes.data ?? []).map((tt) => (
              <option key={tt.id} value={tt.id}>
                {t('reweigh.tareOption', { name: tt.name, weight: formatDecimal(tt.weight_kg, locale) })}
              </option>
            ))}
          </SelectField>
          <div className="flex items-center gap-1 rounded-lg border border-border bg-background p-1">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t('reweigh.crateFewer')}
              onClick={stepTare(-1)}
            >
              <Minus className="size-3.5" />
            </Button>
            <TextInput
              variant="ghost"
              value={tareCountInput}
              onChange={handleTareCountChange}
              inputMode="numeric"
              autoComplete="off"
              aria-label={t('reweigh.crateCount')}
              className="w-12 text-center font-mono text-base font-semibold"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t('reweigh.crateMore')}
              onClick={stepTare(1)}
            >
              <Plus className="size-3.5" />
            </Button>
          </div>
          <span className="font-mono text-sm text-muted-foreground">= {formatKg(tareWeight, locale)}</span>
          {[5, 10, 20].map((n) => (
            <Button
              key={n}
              type="button"
              variant="outline"
              size="sm"
              onClick={stepTare(n)}
            >
              {t('reweigh.crateQuick', { n })}
            </Button>
          ))}
        </div>
        {tareWarningText ? <FieldWarning text={tareWarningText} /> : null}
      </div>

      <div className="border-b border-border/70 p-4">
        <Eyebrow className="mb-2">{t('reweigh.step3')}</Eyebrow>
        <SelectField
          aria-label={t('reweigh.grade')}
          className="w-full max-w-[320px]"
          value={gradeId ?? ''}
          disabled={productGroups.length === 0}
          onChange={(e: ChangeEvent<HTMLSelectElement>) => setGradeId(e.target.value || null)}
        >
          <option value="" disabled hidden>
            {productGroups.length ? t('reweigh.gradePlaceholder') : t('reweigh.gradeEmpty')}
          </option>
          {productGroups.map((group) => (
            <optgroup key={group.product_id} label={group.product_name}>
              {group.grades.map((g) => (
                <option key={g.product_grade_id} value={g.product_grade_id}>
                  {g.product_grade_name}
                </option>
              ))}
            </optgroup>
          ))}
        </SelectField>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3 p-4">
        <div>
          <Eyebrow className="mb-1">{t('reweigh.netEyebrow')}</Eyebrow>
          <div
            data-testid="net-kg"
            className="font-mono text-[34px] leading-none font-semibold tracking-tight text-primary"
          >
            {formatKg(netForDisplay, locale)}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <Button type="button" size="lg" onClick={handleAdd} disabled={Boolean(block)}>
            <Plus className="size-4" />
            {t('reweigh.addLine')}
          </Button>
          {blockCopy ? (
            <span className="max-w-[300px] text-right text-xs text-[var(--amber)]">{blockCopy}</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
