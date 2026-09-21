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
import { toast, toastSuccess } from '@/shared/ui/toast';
import { add, cmp, formatKg, formatUah, sub, sum } from '@/shared/lib/money';
import { formatLongDate, todayIso } from '@/shared/lib/date';
import { useMeQuery } from '@/entities/user';
import { useWorkingPoint } from '@/features/point-scope';
import { usePointOptionsQuery } from '@/entities/collection-point';
import { useCurrentShiftQuery } from '@/entities/shift';
import { useSupplierBalanceQuery, type Supplier } from '@/entities/supplier';
import { usePricedGradesQuery } from '@/entities/product-grade';
import { useTareTypeOptionsQuery } from '@/entities/tare-type';
import { usePointCashForPointQuery } from '@/entities/point-cash';
import { ReceiptDialog } from '@/widgets/receipt';
import { useOpenShiftMutation, CountDrawerDialog } from '@/features/count-shift';
import { useCreateIntakeMutation } from '../api/intakes';
import { apiErrorToFields, type ApiFieldErrors } from '../lib/apiErrorToFields';
import { useIntakePreview } from '../lib/useIntakePreview';
import { suggestedPaid } from '../lib/suggestedPaid';
import { emptyLine, toCreateBody, type IntakeFormValues } from '../model/intakeForm';
import { SupplierSection } from './SupplierSection';
import { LineEditor } from './LineEditor';
import { LinesTable, type CommittedLine } from './LinesTable';
import { TotalsSection } from './TotalsSection';
import { TodayReceipts } from './TodayReceipts';
import { ShiftBanner } from './ShiftBanner';

/** §3 — a UI cap that matches the paper book (4 committed + the draft). */
const MAX_LINES = 5;

/** The draft-line fields `LineEditor` actually renders an error slot for; its
 *  tare block claims every `tare.*` name on top of these. */
