import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useFieldArray, useForm, useWatch } from 'react-hook-form';
import { Card } from '@/shared/ui/card';
import { TraceScope } from '@/shared/ui/trace';
import { HeaderSlot } from '@/shared/ui/header-slot';
import { Eyebrow } from '@/shared/ui/eyebrow';
import { Button } from '@/shared/ui/button';
import { SelectField } from '@/shared/ui/select-field';
import { EmptyState } from '@/shared/ui/empty-state';
import { Spinner } from '@/shared/ui/spinner';
import { toast, toastSuccess } from '@/shared/ui/toast';
import { add, cmp, formatKg, formatUah, parseDecimal, sub } from '@/shared/lib/money';
import { formatLongDate, todayIso } from '@/shared/lib/date';
import { useMeQuery } from '@/entities/user';
import { useWorkingPoint } from '@/features/point-scope';
import { usePointOptionsQuery } from '@/entities/collection-point';
import { useCurrentShiftQuery } from '@/entities/shift';
import { kindHintKey, useSupplierBalanceQuery, type Supplier } from '@/entities/supplier';
import { usePricedGradesQuery } from '@/entities/product-grade';
import { useTareTypeOptionsQuery } from '@/entities/tare-type';
import { usePointCashForPointQuery } from '@/entities/point-cash';
import { ReceiptDialog, useReceiptOpener } from '@/widgets/receipt';
import { useOpenShiftMutation, CountDrawerDialog, OpenShiftAlert } from '@/features/count-shift';
import { ShiftCountResult, type ShiftCountResultFor } from '@/widgets/count-result';
import type { SupplierPickerHandle } from '@/features/pick-supplier';
import { useCreateIntakeMutation } from '../api/intakes';
import { apiErrorToFields, type ApiFieldErrors } from '../lib/apiErrorToFields';
import { nextEntryField } from '../lib/entryFields';
import { isOwnFormEvent } from '../lib/formEventGuards';
import { useIntakePreview } from '../lib/useIntakePreview';
import { suggestedPaid } from '../lib/suggestedPaid';
import {
  crateTareUnits,
  emptyLine,
  hasTare,
  isBlankLine,
  parseCount,
  toCreateBody,
  withoutBlankDraft,
  type IntakeFormValues,
} from '../model/intakeForm';
import { SupplierSection } from './SupplierSection';
import { LineEditor } from './LineEditor';
import { TodayReceipts } from './TodayReceipts';
import { LinesTable, type CommittedLine } from './LinesTable';
import { TotalsSection, type DebtStatus } from './TotalsSection';
import { ReturnedCratesField } from './ReturnedCratesField';
import { ConfirmRefundDialog } from './ConfirmRefundDialog';
import { PointStrip, type StripShift } from './PointStrip';
import { ShiftClosedState, ShiftStatus } from './ShiftState';

