import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useFieldArray, useForm, useWatch } from 'react-hook-form';
import { PageHeader } from '@/shared/ui/page-header';
import { Card } from '@/shared/ui/card';
import { Button } from '@/shared/ui/button';
import { SelectField } from '@/shared/ui/select-field';
import { EmptyState } from '@/shared/ui/empty-state';
import { Spinner } from '@/shared/ui/spinner';
import { toast } from '@/shared/ui/toast';
import { formatKg, formatUah, sum } from '@/shared/lib/money';
import { formatLongDate, todayIso } from '@/shared/lib/date';
import { useMeQuery, usePointScope } from '@/entities/user';
import { usePointOptionsQuery } from '@/entities/collection-point';
import { useCurrentShiftQuery } from '@/entities/shift';
import { useSupplierBalanceQuery } from '@/entities/supplier';
import { usePricedGradesQuery } from '@/entities/product-grade';
import { useTareTypeOptionsQuery } from '@/entities/tare-type';
import { ReceiptDialog } from '@/widgets/receipt';
import { useCreateIntakeMutation, useOpenShiftMutation } from '../api/intakes';
import { apiErrorToFields, type ApiFieldErrors } from '../lib/apiErrorToFields';
import { isValidCode } from '../lib/receiptCode';
import { useIntakePreview } from '../lib/useIntakePreview';
import { emptyLine, toCreateBody, type IntakeFormValues } from '../model/intakeForm';
import { SupplierSection } from './SupplierSection';
import { LineEditor } from './LineEditor';
import { LinesTable, type CommittedLine } from './LinesTable';
import { TotalsSection } from './TotalsSection';
import { TodayReceipts } from './TodayReceipts';
import { ShiftBanner } from './ShiftBanner';

/** §3 — a UI cap that matches the paper book (4 committed + the draft). */
const MAX_LINES = 5;

/**
 * «Прийомка ягоди» — one supplier, up to five lines, one document.
 *
 * NOTHING on this screen computes money. Every weight and amount shown comes
 * from `POST /intakes/preview` (`useIntakePreview`), which runs the server's own
 * `buildIntake()`; the form sends back exactly what the operator typed, and the
 * saved receipt is read from the document the server wrote. The only arithmetic
 * here is DISPLAY totalling through `shared/lib/money`, in integer kopiykas.
 */