const DRAFT_FIELDS = new Set(['gross_kg', 'pallet_kg', 'bonus', 'product_grade_id']);

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
  const { pointId, canPick, setPointId } = useWorkingPoint();
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
    defaultValues: { supplier_id: '', items: [emptyLine('')], paid_amount: '' },
  });
  const { control, register, setValue, handleSubmit, reset } = form;
  const lines = useFieldArray({ control, name: 'items' });
  // `useWatch` rather than `form.watch()`: the latter returns a function the
  // React Compiler cannot memoize safely (it bails out of the whole component).
  const values = useWatch({ control, defaultValue: form.getValues() }) as IntakeFormValues;

  // The tare registry and the priced grades are both network reads, so the
  // first draft is built before either default is knowable; seed them the
  // moment each arrives. Every LATER line keeps `''` for its grade (the mock
  // pre-selects only the first) and gets its tare default from `emptyLine`
  // directly.
  useEffect(() => {
    if (defaultTareTypeId !== '' && form.getValues('items.0.tare.0.tare_type_id') === '') {
      setValue('items.0.tare.0.tare_type_id', defaultTareTypeId);
    }
    if (grades.data.length > 0 && form.getValues('items.0.product_grade_id') === '') {
      setValue('items.0.product_grade_id', grades.data[0].id);
    }
  }, [defaultTareTypeId, form, setValue, grades.data]);

  // The picker hands over the whole row when it is chosen; the form only
  // ever carries the id (`supplier_id`) that the document needs, so the two
  // are kept in sync from here rather than the picker re-reading by id.
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const [openDialogOpen, setOpenDialogOpen] = useState(false);
  // Bumped on every open so the dialog remounts with fresh RHF defaults and no
  // banner from the refusal before it — the convention `ReopenShiftDialog`
  // (pages/day) documents.
  const [openDialogInstance, setOpenDialogInstance] = useState(0);
  const [submitFailure, setSubmitFailure] = useState<{ at: string; errors: ApiFieldErrors } | null>(
    null,
  );
  // «Видано готівкою» AUTO-SUGGESTS the cash-capped total until the operator
  // types in it themselves (`suggestedPaid`, below) — this is the only thing
  // that switches it over to what RHF actually holds.
  const [paidTouched, setPaidTouched] = useState(false);

  const shiftOpen = shift.data != null;
  const balance = useSupplierBalanceQuery(values.supplier_id || null);
  const debt = balance.data?.debt ?? null;
  const preview = useIntakePreview(values, bodyPointId, { enabled: shiftOpen });
  // The drawer for berries — only read once a shift is open, same gate the
  // preview itself uses; `pointId` (not `bodyPointId`) because an operator's
  // OWN point still has cash to read even though their token, not this id,
  // is what the intake body sends.
  const pointCash = usePointCashForPointQuery(pointId, undefined, shiftOpen);
  const cash = pointCash.data?.cash ?? null;

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
  // Which field names actually have somewhere to render on this screen. Only
  // the DRAFT line is editable, so an error on a committed line — or on a
  // draft field nothing draws — would otherwise disable the submit in silence.
  const draftPrefix = `items.${draftIndex}.`;
  const isFieldRendered = (field: string) => {
    // «Видано готівкою» — always on screen once the form is, unlike a draft
    // line's fields (only the trailing one is ever editable).
    if (field === 'paid_amount') return true;
    if (!field.startsWith(draftPrefix)) return false;
    const suffix = field.slice(draftPrefix.length);
    return DRAFT_FIELDS.has(suffix) || suffix.startsWith('tare.');
  };
  const hasUnplaceableError = (serverErrors?.fieldErrors ?? []).some(
    (e) => !isFieldRendered(e.field),
  );
  const formErrorKey =
    serverErrors?.formErrorKey ?? (hasUnplaceableError ? 'reception.errors.lineRefused' : null);

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
  // The preview's items only line up with the FORM's items 1:1 the moment
  // both describe the same number of lines — read by index otherwise (e.g.
  // right after `remove(0)`, before the next response) and a surviving row
  // is relabelled instantly while its numbers are still the DELETED line's.
  // Falling back to `null` for one cycle shows «…» instead of a wrong number.
  const rowsPreview =
    preview.preview?.items.length === lines.fields.length ? preview.preview : null;
  const committed: CommittedLine[] = lines.fields.slice(0, draftIndex).map((field, index) => ({
    key: field.id,
    gradeLabel: gradeLabel(values.items[index]?.product_grade_id ?? ''),
    item: rowsPreview?.items[index] ?? null,
  }));

  // ONLY a settled preview may become a number on screen or a submitted body.
  // `!isPending` is not enough: inside the 250ms debounce window nothing is in
  // flight and the previous preview still stands, and it answers a form the
  // operator has already changed.
  const settled = preview.isSettled ? preview.preview : null;
  const accrued = settled?.amount ?? null;
  const netKg = settled ? sum(settled.items.map((i) => i.net_kg)) : null;
  // `netKg`/`lineCount` above describe the WHOLE form, draft included — right
  // for `TotalsSection`'s submit button, wrong for the table's own counter,
  // which sits over `committed` rows only (`rows.length` there). Summed off
  // `rowsPreview` (already scoped to the draft-excluded slice `committed`
  // reads from) rather than `settled`, so the counter stays in step with the
  // same rows the table renders even in the debounce window `isSettled`
  // excludes.
  const committedNetKg = rowsPreview
    ? sum(rowsPreview.items.slice(0, draftIndex).map((i) => i.net_kg))
    : null;
  const isPreviewing = !preview.isSettled && (preview.isPending || preview.preview !== null);
  const canSubmit = shiftOpen && values.supplier_id !== '' && settled !== null && !hasServerError;

  // «Видано готівкою» auto-suggests the cash-capped total (§2.1 ⑥) until the
  // operator types into it themselves — `paidTouched` is the one switch, and
  // this is derived fresh every render rather than pushed into RHF by an
  // effect (no `setState` during render, no stale suggestion one tick behind
  // a fresh preview).
  const suggested = suggestedPaid(accrued, debt, cash);
  const paidShown = paidTouched ? values.paid_amount : suggested;
  const onPaidChange = (v: string) => {
    setPaidTouched(true);
    setValue('paid_amount', v, { shouldDirty: true });
  };

  const onSubmit = handleSubmit(async (formValues) => {
    setSubmitFailure(null);
    // Captured BEFORE the write: a successful create invalidates
    // `supplierBalances`, which can refetch before the toast below reads
    // `debt` — this is what the supplier owed WALKING IN, not after.
    const carriedIn = debt !== null && cmp(debt, '0') === 1 ? debt : '0.00';
    try {
      const created = await create.mutateAsync(
        toCreateBody({ ...formValues, paid_amount: paidShown }, bodyPointId),
      );
      const remainderOf = sub(add(created.amount, carriedIn), created.paid_amount);
      toastSuccess(
        t('reception.toast.accepted', {
          kg: formatKg(sum(created.items.map((item) => item.net_kg)), locale),
          uah: formatUah(created.amount, locale),
        }),
        {
          description:
            cmp(remainderOf, '0') === 1
              ? t('reception.toast.remainder', { uah: formatUah(remainderOf, locale) })
              : t('reception.toast.settled'),
        },
      );
      setReceiptId(created.id);
      // The mock resets everything, supplier included: the next person in the
      // queue is a new visit, not an edit of this one.
      reset({ supplier_id: '', items: [emptyLine(defaultTareTypeId)], paid_amount: '' });
      setSupplier(null);
      setPaidTouched(false);
    } catch (error) {
      setSubmitFailure({
        at: snapshot,
        errors: apiErrorToFields(error, formValues.items.length),
      });
    }
  });

  const handleOpenShift = () => {
    setOpenDialogInstance((n) => n + 1);
    setOpenDialogOpen(true);
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
        {/* A failed read and «no shift» are the same `null` in the data, and an
            «Open shift» button on the first one lets an operator open a shift
            that is already open. */}
        {shift.isError ? (
          <p role="alert" className="mb-5 text-sm text-destructive">
            {t('common.somethingWentWrong')}
          </p>
        ) : !shift.isPending && !shiftOpen ? (
          <ShiftBanner
            canOpen={me?.role === 'point_operator'}
            isOpening={openShift.isPending}
            onOpen={handleOpenShift}
          />
        ) : null}

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,1fr)]">
          <form onSubmit={(e) => void onSubmit(e)} noValidate>
            <Card>
              <SupplierSection
                pointId={pointId}
                ownerMode={me?.role === 'network_owner'}
                supplier={supplier}
                onChange={(s) => {
                  // Lines belong to the SUPPLIER who brought them — switching
                  // mid-visit (an operator picked the wrong row) leaves the
                  // committed lines behind rather than filing them under
                  // whoever is picked next. A draft-only form (one empty
                  // line, nothing committed) has nothing to lose, so it is
                  // left alone.
                  if (lines.fields.length > 1) {
                    reset({
                      supplier_id: s.id,
                      items: [emptyLine(defaultTareTypeId)],
                      paid_amount: '',
                    });
                    toast(t('reception.toast.linesCleared'));
                  } else {
                    setValue('supplier_id', s.id, { shouldDirty: true });
                  }
                  setSupplier(s);
                  setPaidTouched(false);
                }}
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
                isPreviewPending={!preview.isSettled}
                errorAt={errorAt}
                disabled={!shiftOpen}
                onRemoveDraft={() => lines.remove(draftIndex)}
              />
              <LinesTable
                rows={committed}
                // A line is committed only once the server has PRICED IT AS IT
                // STANDS: the preview covers every line, so committing one the
                // server has not settled on (or has just refused) would take
                // the whole form's numbers down with it.
                canAdd={draftReady && !atCap && shiftOpen && settled !== null && !hasServerError}
                atCap={atCap}
                disabled={!shiftOpen}
                lineCount={committed.length}
                netKg={committed.length > 0 ? committedNetKg : null}
                onAdd={() => lines.append(emptyLine(defaultTareTypeId))}
                onRemove={(index) => lines.remove(index)}
              />
              <TotalsSection
                accrued={accrued}
                netKg={netKg}
                lineCount={settled?.items.length ?? lines.fields.length}
                debt={debt}
                cash={cash}
                paid={paidShown}
                onPaidChange={onPaidChange}
                paidError={errorAt('paid_amount')}
                disabled={!canSubmit}
                isPreviewing={isPreviewing}
                isSubmitting={create.isPending}
                formErrorKey={formErrorKey}
                showDraftHint={draftIndex > 0 && !draftReady}
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
      <CountDrawerDialog
        key={openDialogInstance}
        mode="open"
        open={openDialogOpen}
        onClose={() => setOpenDialogOpen(false)}
        onConfirm={async (counted_amount) => {
          await openShift.mutateAsync({ counted_amount });
          toast.success(t('reception.toast.opened'));
          setOpenDialogOpen(false);
        }}
      />
      <ReceiptDialog
        key={receiptId}
        intakeId={receiptId}
        open={receiptId !== null}
        onClose={() => setReceiptId(null)}
      />
    </>
  );
}