/** The today's-receipts card, which the strip's «Сьогодні» scrolls to. */
const TODAY_RECEIPTS_ID = 'today-receipts';

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
    defaultValues: {
      supplier_id: '',
      items: [emptyLine('')],
      paid_amount: '',
      returned_crates: '',
    },
  });
  const { control, register, setValue, handleSubmit, reset } = form;
  const lines = useFieldArray({ control, name: 'items' });
  // `useWatch` rather than `form.watch()`: the latter returns a function the
  // React Compiler cannot memoize safely (it bails out of the whole component).
  const values = useWatch({ control, defaultValue: form.getValues() }) as IntakeFormValues;

  // The tare registry is a network read, so the first draft is built before
  // its default is knowable; seed it the moment it arrives. Every LATER line
  // gets its tare default from `emptyLine` directly. No line ever starts with
  // a product chosen — «Оберіть товар» on every one (client, 24.10): a
  // pre-picked first product is a berry nobody looked at.
  useEffect(() => {
    if (defaultTareTypeId !== '' && form.getValues('items.0.tare.0.tare_type_id') === '') {
      setValue('items.0.tare.0.tare_type_id', defaultTareTypeId);
    }
  }, [defaultTareTypeId, form, setValue]);

  // The picker hands over the whole row when it is chosen; the form only
  // ever carries the id (`supplier_id`) that the document needs, so the two
  // are kept in sync from here rather than the picker re-reading by id.
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  // Read only inside event handlers (the Enter guard below, and after a
  // successful submit) — never during render, which the React Compiler bans.
  const pickerRef = useRef<SupplierPickerHandle>(null);
  // Set when the operator's hands should land on «Товар» of the line on
  // screen next — a supplier just picked, or «Ще позиція» just started a fresh
  // line — and spent by the effect below, after the render that put that
  // line's field there. It has to come after: the picker hands focus back to
  // its own trigger once `onChange` returns.
  const focusProductNext = useRef(false);
  // An entry stop Enter is waiting on — «Ще позиція» for a finished line
  // whose preview is still in flight. The effect below focuses it the render
  // it is enabled; any other key or focus move in the form drops the wait.
  const waitingStop = useRef<HTMLElement | null>(null);
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
  // A failed read and «no shift» are the same `null` in the data; this tells
  // them apart for the header's status and for what stands in for the form.
  const stripShift: StripShift = shift.isError
    ? { status: 'error' }
    : shift.isPending
      ? { status: 'pending' }
      : shiftOpen && shift.data
        ? { status: 'open', shift: shift.data }
        : { status: 'none' };
  const balance = useSupplierBalanceQuery(values.supplier_id || null);
  // B2 (audit 2026-10-24): «Разом» is accrual PLUS this balance, so until the
  // balance is read — or while a stale one is being re-read, e.g. right after
  // a write invalidated it — there is no total, no suggestion and no submit.
  // A failed read is said, never taken for «no balance».
  const debtStatus: DebtStatus =
    values.supplier_id === ''
      ? 'none'
      : balance.isError
        ? 'error'
        : balance.isPending || (balance.isFetching && balance.isStale)
          ? 'pending'
          : 'ready';
  const debt = debtStatus === 'ready' ? (balance.data?.debt ?? null) : null;
  // The receipt as it will be sent: an untouched trailing draft is not a line
  // (`withoutBlankDraft`), so it neither darkens the preview nor blocks submit.
  const outgoing = withoutBlankDraft(values);
  const preview = useIntakePreview(outgoing, bodyPointId, { enabled: shiftOpen });
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
  // No dependency list on purpose: the refs, not a value, say when to act.
  useEffect(() => {
    const waiting = waitingStop.current;
    if (waiting && !(waiting as HTMLButtonElement).disabled) {
      waitingStop.current = null;
      waiting.focus();
    }
    if (!focusProductNext.current) return;
    focusProductNext.current = false;
    document.getElementById(`product-line-${draftIndex}`)?.focus();
  });
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
    hasTare(draft);
  // «Ще позиція» left a fresh draft nobody has touched — ignored, not nagged.
  const draftBlank = draftIndex > 0 && draft !== undefined && isBlankLine(draft);
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
  const isPreviewing = !preview.isSettled && (preview.isPending || preview.preview !== null);

  // «Видано готівкою» auto-suggests the cash-capped total (§2.1 ⑥) until the
  // operator types into it themselves — `paidTouched` is the one switch, and
  // this is derived fresh every render rather than pushed into RHF by an
  // effect (no `setState` during render, no stale suggestion one tick behind
  // a fresh preview).
  const suggested = debtStatus === 'ready' ? suggestedPaid(accrued, debt, cash) : '';
  const paidShown = paidTouched ? values.paid_amount : suggested;
  // R1 (client, 23.10): a payout above the cap — the suggestion IS the cap —
  // is refused here, not clamped: «Прийняти» is disabled and Enter does not
  // submit, while `TotalsSection` names the most that may go out.
  const paidParsed = parseDecimal(paidShown);
  const overCap = suggested !== '' && paidParsed !== null && cmp(paidParsed, suggested) === 1;
  // A line with no tare never goes out (§9.1, client 24.10) — said here as
  // well as by the preview's own gate, so no settled answer can open it.
  const everyLineHasTare = withoutBlankDraft(values).items.every(hasTare);
  const canSubmit =
    shiftOpen &&
    values.supplier_id !== '' &&
    debtStatus === 'ready' &&
    settled !== null &&
    !hasServerError &&
    !overCap &&
    everyLineHasTare;
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
    // `debt` — this is the balance WALKING IN, not after. Signed, the same
    // way «Разом» adds it (§3.5).
    const carriedIn = debt ?? '0.00';
    try {
      const created = await create.mutateAsync(
        toCreateBody({ ...formValues, paid_amount: paidShown }, bodyPointId),
      );
      const remainderOf = sub(add(created.amount, carriedIn), created.paid_amount);
      const remainderSign = cmp(remainderOf, '0');
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
          // Below zero it is the supplier who owes — said so, unsigned (B1).
          description:
            remainderSign === 1
              ? t('reception.toast.remainder', { uah: formatUah(remainderOf, locale) })
              : remainderSign === -1
                ? t('reception.toast.supplierOwes', {
                    uah: formatUah(sub('0', remainderOf), locale),
                  })
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
  const requestSubmit = (typed: IntakeFormValues) => {
    const formValues = withoutBlankDraft(typed);
    // #72 — a malformed «Видано готівкою» is never sent (`toCreateBody`), so
    // going ahead would record the receipt WITHOUT the payout the operator
    // typed. The field already names the refusal; the submit agrees with it.
    // Enter submits WITHOUT moving focus, and the field holds its own format
    // line back while focused — so the refusal is said through `paidError`,
    // which shows regardless of focus, and the caret stays where the operator
    // left it (Enter is how they move on the scale's numeric pad).
    if (paidShown.trim() !== '' && paidParsed === null) {
      setPaidRefused(paidShown);
      return;
    }
    // R1 — the button is disabled over the cap and the Enter guard holds; this
    // is the last word for any other path to a submit.
    if (overCap) return;
    if (parseCount(formValues.returned_crates) > 0) setPendingSubmit(formValues);
    else void submitIntake(formValues);
  };
  // The body the pending submit WOULD send — the same `toCreateBody` the write
  // uses, so the dialog names exactly the berry payout and crates that go out.
  const pendingBody =
    pendingSubmit !== null
      ? toCreateBody({ ...pendingSubmit, paid_amount: paidShown }, bodyPointId)
      : null;

  // Moves the operator to today's receipts card — scrolled into view and
  // focused, so the keyboard lands there too.
  const showTodayReceipts = () => {
    const card = document.getElementById(TODAY_RECEIPTS_ID);
    if (!card) return;
    card.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    card.focus({ preventScroll: true });
  };

  const handleOpenShift = () => {
    setOpenDialogInstance((n) => n + 1);
    setOpenDialogOpen(true);
  };

  const pointName = (points ?? []).find((p) => p.id === pointId)?.name ?? '';
  // In the top bar's scope slot (client, 24.10), where every screen's point is picked.
  const pointPicker = canPick ? (
    <HeaderSlot slot="scope">
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
    </HeaderSlot>
  ) : null;
  const actions = (
    <>
      {/* Owner only (#221): /prices is the owner's screen, and the operator
          already sees each grade's price on its option in the form below. */}
      {isOwner ? (
        <Button variant="outline" size="sm" asChild>
          <Link to="/prices">{t('reception.toPrices')}</Link>
        </Button>
      ) : null}
      <Button variant="secondary" size="sm" asChild>
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
        <PointStrip
          pointId={pointId}
          shift={stripShift}
          isOwner={isOwner}
          // B6 — the strip summarises today's receipts and leads to their one
          // list, the card under the form; with no open shift there is none.
          onShowToday={stripShift.status === 'open' ? showTodayReceipts : undefined}
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

        {/* No open shift today: nothing can be received, so the form and the
            settlement card give way to what to do about it. A failed read
            and «no shift» are the same `null` in the data — the header says
            which, and an «Open shift» button never shows on a failed read. */}
        {stripShift.status === 'pending' ? (
          <div className="flex justify-center py-12">
            <Spinner />
          </div>
        ) : stripShift.status === 'none' ? (
          <ShiftClosedState
            canOpen={me?.role === 'point_operator'}
            isOpening={openShift.isPending}
            onOpenShift={handleOpenShift}
          />
        ) : stripShift.status === 'error' ? null : (
          // One trace scope for the form (client, 24.10): the draft line's
          // formula cites its fields and «Нараховано сьогодні», the settlement
          // card its own rows. `display: contents` — it lays out nothing.
          <TraceScope>
            {/* Both cards stretch to the taller one (client, 24.10): the lines
              table fills the left card's slack, the button sits at the right
              card's foot. */}
            <form
              className="grid items-stretch gap-4 lg:grid-cols-[minmax(0,1.75fr)_minmax(320px,1fr)]"
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
              // numeric pad: on an entry field it moves to the next one
              // (`lib/entryFields`, «Ще позиція» among them) and never submits; on the last one
              // («Видано готівкою») and any other text input it is the submit,
              // held back while the form isn't ready. A key some control already
              // handled (the supplier picker's own Enter) is left alone. Same
              // portal guard as `onSubmit` above — the dialog's own Enter
              // keystrokes must not be swallowed by a guard meant for THIS form.
              // Focus moved on (a click, a Tab): nothing is waited on any more.
              onFocus={() => {
                waitingStop.current = null;
              }}
              onKeyDown={(e) => {
                if (!isOwnFormEvent(e)) return;
                waitingStop.current = null;
                if (e.key !== 'Enter' || e.defaultPrevented) return;
                // A button's Enter is its own click — «Ще позиція» included.
                if ((e.target as HTMLElement).tagName === 'BUTTON') return;
                const next = nextEntryField(e.currentTarget, e.target as Element);
                if (next) {
                  e.preventDefault();
                  // Disabled yet waited on: focus stays put until it is enabled.
                  if ((next as HTMLButtonElement).disabled) waitingStop.current = next;
                  else next.focus();
                  return;
                }
                if ((e.target as HTMLElement).tagName === 'INPUT' && !canSubmit) {
                  e.preventDefault();
                }
              }}
              noValidate
            >
              {/* Unclipped: the supplier picker's list is absolutely positioned
                inside this card and must open OVER the card's edge, not be cut
                by it. Nothing here touches the corners that clipping protects. */}
              {/* `min-w-0`: a grid item would otherwise widen to the lines
                table's own minimum and push a phone screen sideways. */}
              <Card className="flex min-w-0 flex-col overflow-visible">
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
                    focusProductNext.current = true;
                  }}
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
                  // A line is committed only once the server has PRICED IT AS IT
                  // STANDS: the preview covers every line, so committing one the
                  // server has not settled on (or has just refused) would take
                  // the whole form's numbers down with it.
                  canAdd={draftReady && !atCap && shiftOpen && settled !== null && !hasServerError}
                  addWaiting={
                    draftReady &&
                    !atCap &&
                    shiftOpen &&
                    settled === null &&
                    !hasServerError &&
                    values.supplier_id !== ''
                  }
                  atCap={atCap}
                  priceHintKey={supplier ? kindHintKey(supplier.kind) : null}
                  onAdd={() => {
                    focusProductNext.current = true;
                    lines.append(emptyLine(defaultTareTypeId));
                  }}
                />
                <LinesTable
                  rows={committed}
                  disabled={!shiftOpen}
                  onRemove={(index) => lines.remove(index)}
                />
              </Card>
              <Card className="flex min-w-0 flex-col">
                <TotalsSection
                  accrued={accrued}
                  // The receipt as it will go out — never the blank draft (B10).
                  lineCount={settled?.items.length ?? outgoing.items.length}
                  debt={debt}
                  debtStatus={debtStatus}
                  cash={cash}
                  cashUnavailable={pointCash.isError}
                  paid={paidShown}
                  onPaidChange={onPaidChange}
                  paidError={
                    errorAt('paid_amount') ??
                    (paidRefused !== null && paidShown === paidRefused
                      ? 'errors.decimalFormat'
                      : null)
                  }
                  disabled={!canSubmit}
                  isPreviewing={isPreviewing}
                  isSubmitting={create.isPending}
                  formErrorKey={formErrorKey}
                  showDraftHint={draftIndex > 0 && !draftReady && !draftBlank}
                  // Keyed by the supplier pick: a new pick remounts it, so the
                  // pre-fill follows the ceiling again until the operator types.
                  crateReturn={
                    <ReturnedCratesField
                      key={`${values.supplier_id}:${supplierPick}`}
                      supplierId={values.supplier_id || null}
                      pointId={bodyPointId ?? undefined}
                      crateTareUnits={crateTareUnits(outgoing.items, tareTypes.data ?? [])}
                      value={values.returned_crates}
                      onChange={(v) => setValue('returned_crates', v, { shouldDirty: true })}
                      disabled={!shiftOpen}
                    />
                  }
                />
              </Card>
            </form>
            {/* Outside the form: a row is a button that opens a receipt, never a
              part of the receipt being written. The ONE list of today's
              receipts (B6) — the strip's «Сьогодні» cell leads here. */}
            <Card className="mt-4">
              <section
                id={TODAY_RECEIPTS_ID}
                aria-labelledby="today-receipts-title"
                // Focus target for the strip's «Сьогодні», not a Tab stop.
                tabIndex={-1}
                className="scroll-mt-4 rounded-xl px-4 pt-3 pb-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Eyebrow className="mb-1">
                  <span id="today-receipts-title">{t('reception.today.title')}</span>
                </Eyebrow>
                <TodayReceipts
                  shiftId={stripShift.status === 'open' ? stripShift.shift.id : undefined}
                  onOpen={openReceipt}
                  layout="columns"
                />
              </section>
            </Card>
          </TraceScope>
        )}
      </>
    );

  const headerCaption = t('reception.eyebrow', {
    point: pointName,
    date: formatLongDate(todayIso(), locale),
  });

  return (
    <>
      {/* The title line lives in the app's top bar (client, 24.10), so the page
          starts at the strip; one row, the caption and the shift status giving
          way first on a narrow screen. */}
      {pointPicker}
      <HeaderSlot slot="title">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <h1 className="min-w-0 truncate font-display text-lg leading-tight font-medium">
            {t('reception.title')}
          </h1>
          <span
            className="hidden min-w-0 truncate text-sm text-muted-foreground xl:inline"
            title={headerCaption}
          >
            {headerCaption}
          </span>
          {pointId !== null ? (
            <span className="hidden lg:inline-flex">
              <ShiftStatus shift={stripShift} />
            </span>
          ) : null}
          {/* The sidebar has both links on a phone, where the bar has no room. */}
          <div className="ml-auto hidden shrink-0 items-center gap-2 md:flex">{actions}</div>
        </div>
      </HeaderSlot>
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
