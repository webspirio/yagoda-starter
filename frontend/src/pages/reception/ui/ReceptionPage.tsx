import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useFieldArray, useForm, useWatch } from 'react-hook-form';
import { PageHeader } from '@/shared/ui/page-header';
import { Card } from '@/shared/ui/card';
import { Button } from '@/shared/ui/button';
import { SelectField } from '@/shared/ui/select-field';
import { EmptyState } from '@/shared/ui/empty-state';
import { Spinner } from '@/shared/ui/spinner';
import { toast, toastSuccess } from '@/shared/ui/toast';
import { add, cmp, formatKg, formatUah, parseDecimal, sub, sum } from '@/shared/lib/money';
import { formatLongDate, todayIso } from '@/shared/lib/date';
import { useMeQuery } from '@/entities/user';
import { useWorkingPoint } from '@/features/point-scope';
import { usePointOptionsQuery } from '@/entities/collection-point';
import { useCurrentShiftQuery } from '@/entities/shift';
import { useSupplierBalanceQuery, type Supplier } from '@/entities/supplier';
import { usePricedGradesQuery } from '@/entities/product-grade';
import { useTareTypeOptionsQuery } from '@/entities/tare-type';
import { usePointCashForPointQuery } from '@/entities/point-cash';
import { ReceiptDialog, useReceiptOpener } from '@/widgets/receipt';
import { useOpenShiftMutation, CountDrawerDialog, OpenShiftAlert } from '@/features/count-shift';
import { ShiftCountResult, type ShiftCountResultFor } from '@/widgets/count-result';
import type { SupplierPickerHandle } from '@/features/pick-supplier';
import { useCreateIntakeMutation } from '../api/intakes';
import { apiErrorToFields, type ApiFieldErrors } from '../lib/apiErrorToFields';
import { isOwnFormEvent } from '../lib/formEventGuards';
import { useIntakePreview } from '../lib/useIntakePreview';
import { suggestedPaid } from '../lib/suggestedPaid';
import {
  crateTareUnits,
  emptyLine,
  parseCount,
  toCreateBody,
  type IntakeFormValues,
} from '../model/intakeForm';
import { SupplierSection } from './SupplierSection';
import { LineEditor } from './LineEditor';
import { LinesTable, type CommittedLine } from './LinesTable';
import { TotalsSection } from './TotalsSection';
import { ReturnedCratesField } from './ReturnedCratesField';
import { ConfirmRefundDialog } from './ConfirmRefundDialog';
import { PointStrip } from './PointStrip';

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
  const navigate = useNavigate();
  const locale = i18n.resolvedLanguage ?? 'uk';
  const { data: me } = useMeQuery();
  const isOwner = me?.role === 'network_owner';
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
    defaultValues: { supplier_id: '', items: [emptyLine('')], paid_amount: '', returned_crates: '' },
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
  // Read only inside event handlers (the Enter guard below, and after a
  // successful submit) — never during render, which the React Compiler bans.
  const pickerRef = useRef<SupplierPickerHandle>(null);
  const receipt = useReceiptOpener();
  const { openReceipt } = receipt;
  const [openDialogOpen, setOpenDialogOpen] = useState(false);
  // Bumped on every open so the dialog remounts with fresh RHF defaults and no
  // banner from the refusal before it — the convention `ReopenShiftDialog`
  // (pages/point-cash) follows too.
  const [openDialogInstance, setOpenDialogInstance] = useState(0);
  // A banner close shows its result and the note form, not a bare toast (S2).
  const [staleResult, setStaleResult] = useState<ShiftCountResultFor | null>(null);
  const [submitFailure, setSubmitFailure] = useState<{ at: string; errors: ApiFieldErrors } | null>(
    null,
  );
  // «Видано готівкою» AUTO-SUGGESTS the cash-capped total until the operator
  // types in it themselves (`suggestedPaid`, below) — this is the only thing
  // that switches it over to what RHF actually holds.
  const [paidTouched, setPaidTouched] = useState(false);
  // #72 — the «Видано готівкою» text «Прийняти» last refused. The refusal is
  // shown only while the field still holds exactly that text, so it cannot
  // outlive it (a re-picked supplier or the post-save reset change
  // `paidShown`), and any edit clears it outright (`onPaidChange`).
  const [paidRefused, setPaidRefused] = useState<string | null>(null);
  // Bumped on every supplier pick — even a re-pick of the same row, which
  // `reset()` above may have just emptied — so «З них наших ящиків» remounts
  // and pre-fills afresh.
  const [supplierPick, setSupplierPick] = useState(0);
  // A submit held back for «Видайте людині дві суми» (`ConfirmRefundDialog`):
  // the validated form values, waiting on the operator's confirmation.
  const [pendingSubmit, setPendingSubmit] = useState<IntakeFormValues | null>(null);

  const shiftOpen = shift.data != null;
  const balance = useSupplierBalanceQuery(values.supplier_id || null);
  const debt = balance.data?.debt ?? null;
  const preview = useIntakePreview(values, bodyPointId, { enabled: shiftOpen });
  // The drawer for berries — only read once a shift is open, same gate the
  // preview itself uses; `pointId` (not `bodyPointId`) because an operator's
  // OWN point still has cash to read even though their token, not this id,
  // is what the intake body sends. `PointStrip` reads this SAME query
  // key ungated, so the shared cache may end up populated even while this
  // gate is closed — harmless, since every consumer of `cash` below is
  // itself disabled while the shift is closed.
  const pointCash = usePointCashForPointQuery(pointId, undefined, shiftOpen);
  // ONE derived value, not two independent reads: TanStack keeps the last
  // successful `data` when a REFETCH fails (typically right after a submit
  // invalidates this key), so `data` and `isError` can both be set. The
  // disclaimer wins — a figure known to be stale is not a cap.
  const cash = pointCash.isError ? null : (pointCash.data?.cash ?? null);

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
  const formErrorParams = serverErrors?.formErrorParams;
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
  // Each committed row reads the numbers the server gave a line with exactly
  // its content (`rowItems`) — so an empty draft below it never blanks it
  // (#213), and a removed line's numbers never land on its neighbour.
  const committed: CommittedLine[] = lines.fields.slice(0, draftIndex).map((field, index) => ({
    key: field.id,
    gradeLabel: gradeLabel(values.items[index]?.product_grade_id ?? ''),
    item: preview.rowItems[index] ?? null,
  }));

  // ONLY a settled preview may become a number on screen or a submitted body.
  // `!isPending` is not enough: inside the 250ms debounce window nothing is in
  // flight and the previous preview still stands, and it answers a form the
  // operator has already changed.
  const settled = preview.isSettled ? preview.preview : null;
  const accrued = settled?.amount ?? null;
  const netKg = settled ? sum(settled.items.map((i) => i.net_kg)) : null;
  // The table's own counter covers committed rows only, unlike `netKg` above,
  // and is withheld until every one of them is priced.
  const committedItems = committed.map((row) => row.item);
  const committedNetKg = committedItems.every((item) => item !== null)
    ? sum(committedItems.map((item) => item.net_kg))
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
    // Belt to the equality check below: a new edit is not the refused submit,
    // so retyping the same text does not bring the refusal back mid-keystroke.
    setPaidRefused(null);
    setValue('paid_amount', v, { shouldDirty: true });
  };

  // A plain closure, not wrapped in `handleSubmit()` here: `handleSubmit`
  // is called instead from inside the `<form>`'s own `onSubmit` prop below,
  // so `pickerRef.current` is only ever read from inside an actual event
  // handler — never eagerly, while the component renders (React Compiler
  // lint bans a ref read reachable during render).
  const submitIntake = async (formValues: IntakeFormValues) => {
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
          // The server ships the sum already (`net_kg` on the document
          // header) — TodayReceipts' own header comment says a row is READ,
          // not recomputed; re-summing `items[].net_kg` here duplicated that
          // arithmetic client-side for no reason (M3).
          kg: formatKg(created.net_kg, locale),
          uah: formatUah(created.amount, locale),
        }),
        {
          description:
            cmp(remainderOf, '0') === 1
              ? t('reception.toast.remainder', { uah: formatUah(remainderOf, locale) })
              : t('reception.toast.settled'),
        },
      );
      openReceipt(created.id);
      // The mock resets everything, supplier included: the next person in the
      // queue is a new visit, not an edit of this one.
      reset({
        supplier_id: '',
        items: [emptyLine(defaultTareTypeId)],
        paid_amount: '',
        returned_crates: '',
      });
      setSupplier(null);
      setPaidTouched(false);
      // The next person in the queue starts where the operator's hands
      // already are — back on the supplier picker, not the mouse.
      pickerRef.current?.focus();
    } catch (error) {
      setSubmitFailure({
        at: snapshot,
        errors: apiErrorToFields(error, formValues.items.length),
      });
    }
  };

  // #114 — «Каса точки» for the day a shift was left open on (#221: that
  // day's documents and close live there now). An operator's point comes from
  // their token, so only the owner's has to ride in the link or that screen
  // opens on whichever point it remembers.
  const goToPointCash = (businessDate: string) => {
    const params = new URLSearchParams({ date: businessDate });
    if (canPick && pointId !== null) params.set('point', pointId);
    void navigate(`/point-cash?${params.toString()}`);
  };

  // Every receipt that returns our crates passes through `ConfirmRefundDialog`,
  // which decides on the server's FRESH split whether there is a deposit to
  // hand over — and confirms straight through when there is none.
  const requestSubmit = (formValues: IntakeFormValues) => {
    // #72 — a malformed «Видано готівкою» is never sent (`toCreateBody`), so
    // going ahead would record the receipt WITHOUT the payout the operator
    // typed. The field already names the refusal; the submit agrees with it.
    // Enter submits WITHOUT moving focus, and the field holds its own format
    // line back while focused — so the refusal is said through `paidError`,
    // which shows regardless of focus, and the caret stays where the operator
    // left it (Enter is how they move on the scale's numeric pad).
    if (paidShown.trim() !== '' && parseDecimal(paidShown) === null) {
      setPaidRefused(paidShown);
      return;
    }
    if (parseCount(formValues.returned_crates) > 0) setPendingSubmit(formValues);
    else void submitIntake(formValues);
  };
  // The body the pending submit WOULD send — the same `toCreateBody` the write
  // uses, so the dialog names exactly the berry payout and crates that go out.
  const pendingBody =
    pendingSubmit !== null
      ? toCreateBody({ ...pendingSubmit, paid_amount: paidShown }, bodyPointId)
      : null;

  const handleOpenShift = () => {
    setOpenDialogInstance((n) => n + 1);
    setOpenDialogOpen(true);
  };

  const pointName = (points ?? []).find((p) => p.id === pointId)?.name ?? '';
  // «Наділ» for `PointStrip`'s crates cell — read off the same
  // `usePointOptionsQuery()` list `pages/crates` resolves it from, rather
  // than a second network read for one field.
  const targetCrates = (points ?? []).find((p) => p.id === pointId)?.target_crates ?? null;
  const actions = (
    <>
      {canPick ? (
        <SelectField
          aria-label={t('reception.pickPoint')}
          value={pointId ?? ''}
          onChange={(e) => setPointId(e.target.value)}
          className="w-48"
        >
          {/* A deactivated point reached by `?point=` is not in `points`
              (active only) — without its own entry the select would show
              the first active point over this point's shift and receipts. */}
          {pointId && points && !points.some((p) => p.id === pointId) ? (
            <option value={pointId}>{t('common.inactivePoint')}</option>
          ) : null}
          {(points ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </SelectField>
      ) : null}
      {/* Owner only (#221): /prices is the owner's screen, and the operator
          already sees each grade's price on its option in the form below. */}
      {isOwner ? (
        <Button variant="outline" asChild>
          <Link to="/prices">{t('reception.toPrices')}</Link>
        </Button>
      ) : null}
      <Button variant="secondary" asChild>
        <Link to="/point-cash">{t('reception.toPointCash')}</Link>
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
      <EmptyState
        title={t('reception.noPrices.title')}
        hint={t('reception.noPrices.hint')}
        action={
          // Only the owner can set a price — and since #221 only the owner
          // can open `/prices` at all — so this call to action is theirs alone.
          isOwner ? (
            <Button asChild>
              <Link to="/prices">{t('reception.noPrices.action')}</Link>
            </Button>
          ) : undefined
        }
      />
    ) : (
      <>
        {/* A failed read and «no shift» are the same `null` in the data; the
            strip tells them apart, so an «Open shift» button never shows
            on the first one. */}
        <PointStrip
          pointId={pointId}
          shift={
            shift.isError
              ? { status: 'error' }
              : shift.isPending
                ? { status: 'pending' }
                : shiftOpen && shift.data
                  ? { status: 'open', shift: shift.data }
                  : { status: 'none' }
          }
          isOwner={isOwner}
          canOpen={me?.role === 'point_operator'}
          isOpening={openShift.isPending}
          onOpenShift={handleOpenShift}
          targetCrates={targetCrates}
          onOpenReceipt={openReceipt}
        />

        {/* An open shift that is NOT today's (#114). A SIBLING of the intake
            form, never a child: its count dialog is portaled but stays a REACT
            descendant of whatever renders it, and React bubbles `submit` along
            the fiber tree — inside the form, confirming a close would also
            post the receipt. Whether the form should be blocked while the open
            shift is stale is a separate question this deliberately leaves
            alone: there IS an open shift, so `shiftOpen` is unchanged. */}
        <OpenShiftAlert
          pointId={pointId}
          viewedDate={todayIso()}
          onGoToDate={goToPointCash}
          onClosed={(id) => setStaleResult({ mode: 'close', shiftId: id })}
        />

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,1fr)]">
          <form
            onSubmit={(e) => {
              // React bubbles `submit` along the fiber tree, not the DOM: the
              // inline supplier dialog (`SupplierPicker` → `SupplierFormDialog`)
              // is portaled to `document.body` by `shared/ui/dialog.tsx`, but
              // is still a REACT descendant of this form, so without this
              // guard its own submit would reach `handleSubmit(requestSubmit)`
              // — a real `POST /intakes` nobody pressed «Прийняти» for.
              if (!isOwnFormEvent(e)) return;
              void handleSubmit(requestSubmit)(e);
            }}
            // Enter is how an operator moves between fields on the scale's
            // numeric pad; it must never fire a submit the form isn't ready
            // for. Scoped to text inputs only, so it never swallows Enter
            // inside the grade `<select>` or on a button. Same portal guard as
            // `onSubmit` above — the dialog's own Enter keystrokes must not be
            // swallowed by a guard meant for THIS form.
            onKeyDown={(e) => {
              if (!isOwnFormEvent(e)) return;
              if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT' && !canSubmit) {
                e.preventDefault();
              }
            }}
            noValidate
          >
            <Card>
              <SupplierSection
                pointId={pointId}
                ownerMode={isOwner}
                supplier={supplier}
                pickerRef={pickerRef}
                autoFocus={supplier === null}
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
                      returned_crates: '',
                    });
                    toast(t('reception.toast.linesCleared'));
                  } else {
                    setValue('supplier_id', s.id, { shouldDirty: true });
                  }
                  setSupplier(s);
                  setPaidTouched(false);
                  setSupplierPick((n) => n + 1);
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
                credit={debt !== null && cmp(debt, '0') === -1 ? sub('0', debt) : null}
                cash={cash}
                cashUnavailable={pointCash.isError}
                paid={paidShown}
                onPaidChange={onPaidChange}
                paidError={
                  errorAt('paid_amount') ??
                  (paidRefused !== null && paidShown === paidRefused ? 'errors.decimalFormat' : null)
                }
                disabled={!canSubmit}
                isPreviewing={isPreviewing}
                isSubmitting={create.isPending}
                formErrorKey={formErrorKey}
                formErrorParams={formErrorParams}
                showDraftHint={draftIndex > 0 && !draftReady}
                // Keyed by the supplier pick: a new pick remounts it, so the
                // pre-fill follows the ceiling again until the operator types.
                crateReturn={
                  <ReturnedCratesField
                    key={`${values.supplier_id}:${supplierPick}`}
                    supplierId={values.supplier_id || null}
                    pointId={bodyPointId ?? undefined}
                    crateTareUnits={crateTareUnits(values.items, tareTypes.data ?? [])}
                    value={values.returned_crates}
                    onChange={(v) => setValue('returned_crates', v, { shouldDirty: true })}
                    disabled={!shiftOpen}
                  />
                }
              />
            </Card>
          </form>

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
        // Відкриття, а не закриття — §6.8's бій тут не питають, і читати
        // «з ягодою» нема для якої зміни.
        shiftId={null}
        open={openDialogOpen}
        onClose={() => setOpenDialogOpen(false)}
        onConfirm={async (counted_amount) => {
          await openShift.mutateAsync({ counted_amount });
          toast.success(t('reception.toast.opened'));
          setOpenDialogOpen(false);
        }}
      />
      {pendingSubmit !== null && pendingBody !== null ? (
        <ConfirmRefundDialog
          supplierId={pendingSubmit.supplier_id}
          pointId={bodyPointId ?? undefined}
          units={pendingBody.returned_crates ?? 0}
          paid={pendingBody.paid_amount ?? null}
          onConfirm={() => {
            setPendingSubmit(null);
            void submitIntake(pendingSubmit);
          }}
          onCancel={() => setPendingSubmit(null)}
        />
      ) : null}
      <ReceiptDialog
        key={receipt.receiptId}
        intakeId={receipt.receiptId}
        open={receipt.open}
        startWithVoid={receipt.startWithVoid}
        onClose={receipt.clear}
      />
      <ShiftCountResult result={staleResult} onClose={() => setStaleResult(null)} />
    </>
  );
}