export function ReceptionPage() {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? 'uk';
  const { data: me } = useMeQuery();
  const { pointId, canPick, setPointId } = usePointScope();
  const { data: points } = usePointOptionsQuery();

  const shift = useCurrentShiftQuery(pointId);
  const tareTypes = useTareTypeOptionsQuery();
  const grades = usePricedGradesQuery(pointId);
  const create = useCreateIntakeMutation();
  const openShift = useOpenShiftMutation();

  // An operator's point is resolved server-side from their token, so it is
  // OMITTED from the body; the owner's picked point has to be sent.
  const bodyPointId = canPick ? pointId : null;
  // The mock's default: berries arrive in crates, so a fresh line starts on the
  // first crate type and only a deliberate change makes it anything else.
  const defaultTareTypeId =
    (tareTypes.data ?? []).find((type) => type.is_crate)?.id ?? tareTypes.data?.[0]?.id ?? '';

  const form = useForm<IntakeFormValues>({
    defaultValues: { code: '', supplier_id: '', items: [emptyLine('')] },
  });
  const { control, register, setValue, handleSubmit, reset } = form;
  const lines = useFieldArray({ control, name: 'items' });
  // `useWatch` rather than `form.watch()`: the latter returns a function the
  // React Compiler cannot memoize safely (it bails out of the whole component).
  const values = useWatch({ control, defaultValue: form.getValues() }) as IntakeFormValues;

  // The tare registry is a network read, so the first draft is built before its
  // default is knowable; seed it the moment it arrives. Every LATER line gets
  // the id passed to `emptyLine` directly.
  useEffect(() => {
    if (defaultTareTypeId === '') return;
    if (form.getValues('items.0.tare.0.tare_type_id') === '') {
      setValue('items.0.tare.0.tare_type_id', defaultTareTypeId);
    }
  }, [defaultTareTypeId, form, setValue]);

  const [receiptId, setReceiptId] = useState<string | null>(null);
  const [submitFailure, setSubmitFailure] = useState<{ at: string; errors: ApiFieldErrors } | null>(
    null,
  );

  const shiftOpen = shift.data != null;
  const balance = useSupplierBalanceQuery(values.supplier_id || null);
  const debt = balance.data?.debt ?? null;
  const preview = useIntakePreview(values, bodyPointId, { enabled: shiftOpen });

  // A refusal from `POST /intakes` stands only while the form still says what it
  // said when the server refused — the next keystroke hands the question back to
  // the live preview. Derived, so no effect has to clear it.
  const snapshot = JSON.stringify(values);
  const serverErrors = submitFailure?.at === snapshot ? submitFailure.errors : preview.error;
  const errorAt = (field: string) =>
    serverErrors?.fieldErrors.find((e) => e.field === field)?.messageKey ?? null;
  const hasServerError =
    serverErrors !== null &&
    (serverErrors.fieldErrors.length > 0 || serverErrors.formErrorKey !== null);

  const draftIndex = lines.fields.length - 1;
  const draft = values.items[draftIndex];
  // What makes a line worth COMMITTING: a grade, a weight and some tare. The
  // narrower question of whether the form is worth previewing belongs to
  // `useIntakePreview`, which asks it of every line at once.
  const draftReady =
    draft !== undefined &&
    draft.product_grade_id !== '' &&
    draft.gross_kg.trim() !== '' &&
    draft.tare.some((row) => Number.parseInt(row.units, 10) >= 1);
  const atCap = lines.fields.length >= MAX_LINES;

  const gradeLabel = (gradeId: string) => {
    const grade = grades.data.find((g) => g.id === gradeId);
    return grade ? `${grade.productName} · ${grade.name}` : '—';
  };
  const committed: CommittedLine[] = lines.fields.slice(0, draftIndex).map((field, index) => ({
    key: field.id,
    gradeLabel: gradeLabel(values.items[index]?.product_grade_id ?? ''),
    item: preview.preview?.items[index] ?? null,
  }));

  const accrued = preview.preview?.amount ?? null;
  const netKg = preview.preview ? sum(preview.preview.items.map((i) => i.net_kg)) : null;
  const codeError =
    errorAt('code') ??
    (values.code !== '' && !isValidCode(values.code) ? 'reception.errors.codeFormat' : null);
  const canSubmit =
    shiftOpen &&
    values.supplier_id !== '' &&
    isValidCode(values.code) &&
    !preview.isPending &&
    preview.preview !== null &&
    !hasServerError;

  const onSubmit = handleSubmit(async (formValues) => {
    setSubmitFailure(null);
    try {
      const created = await create.mutateAsync(toCreateBody(formValues, bodyPointId));
      toast.success(
        t('reception.toast.accepted', {
          kg: formatKg(sum(created.items.map((item) => item.net_kg)), locale),
          uah: formatUah(created.amount, locale),
        }),
      );
      setReceiptId(created.id);
      // The mock resets everything, supplier included: the next person in the
      // queue is a new visit, not an edit of this one.
      reset({ code: '', supplier_id: '', items: [emptyLine(defaultTareTypeId)] });
    } catch (error) {
      setSubmitFailure({
        at: snapshot,
        errors: apiErrorToFields(error, formValues.items.length),
      });
    }
  });

  const handleOpenShift = async () => {
    try {
      await openShift.mutateAsync();
      toast.success(t('reception.toast.opened'));
    } catch {
      toast.error(t('reception.errors.openShiftFailed'));
    }
  };

  const pointName = (points ?? []).find((p) => p.id === pointId)?.name ?? '';
  const actions = (
    <>
      {canPick ? (
        <SelectField
          aria-label={t('reception.pickPoint')}
          value={pointId ?? ''}
          onChange={(e) => setPointId(e.target.value || null)}
          className="w-48"
        >
          <option value="">{t('reception.pickPoint')}</option>
          {(points ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </SelectField>
      ) : null}
      {me?.role === 'network_owner' ? (
        <Button variant="outline" asChild>
          <Link to="/prices">{t('reception.toPrices')}</Link>
        </Button>
      ) : null}
      <Button variant="secondary" asChild>
        <Link to="/day">{t('reception.toDay')}</Link>
      </Button>
    </>
  );

  // The owner has to pick a point before anything is readable; an unpriced
  // point cannot be received on at all (§2.4 needs a `base_price`), so the
  // form is not offered rather than offered and refused.
  const body =
    pointId === null ? (
      <EmptyState title={t('reception.noPoint')} />
    ) : grades.isPending || tareTypes.isPending ? (
      <div className="flex justify-center py-12">
        <Spinner />
      </div>
    ) : grades.data.length === 0 ? (
      <EmptyState title={t('reception.noPrices.title')} hint={t('reception.noPrices.hint')} />
    ) : (
      <>
        {!shift.isPending && !shiftOpen ? (
          <ShiftBanner
            canOpen={me?.role === 'point_operator'}
            isOpening={openShift.isPending}
            onOpen={() => void handleOpenShift()}
          />
        ) : null}

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,1fr)]">
          <form onSubmit={(e) => void onSubmit(e)} noValidate>
            <Card>
              <SupplierSection
                pointId={pointId}
                value={values.supplier_id}
                onChange={(id) => setValue('supplier_id', id, { shouldDirty: true })}
                debt={debt}
                disabled={!shiftOpen}
              />
              <LineEditor
                key={lines.fields[draftIndex]?.id}
                index={draftIndex}
                control={control}
                register={register}
                setValue={setValue}
                grades={grades.data}
                tareTypes={tareTypes.data ?? []}
                previewItem={preview.preview?.items[draftIndex] ?? null}
                isPreviewPending={preview.isPending}
                codeError={codeError}
                errorAt={errorAt}
                disabled={!shiftOpen}
              />
              <LinesTable
                rows={committed}
                // A line is committed only once the server has priced it: the
                // preview covers EVERY line, so a draft the server has not
                // accepted would take the whole form's numbers down with it.
                canAdd={draftReady && !atCap && shiftOpen && preview.preview !== null}
                atCap={atCap}
                onAdd={() => lines.append(emptyLine(defaultTareTypeId))}
                onRemove={(index) => lines.remove(index)}
              />
              <TotalsSection
                accrued={accrued}
                netKg={netKg}
                lineCount={preview.preview?.items.length ?? lines.fields.length}
                debt={debt}
                disabled={!canSubmit}
                isSubmitting={create.isPending}
                formErrorKey={serverErrors?.formErrorKey ?? null}
              />
            </Card>
          </form>

          <TodayReceipts shiftId={shift.data?.id} onOpen={setReceiptId} />
        </div>
      </>
    );

  return (
    <>
      <PageHeader
        eyebrow={t('reception.eyebrow', {
          point: pointName,
          date: formatLongDate(todayIso(), locale),
        })}
        title={t('reception.title')}
        actions={actions}
      />
      {body}
      <ReceiptDialog
        key={receiptId}
        intakeId={receiptId}
        open={receiptId !== null}
        onClose={() => setReceiptId(null)}
      />
    </>
  );
}
