import { forwardRef } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { ApiError } from '@/shared/api';
import { expectNoAxeViolations } from '../../../test-axe';
import type { Shift } from '@/entities/shift';
import type { Intake, IntakeDetail } from '@/entities/intake';
import type { Supplier } from '@/entities/supplier';
import type { PricedGrade } from '@/entities/product-grade';
import type { TareTypeOption } from '@/entities/tare-type';
import type { IntakeFormValues, IntakePreview } from '../model/intakeForm';
import { ReceptionPage } from './ReceptionPage';

// Matches the CountDrawerDialog's submit button whether i18n has resolved it
// yet (raw key), is showing the Ukrainian copy, or the English one this
// suite's locale renders.
const SUBMIT_COUNT = /day\.count\.submit|Записати|Record/i;

const {
  meMock,
  pointScopeMock,
  shiftMock,
  balanceMock,
  intakesMock,
  gradesMock,
  tareTypesMock,
  previewMock,
  createMock,
  openShiftMock,
  pointCashMock,
  toastMock,
  toastSuccessMock,
} = vi.hoisted(() => {
  type ToastMock = ReturnType<typeof vi.fn> & {
    success: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };
  // `toast` (sonner) is itself callable (the bare «lines cleared» notice) AND
  // carries `.success`/`.error` methods (the shift-open toast) — the mock
  // has to be both, unlike `PayoutDialog.test.tsx`'s plain-object `toast`.
  const toastMock = vi.fn() as unknown as ToastMock;
  toastMock.success = vi.fn();
  toastMock.error = vi.fn();
  return {
    meMock: vi.fn(),
    pointScopeMock: vi.fn(),
    shiftMock: vi.fn(),
    balanceMock: vi.fn(),
    intakesMock: vi.fn(),
    gradesMock: vi.fn(),
    tareTypesMock: vi.fn(),
    previewMock: vi.fn(),
    createMock: vi.fn(),
    openShiftMock: vi.fn(),
    pointCashMock: vi.fn(),
    toastMock,
    toastSuccessMock: vi.fn(),
  };
});

// The real sonner-backed module — mocked so a bare `toast(...)` call (the
// «lines cleared» notice) and `toastSuccess(...)` (the accepted receipt) are
// both observable without a `<Toaster/>` mounted, same shape
// `PayoutDialog.test.tsx` uses for `toast.success`.
vi.mock('@/shared/ui/toast', () => ({
  toast: toastMock,
  toastSuccess: toastSuccessMock,
  toastError: vi.fn(),
}));

vi.mock('@/entities/point-cash', () => ({
  usePointCashForPointQuery: (pointId: string | null, asOf?: string, enabled?: boolean) =>
    pointCashMock(pointId, asOf, enabled),
}));

// `PointStatePanel`'s own three reads — this file's job is the FORM and the
// header actions, so these are static "not fetched yet" stand-ins rather
// than another set of per-test hoisted mocks; `PointStatePanel.test.tsx` is
// where each of the six figures is actually exercised.
vi.mock('@/entities/cash-count', () => ({
  useCashCountsQuery: () => ({ data: undefined, isPending: true, isError: false }),
}));

vi.mock('@/entities/payout', () => ({
  usePayoutsQuery: () => ({ data: undefined, isPending: true, isError: false }),
}));

vi.mock('@/entities/crate', () => ({
  useCrateBalancesQuery: () => ({ data: undefined, isPending: true, isError: false }),
}));

vi.mock('@/entities/user', () => ({
  useMeQuery: () => meMock(),
  usePointScope: () => pointScopeMock(),
}));

vi.mock('@/entities/collection-point', () => ({
  usePointOptionsQuery: () => ({
    data: [
      { id: 'p1', name: 'Shypynky' },
      { id: 'p2', name: 'Haiove' },
    ],
    isPending: false,
    isError: false,
  }),
}));

vi.mock('@/entities/shift', () => ({
  useCurrentShiftQuery: (pointId: string | null) => shiftMock(pointId),
}));

vi.mock('@/entities/supplier', () => ({
  useSupplierBalanceQuery: (id: string | null) => balanceMock(id),
}));

// The picker itself (search, grouping, inline creation) is `SupplierPicker`'s
// own concern — tested in `features/pick-supplier/ui/SupplierPicker.test.tsx`.
// Here it is a single button that always hands back the fixed `nina` row, so
// every test below can get a supplier onto the form without driving a
// combobox. `forwardRef` mirrors the real component, since the page may pass
// a ref through (a later task's autofocus wiring).
vi.mock('@/features/pick-supplier', () => ({
  SupplierPicker: forwardRef(function SupplierPicker({
    onChange,
  }: {
    onChange: (s: Supplier) => void;
  }) {
    return (
      <button type="button" onClick={() => onChange(nina)}>
        pick-nina
      </button>
    );
  }),
}));

vi.mock('@/entities/intake', () => ({
  useIntakesQuery: (filter: unknown) => intakesMock(filter),
}));

vi.mock('@/entities/product-grade', () => ({
  usePricedGradesQuery: (pointId: string | null) => gradesMock(pointId),
}));

vi.mock('@/entities/tare-type', () => ({
  useTareTypeOptionsQuery: () => tareTypesMock(),
}));

vi.mock('@/widgets/receipt', () => ({
  ReceiptDialog: ({ intakeId, open }: { intakeId: string | null; open: boolean }) =>
    open ? <div>Receipt for {intakeId}</div> : null,
}));

vi.mock('../api/intakes', () => ({
  useCreateIntakeMutation: () => ({ mutateAsync: createMock, isPending: false }),
}));

// Only the mutation hook is stubbed — `CountDrawerDialog` (the real
// component, re-exported by this same module) still renders for real, since
// the "opens it on demand" test below drives it exactly as an operator would.
vi.mock('@/features/count-shift', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/count-shift')>();
  return {
    ...actual,
    useOpenShiftMutation: () => ({ mutateAsync: openShiftMock, isPending: false }),
  };
});

vi.mock('../lib/useIntakePreview', () => ({
  useIntakePreview: (...args: unknown[]) => previewMock(...args),
}));

const OPERATOR = {
  id: 'u1',
  username: 'operator',
  display_name: 'Olha',
  role: 'point_operator',
  collection_point_id: 'p1',
};
const OWNER = {
  id: 'u2',
  username: 'owner',
  display_name: 'Petro',
  role: 'network_owner',
  collection_point_id: null,
};

const openShift: Shift = {
  id: 's-open',
  collection_point_id: 'p1',
  business_date: '2026-09-08',
  status: 'open',
  opened_by_user_id: 'u1',
  closed_by_user_id: null,
  closed_at: null,
  created_at: '2026-09-08T05:00:00Z',
  explanation: null,
};

// The single row the `pick-supplier` stub always hands back — its id lines
// up with `PREVIEW`, `CREATED` and the default `intake()` fixture below,
// which all describe supplier `s1`.
const nina: Supplier = {
  id: 's1',
  collection_point_id: 'p1',
  first_name: 'Ніна',
  last_name: 'Ільчук',
  phone: '+380671112233',
  note: null,
  kind: 'none',
  is_active: true,
  created_at: '2026-05-01T08:00:00Z',
};

const GRADES: PricedGrade[] = [
  {
    id: 'g1',
    name: 'Grade 1',
    productId: 'pr1',
    productName: 'Raspberry',
    base_price: '10.00',
    max_markup: '3.00',
    max_discount: '2.00',
  },
  {
    id: 'g2',
    name: 'Grade 2',
    productId: 'pr1',
    productName: 'Raspberry',
    base_price: '8.00',
    max_markup: '3.00',
    max_discount: '2.00',
  },
  {
    id: 'g3',
    name: 'Grade 1',
    productId: 'pr2',
    productName: 'Strawberry',
    base_price: '20.00',
    max_markup: '1.00',
    max_discount: '1.00',
  },
];

const TARE_TYPES: TareTypeOption[] = [
  { id: 't0', name: 'Bucket', weight_kg: '0.30', is_crate: false },
  { id: 't1', name: 'Czech crate', weight_kg: '0.50', is_crate: true },
];

/** One previewable line: 126.40 gross − 6.00 tare = 120.40 net at 10.00 ₴/kg. */
const PREVIEW: IntakePreview = {
  collection_point_id: 'p1',
  supplier_id: 's1',
  business_date: '2026-09-08',
  amount: '1204.00',
  items: [
    {
      item_order: 1,
      product_grade_id: 'g1',
      gross_kg: '126.40',
      pallet_kg: '0.00',
      tare_weight_kg: '6.00',
      net_kg: '120.40',
      price: '10.00',
      bonus: '0.00',
      amount: '1204.00',
      tare: [{ tare_type_id: 't1', units: 12 }],
    },
  ],
};

const CREATED: IntakeDetail = {
  id: 'i-new',
  code: 'SHP-IN-20260908-00412',
  shift_id: 's-open',
  collection_point_id: 'p1',
  business_date: '2026-09-08',
  supplier_id: 's1',
  amount: '1204.00',
  received_by_user_id: 'u1',
  voided_at: null,
  voided_by_user_id: null,
  void_reason: null,
  created_at: '2026-09-08T09:15:00Z',
  net_kg: '36.90',
  lines_count: 2,
  supplier_name: 'Ніна Ільчук',
  paid_amount: '0.00',
  payouts: [],
  received_by_name: 'Оксана Гнатюк',
  items: [
    {
      id: 'it1',
      item_order: 1,
      product_grade_id: 'g1',
      gross_kg: '126.40',
      pallet_kg: '0.00',
      tare_weight_kg: '6.00',
      net_kg: '120.40',
      price: '10.00',
      bonus: '0.00',
      amount: '1204.00',
      tare: [{ tare_type_id: 't1', units: 12 }],
    },
  ],
};

const intake = (over: Partial<Intake> & Pick<Intake, 'id' | 'code' | 'amount'>): Intake => ({
  shift_id: 's-open',
  collection_point_id: 'p1',
  business_date: '2026-09-08',
  supplier_id: 's1',
  received_by_user_id: 'u1',
  voided_at: null,
  voided_by_user_id: null,
  void_reason: null,
  created_at: '2026-09-08T07:10:00Z',
  net_kg: '36.90',
  lines_count: 2,
  supplier_name: 'Ніна Ільчук',
  paid_amount: '0.00',
  ...over,
});

const page = <T,>(data: T[]) => ({
  data: { data, total: data.length, page: 1, limit: 100 },
  isPending: false,
  isError: false,
});

interface PreviewState {
  preview: IntakePreview | null;
  error: {
    fieldErrors: { field: string; messageKey: string }[];
    formErrorKey: string | null;
  } | null;
  isPending: boolean;
  isSettled: boolean;
}

/** `useIntakePreview`'s return shape. Nothing on screen may act on numbers that
 *  are not `isSettled`, so every case states it explicitly. */
const previewState = (over: Partial<PreviewState> = {}): PreviewState => ({
  preview: null,
  error: null,
  isPending: false,
  isSettled: false,
  ...over,
});

/** The happy case: the server has priced exactly what the form now says. */
const SETTLED = previewState({ preview: PREVIEW, isSettled: true });

function renderReception() {
  const router = createMemoryRouter(
    [
      { path: '/reception', element: <ReceptionPage /> },
      { path: '/suppliers/:id', element: <div>Supplier card</div> },
    ],
    { initialEntries: ['/reception'] },
  );
  return { ...render(<RouterProvider router={router} />), router };
}

/** Fills the draft line so the «Add line» gate opens: gross, tare units, grade. */
async function fillDraft(user: ReturnType<typeof userEvent.setup>, gross = '126,40') {
  const grossInput = screen.getByLabelText('Gross — berries including tare');
  await user.clear(grossInput);
  await user.type(grossInput, gross);
  const units = screen.getByLabelText('Tare units 1');
  await user.clear(units);
  await user.type(units, '12');
  await user.selectOptions(screen.getByLabelText('Product'), 'Raspberry');
}

beforeEach(() => {
  meMock.mockReset().mockReturnValue({ data: OPERATOR });
  pointScopeMock
    .mockReset()
    .mockReturnValue({ pointId: 'p1', canPick: false, setPointId: vi.fn(), isLoading: false });
  shiftMock.mockReset().mockReturnValue({ data: openShift, isPending: false, isError: false });
  balanceMock.mockReset().mockReturnValue({ data: undefined, isPending: false, isError: false });
  intakesMock.mockReset().mockReturnValue(page<Intake>([]));
  gradesMock.mockReset().mockReturnValue({ data: GRADES, isPending: false, isError: false });
  tareTypesMock.mockReset().mockReturnValue({ data: TARE_TYPES, isPending: false, isError: false });
  previewMock.mockReset().mockReturnValue(previewState());
  createMock.mockReset().mockResolvedValue(CREATED);
  openShiftMock.mockReset().mockResolvedValue(openShift);
  // Unread by default (`isPending`, no `data`) — `cash` resolves to `null`,
  // so the auto-suggested «Видано готівкою» is '0.00' and every pre-existing
  // «Accept N kg» assertion below keeps reading the submit label it always
  // has. Tests that care about a real payout set this explicitly.
  pointCashMock.mockReset().mockReturnValue({ data: undefined, isPending: true, isError: false });
  toastMock.mockReset();
  toastMock.success.mockReset();
  toastMock.error.mockReset();
  toastSuccessMock.mockReset();
});

describe('ReceptionPage — before the shift is open', () => {
  beforeEach(() => {
    shiftMock.mockReturnValue({ data: null, isPending: false, isError: false });
  });

  it('says the shift is not open, offers to open it and refuses to accept anything', async () => {
    const user = userEvent.setup();
    renderReception();

    expect(screen.getByText('Shift not opened yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Accept' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Open shift' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByRole('textbox'), '1500.00');
    await user.click(within(dialog).getByRole('button', { name: SUBMIT_COUNT }));
    await waitFor(() => expect(openShiftMock).toHaveBeenCalledWith({ counted_amount: '1500.00' }));
  });

  it('shows the refusal in the shared dialog and keeps it open when opening fails', async () => {
    const user = userEvent.setup();
    openShiftMock.mockRejectedValue(new ApiError(409, 'nope', undefined, 'SHIFT_ALREADY_OPEN'));
    renderReception();

    await user.click(screen.getByRole('button', { name: 'Open shift' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByRole('textbox'), '1500.00');
    await user.click(within(dialog).getByRole('button', { name: SUBMIT_COUNT }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'A shift is already open at this point',
    );
    // Still open: the same dialog, not replaced by a toast.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('says so when the shift could not be read, rather than offering to open one', () => {
    // A failed read and «no shift» look identical in the data, and the wrong
    // guess here lets an operator open a shift that is already open.
    shiftMock.mockReturnValue({ data: undefined, isPending: false, isError: true });

    renderReception();

    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
    expect(screen.queryByText('Shift not opened yet')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open shift' })).toBeNull();
  });

  it('tells the owner that opening the shift is the operator’s job', () => {
    meMock.mockReturnValue({ data: OWNER });
    pointScopeMock.mockReturnValue({
      pointId: 'p1',
      canPick: true,
      setPointId: vi.fn(),
      isLoading: false,
    });

    renderReception();

    expect(screen.getByText('Shift not opened yet — the operator opens it')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open shift' })).toBeNull();
  });
});

describe('ReceptionPage — choosing the supplier', () => {
  it('picks a supplier from the picker, then shows their balance note and last receipts', async () => {
    const user = userEvent.setup();
    balanceMock.mockReturnValue({
      data: { supplier_id: 's1', debt: '10944.00' },
      isPending: false,
      isError: false,
    });
    intakesMock.mockImplementation((filter: { supplierId?: string }) =>
      filter.supplierId
        ? page<Intake>([
            intake({ id: 'i1', code: 'SHP-IN-20260907-00007', amount: '820.50' }),
            intake({ id: 'i2', code: 'SHP-IN-20260906-00003', amount: '1290.00' }),
          ])
        : page<Intake>([]),
    );

    renderReception();
    await user.click(screen.getByRole('button', { name: 'pick-nina' }));

    expect(screen.getByText('Previous balance 10,944.00 ₴')).toBeInTheDocument();
    // The note that the debt is not a separate payout — it lands in «Total».
    expect(screen.getByText('added to “Total” below')).toBeInTheDocument();
    expect(screen.getByText('Intake history')).toBeInTheDocument();
    // Both mocked rows share the fixture's default net weight.
    expect(screen.getAllByText('36.90 kg')).toHaveLength(2);
    expect(screen.getByText('820.50 ₴')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Supplier card' })).toHaveAttribute(
      'href',
      '/suppliers/s1',
    );
  });

  it('reads a negative balance as money owed to the supplier, not by them', async () => {
    const user = userEvent.setup();
    balanceMock.mockReturnValue({
      data: { supplier_id: 's1', debt: '-250.00' },
      isPending: false,
      isError: false,
    });

    renderReception();
    await user.click(screen.getByRole('button', { name: 'pick-nina' }));

    expect(screen.getByText('Overpaid by us 250.00 ₴')).toBeInTheDocument();
    expect(screen.queryByText(/Previous balance/)).toBeNull();
  });
});

describe('ReceptionPage — a one-line receipt', () => {
  beforeEach(() => {
    previewMock.mockReturnValue(SETTLED);
  });

  it('shows the server’s numbers and posts exactly what was typed', async () => {
    const user = userEvent.setup();
    renderReception();

    await user.click(screen.getByRole('button', { name: 'pick-nina' }));
    // The history panel only renders while a supplier is chosen.
    expect(screen.getByText('Intake history')).toBeInTheDocument();
    await fillDraft(user);

    // Net weight and the amount are the SERVER's, never computed here.
    expect(screen.getByText(/net 120\.40 kg/)).toBeInTheDocument();
    expect(screen.getByText('Accrued today').closest('div')).toHaveTextContent('1,204.00 ₴');

    const submit = screen.getByRole('button', { name: 'Accept 120.40 kg' });
    expect(submit).toBeEnabled();
    await user.click(submit);

    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith({
        supplier_id: 's1',
        items: [
          {
            product_grade_id: 'g1',
            gross_kg: '126.40',
            pallet_kg: '0.00',
            bonus: '0.00',
            tare: [{ tare_type_id: 't1', units: 12 }],
          },
        ],
      }),
    );

    expect(await screen.findByText('Receipt for i-new')).toBeInTheDocument();
    // A saved document leaves a clean form behind — the next supplier is next,
    // so the page's own `supplier` state (not just the RHF field) resets to
    // `null` too, which collapses the history panel again.
    expect(screen.queryByText('Intake history')).toBeNull();
  });

  it('sends the owner’s picked point, which an operator’s token supplies instead', async () => {
    const user = userEvent.setup();
    meMock.mockReturnValue({ data: OWNER });
    pointScopeMock.mockReturnValue({
      pointId: 'p1',
      canPick: true,
      setPointId: vi.fn(),
      isLoading: false,
    });

    renderReception();

    await user.click(screen.getByRole('button', { name: 'pick-nina' }));
    await fillDraft(user);
    await user.click(screen.getByRole('button', { name: 'Accept 120.40 kg' }));

    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith(
        expect.objectContaining({ collection_point_id: 'p1', supplier_id: 's1' }),
      ),
    );
    // The preview is asked the same question with the same point.
    expect(previewMock).toHaveBeenCalledWith(expect.anything(), 'p1', { enabled: true });
  });

  it('holds the receipt back while the preview is still catching up with the form', async () => {
    const user = userEvent.setup();
    // The 250ms debounce window: nothing is in flight (`isPending` false) and
    // the last preview is still on screen, but it answers an older form.
    previewMock.mockReturnValue(previewState({ preview: PREVIEW, isSettled: false }));

    renderReception();

    await user.click(screen.getByRole('button', { name: 'pick-nina' }));
    await fillDraft(user);

    // No weight on the button and no total: those numbers are not this form's.
    expect(screen.getByRole('button', { name: 'Accept' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Accept 120.40 kg/ })).toBeNull();
    expect(screen.getByText('Accrued today').closest('div')).toHaveTextContent('…');
    expect(screen.getByRole('button', { name: 'Add line' })).toBeDisabled();
  });

  it('asks for no receipt number — the server numbers the receipt', async () => {
    const user = userEvent.setup();
    renderReception();

    await user.click(screen.getByRole('button', { name: 'pick-nina' }));
    await fillDraft(user);

    expect(screen.queryByLabelText('Receipt no.')).not.toBeInTheDocument();
    // And nothing is standing between a complete line and the submit.
    expect(screen.getByRole('button', { name: 'Accept 120.40 kg' })).toBeEnabled();
  });
});

describe('ReceptionPage — several lines', () => {
  beforeEach(() => {
    // A settled preview whose item COUNT tracks the current form. The static
    // single-item `SETTLED` fixture would otherwise mismatch the moment a
    // second line exists — after the row-preview guard fix (finding 2) that
    // reads as a pending «…» rather than a real number, and these tests care
    // about row count and control state, not any particular figure.
    previewMock.mockImplementation((values: IntakeFormValues) =>
      previewState({
        preview: { ...PREVIEW, items: values.items.map(() => PREVIEW.items[0]) },
        isSettled: true,
      }),
    );
  });

  it('commits the draft into the lines table and stops at five', async () => {
    const user = userEvent.setup();
    renderReception();

    await user.click(screen.getByRole('button', { name: 'pick-nina' }));

    const add = () => screen.getByRole('button', { name: 'Add line' });
    // An untouched draft is not a line — nothing to commit yet.
    expect(add()).toBeDisabled();

    await fillDraft(user);
    expect(add()).toBeEnabled();
    await user.click(add());

    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(2); // header + one line
    expect(within(table).getByText('Raspberry · Grade 1')).toBeInTheDocument();
    expect(within(table).getByText('120.40')).toBeInTheDocument();
    // Committing resets the draft, so the gate closes again.
    expect(add()).toBeDisabled();

    for (let n = 0; n < 3; n++) {
      await fillDraft(user);
      await user.click(add());
    }

    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(5);
    await fillDraft(user);
    expect(add()).toBeDisabled();
    expect(
      screen.getByText('Real data never has more than 5 lines per visit — no more are added.'),
    ).toBeInTheDocument();
  });

  it('locks the per-row trash once the shift is closed, like every other control', async () => {
    const user = userEvent.setup();
    renderReception();

    await user.click(screen.getByRole('button', { name: 'pick-nina' }));
    await fillDraft(user);
    await user.click(screen.getByRole('button', { name: 'Add line' }));
    // Scoped to the table: the draft now also offers its own «Remove line»
    // escape hatch (finding 1), sharing the same name.
    const rowTrash = () =>
      within(screen.getByRole('table')).getByRole('button', { name: 'Remove line' });
    expect(rowTrash()).toBeEnabled();

    // The operator closed the shift in the other tab; the receipt cannot be
    // written any more, so it cannot be edited any more either.
    shiftMock.mockReturnValue({ data: null, isPending: false, isError: false });
    // Any keystroke will do — this one just has to re-render the screen with
    // the mock above in place.
    await user.type(screen.getByLabelText('Gross — berries including tare'), '1');

    expect(rowTrash()).toBeDisabled();
  });

  it("counts only committed rows in the table's own counter, not the trailing draft", async () => {
    const user = userEvent.setup();
    renderReception();

    await user.click(screen.getByRole('button', { name: 'pick-nina' }));
    await fillDraft(user);
    await user.click(screen.getByRole('button', { name: 'Add line' }));
    // The fresh draft is filled too — a real preview would settle over BOTH
    // lines at this point, so the table's counter (unlike the submit
    // button's own draft-inclusive count) must still describe only the ONE
    // committed row the table actually shows.
    await fillDraft(user);

    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(2); // header + one committed line

    // Scoped to the «Add line» row itself — the submit button below
    // legitimately reads «Accept 2 lines · 240.80 kg» (TotalsSection's own,
    // draft-inclusive count), which a bare `screen.queryByText` would also
    // match and turn a real bug into a false pass.
    const addLineRow = screen.getByRole('button', { name: 'Add line' }).parentElement!;
    expect(within(addLineRow).getByText('1 line · 120.40 kg')).toBeInTheDocument();
    expect(within(addLineRow).queryByText(/2 lines/)).not.toBeInTheDocument();
  });
});

describe('ReceptionPage — an accidental extra line', () => {
  it('offers an escape hatch back to a submittable state', async () => {
    const user = userEvent.setup();
    // Mirrors the real hook's `isPreviewable`: settled only once EVERY line
    // is complete, so committing the draft leaves a fresh empty one and the
    // preview goes dark — exactly what strands the real screen (finding 1).
    previewMock.mockImplementation((values: IntakeFormValues) => {
      const complete = values.items.every(
        (line) => line.product_grade_id !== '' && line.gross_kg.trim() !== '',
      );
      return complete ? SETTLED : previewState({ preview: PREVIEW, isSettled: false });
    });

    renderReception();
    await user.click(screen.getByRole('button', { name: 'pick-nina' }));
    await fillDraft(user);

    await user.click(screen.getByRole('button', { name: 'Add line' }));

    // The fresh draft is empty: nothing previews, so nothing can be added,
    // submitted, or explained — until the hint and the escape hatch.
    expect(screen.getByText('Finish this line or remove it')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Accept' })).toBeDisabled();

    // The draft's own «Remove line» ghost button (LineEditor renders before
    // the table, so it is first in DOM order) — not the committed row's trash.
    await user.click(screen.getAllByRole('button', { name: 'Remove line' })[0]);

    // Un-committing restores the (still-complete) surviving line, so the
    // preview — and submit — are unstuck again.
    expect(screen.queryByText('Finish this line or remove it')).toBeNull();
    expect(screen.getByRole('button', { name: 'Accept 120.40 kg' })).toBeEnabled();
  });
});

describe('ReceptionPage — the committed table while the preview catches up', () => {
  it('shows pending cells instead of a stale number right after a commit', async () => {
    const user = userEvent.setup();
    // A settled preview that still describes the PRE-commit form (one line) —
    // the same shape the real hook returns for the debounce window right
    // after a commit changes the form's line count.
    previewMock.mockReturnValue(SETTLED);

    renderReception();
    await user.click(screen.getByRole('button', { name: 'pick-nina' }));
    await fillDraft(user);
    await user.click(screen.getByRole('button', { name: 'Add line' }));

    const table = screen.getByRole('table');
    // The preview still has ONE item; the form now has a committed line PLUS
    // a fresh draft (two lines) — the committed row's preview item is no
    // longer reliably at the same index, so its cells read pending, never
    // the stale number.
    expect(within(table).queryByText('120.40')).toBeNull();
    expect(within(table).getAllByText('…').length).toBeGreaterThan(0);
  });
});

describe('ReceptionPage — tare rows', () => {
  it('gives each tare row a distinct accessible name', async () => {
    const user = userEvent.setup();
    renderReception();

    await user.click(screen.getByRole('button', { name: 'Other tare' }));

    expect(screen.getByLabelText('Tare type 1')).toBeInTheDocument();
    expect(screen.getByLabelText('Tare type 2')).toBeInTheDocument();
    expect(screen.getByLabelText('Tare units 1')).toBeInTheDocument();
    expect(screen.getByLabelText('Tare units 2')).toBeInTheDocument();
    expect(screen.getByLabelText('One fewer 1')).toBeInTheDocument();
    expect(screen.getByLabelText('One fewer 2')).toBeInTheDocument();
    expect(screen.getByLabelText('One more 1')).toBeInTheDocument();
    expect(screen.getByLabelText('One more 2')).toBeInTheDocument();
  });
});

describe('ReceptionPage — the draft line preview', () => {
  it('shows a discount without a doubled sign', async () => {
    const user = userEvent.setup();
    previewMock.mockReturnValue(
      previewState({
        preview: { ...PREVIEW, items: [{ ...PREVIEW.items[0], bonus: '-5.00' }] },
        isSettled: true,
      }),
    );

    renderReception();
    await user.click(screen.getByRole('button', { name: 'pick-nina' }));
    await fillDraft(user);

    expect(screen.getByText(/10\.00−5\.00/)).toBeInTheDocument();
    expect(screen.queryByText(/\+−/)).toBeNull();
  });
});

describe("ReceptionPage — the supplier's history and today's badge", () => {
  it('marks a voided receipt in the history with a strike-through', async () => {
    const user = userEvent.setup();
    intakesMock.mockImplementation((filter: { supplierId?: string }) =>
      filter.supplierId
        ? page<Intake>([
            intake({
              id: 'i1',
              code: 'SHP-IN-1',
              amount: '100.00',
              voided_at: '2026-09-07T10:00:00Z',
            }),
            intake({ id: 'i2', code: 'SHP-IN-2', amount: '200.00' }),
          ])
        : page<Intake>([]),
    );

    renderReception();
    await user.click(screen.getByRole('button', { name: 'pick-nina' }));

    // The history row shows date · net weight (or «voided») · amount — no
    // code any more, so the rows are found by their amount instead.
    const voidedRow = screen.getByText('100.00 ₴').closest('li');
    expect(voidedRow).toHaveClass('line-through');
    expect(within(voidedRow!).getByText('voided')).toBeInTheDocument();

    const liveRow = screen.getByText('200.00 ₴').closest('li');
    expect(liveRow).not.toHaveClass('line-through');
    expect(within(liveRow!).getByText('36.90 kg')).toBeInTheDocument();
  });

  it("counts only live receipts in today's badge, though a voided one stays listed", async () => {
    intakesMock.mockImplementation((filter: { shiftId?: string }) =>
      filter.shiftId
        ? page<Intake>([
            intake({
              id: 'i1',
              code: 'SHP-IN-1',
              amount: '100.00',
              voided_at: '2026-09-07T10:00:00Z',
            }),
            intake({ id: 'i2', code: 'SHP-IN-2', amount: '200.00' }),
          ])
        : page<Intake>([]),
    );

    renderReception();

    // Scoped to the receipts card itself: `PointStatePanel` reads the SAME
    // `useIntakesQuery({ shiftId })` for its own «Залишків створено» figure,
    // and this fixture's live receipt (200.00 − 0.00 paid) prints the same
    // «200.00 ₴» there too.
    const card = screen.getByText("Today's receipts").closest('[data-slot="card"]');
    const scoped = within(card as HTMLElement);

    // No code any more — the rows are found by their amount, same as the
    // supplier-history test above.
    const voidedRow = scoped.getByText('100.00 ₴').closest('button');
    expect(voidedRow).toHaveClass('line-through');
    const liveRow = scoped.getByText('200.00 ₴').closest('button');
    expect(liveRow).not.toHaveClass('line-through');

    const badgeArea = screen.getByText("Today's receipts").parentElement;
    expect(within(badgeArea!).getByText('1')).toBeInTheDocument();
    // Only the live receipt's kilos count toward the header tonnage — the
    // voided one (same 36.90 kg fixture default) does not double it up.
    expect(within(badgeArea!).getByText('36.90 kg')).toBeInTheDocument();
  });
});

describe('ReceptionPage — the client-side sanity hints', () => {
  it('warns about an implausible gross weight without choking on the spaces around it', async () => {
    const user = userEvent.setup();
    renderReception();

    // A leading space survives a paste from the scale's display; `formatDecimal`
    // admits no whitespace, so an untrimmed value used to throw mid-render and
    // take the half-typed receipt down with it.
    const gross = screen.getByLabelText('Gross — berries including tare');
    await user.clear(gross);
    await user.type(gross, ' 800');

    expect(
      screen.getByText(
        '800.00 kg — more than the largest line of the season (701.5 kg). Check the gross weight.',
      ),
    ).toBeInTheDocument();
  });
});

describe('ReceptionPage — a refusal from the server', () => {
  it('puts a mapped line error under the field it names and holds the receipt back', async () => {
    const user = userEvent.setup();
    previewMock.mockReturnValue(
      previewState({
        preview: PREVIEW,
        error: {
          fieldErrors: [
            { field: 'items.0.gross_kg', messageKey: 'reception.errors.decimalFormat' },
          ],
          formErrorKey: null,
        },
      }),
    );

    renderReception();

    await user.click(screen.getByRole('button', { name: 'pick-nina' }));
    await fillDraft(user);

    const gross = screen.getByLabelText('Gross — berries including tare');
    expect(gross).toHaveAttribute('aria-invalid', 'true');
    expect(gross.getAttribute('aria-describedby')).toContain('items.0.gross_kg-error');
    expect(screen.getByText('Enter a weight like 126.40')).toBeInTheDocument();

    // A refused line is neither submittable nor committable — the last good
    // preview is still on screen, and it is not an answer to THIS form.
    expect(screen.getByRole('button', { name: 'Accept' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add line' })).toBeDisabled();
    expect(createMock).not.toHaveBeenCalled();
  });

  it('reveals the pallet field to carry an error the operator never opened it for', async () => {
    const user = userEvent.setup();
    previewMock.mockReturnValue(
      previewState({
        preview: PREVIEW,
        error: {
          fieldErrors: [
            { field: 'items.0.pallet_kg', messageKey: 'reception.errors.decimalFormat' },
          ],
          formErrorKey: null,
        },
      }),
    );

    renderReception();
    await user.click(screen.getByRole('button', { name: 'pick-nina' }));

    const pallet = screen.getByLabelText('Pallet');
    expect(pallet).toHaveAttribute('aria-invalid', 'true');
    expect(pallet.getAttribute('aria-describedby')).toContain('items.0.pallet_kg-error');
    expect(screen.getByText('Enter a weight like 126.40')).toBeInTheDocument();
  });

  it('says so out loud when the refused field is on a line the editor no longer shows', async () => {
    const user = userEvent.setup();
    previewMock.mockReturnValue(SETTLED);

    renderReception();
    await user.click(screen.getByRole('button', { name: 'pick-nina' }));
    await fillDraft(user);
    await user.click(screen.getByRole('button', { name: 'Add line' }));

    // Line 0 is committed now; the draft is line 1, so nothing on screen owns
    // an `items.0.*` error — without the banner the submit would be disabled
    // with no explanation anywhere.
    previewMock.mockReturnValue(
      previewState({
        preview: PREVIEW,
        error: {
          fieldErrors: [
            { field: 'items.0.gross_kg', messageKey: 'reception.errors.decimalFormat' },
          ],
          formErrorKey: null,
        },
      }),
    );
    // Any keystroke will do — this one just has to re-render the screen with
    // the mock above in place.
    await user.type(screen.getByLabelText('Gross — berries including tare'), '1');

    expect(
      screen.getByText('The server refused one of the lines — check the rows in the table'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Accept' })).toBeDisabled();
  });
});

describe('ReceptionPage — «Видано готівкою» rides along with «Прийняти» (§2.1 ⑥, §3.1, §3.6)', () => {
  beforeEach(() => {
    balanceMock.mockReturnValue({
      data: { supplier_id: 's1', debt: '37.37' },
      isPending: false,
      isError: false,
    });
    pointCashMock.mockReturnValue({
      data: { collection_point_id: 'p1', cash: '1616.10' },
      isPending: false,
      isError: false,
    });
    // accrued 5460.00 + the 37.37 balance = 5497.37 total, capped by the
    // 1616.10 in the drawer — the auto-suggested payout the operator never
    // has to type for either case below.
    previewMock.mockReturnValue(
      previewState({ preview: { ...PREVIEW, amount: '5460.00' }, isSettled: true }),
    );
  });

  it('sends the auto-suggested, cash-capped payout as paid_amount', async () => {
    const user = userEvent.setup();
    renderReception();

    await user.click(screen.getByRole('button', { name: 'pick-nina' }));
    await fillDraft(user);

    const submit = screen.getByRole('button', { name: 'Accept 120.40 kg · pay out 1,616.10 ₴' });
    expect(submit).toBeEnabled();
    await user.click(submit);

    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith(
        expect.objectContaining({ supplier_id: 's1', paid_amount: '1616.10' }),
      ),
    );
  });

  it('lands a PAYOUT_EXCEEDS_CASH refusal on «Видано готівкою» and does not reset the form', async () => {
    const user = userEvent.setup();
    createMock.mockRejectedValueOnce(new ApiError(400, 'nope', undefined, 'PAYOUT_EXCEEDS_CASH'));
    renderReception();

    await user.click(screen.getByRole('button', { name: 'pick-nina' }));
    await fillDraft(user);
    await user.click(screen.getByRole('button', { name: 'Accept 120.40 kg · pay out 1,616.10 ₴' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "There's less in the berry drawer — the server capped the payout; reduce the amount",
    );
    // The WHOLE write rolled back server-side (the intake was never created)
    // — the draft the operator was completing is still exactly what they
    // typed, not a fresh blank form.
    expect(screen.getByLabelText('Gross — berries including tare')).toHaveValue('126.40');
    expect(screen.queryByText('Receipt for i-new')).toBeNull();
  });
});

describe('ReceptionPage — switching supplier mid-visit', () => {
  it('clears committed lines and warns when a new supplier is picked with something already committed', async () => {
    const user = userEvent.setup();
    previewMock.mockImplementation((values: IntakeFormValues) =>
      previewState({
        preview: { ...PREVIEW, items: values.items.map(() => PREVIEW.items[0]) },
        isSettled: true,
      }),
    );

    renderReception();
    await user.click(screen.getByRole('button', { name: 'pick-nina' }));
    await fillDraft(user);
    await user.click(screen.getByRole('button', { name: 'Add line' }));
    expect(screen.getByRole('table')).toBeInTheDocument();

    // Picking again simulates a switch — the stub always hands back the same
    // row, but the PAGE doesn't know that, and reacts to there being
    // something committed already.
    await user.click(screen.getByRole('button', { name: 'pick-nina' }));

    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByLabelText('Gross — berries including tare')).toHaveValue('');
    expect(toastMock).toHaveBeenCalledWith('Lines cleared — they belonged to the previous supplier');
  });

  it('neither clears anything nor warns on a plain first pick — nothing was committed yet', async () => {
    const user = userEvent.setup();
    renderReception();

    await user.click(screen.getByRole('button', { name: 'pick-nina' }));

    expect(toastMock).not.toHaveBeenCalled();
  });
});

describe('ReceptionPage — line editor ergonomics (#117)', () => {
  it('masks the gross weight while typing and never shows the surcharge bounds', async () => {
    const user = userEvent.setup();
    renderReception();
    await user.click(screen.getByRole('button', { name: 'pick-nina' }));

    const gross = screen.getByLabelText('Gross — berries including tare');
    await user.type(gross, '12a,3x45');
    expect(gross).toHaveValue('12.34');

    // §2.10 / ticket #117 — a bound is a limit, never a number shown to the
    // operator, whichever grade is selected.
    expect(screen.queryByText(/limits:/i)).not.toBeInTheDocument();
    expect(screen.queryByText('out of range')).not.toBeInTheDocument();
  });

  it("clamps the surcharge to the grade's bounds on blur and by the stepper", async () => {
    const user = userEvent.setup();
    renderReception();

    // Line 0 is pre-selected onto the fixture's first grade (g1: max_markup
    // 3.00, max_discount 2.00) — see the "pre-selects" test below.
    await waitFor(() => {
      expect(screen.getByLabelText('Grade and day price')).toHaveValue('g1');
    });
    const bonus = screen.getByLabelText('Extra price — for this line, ₴/kg');
    await user.clear(bonus);
    await user.type(bonus, '5');
    await user.tab();
    expect(bonus).toHaveValue('3.00');

    await user.click(screen.getByRole('button', { name: 'Extra price up' }));
    expect(bonus).toHaveValue('3.00');
  });

  it('reveals the pallet field on its own at twenty crates', async () => {
    const user = userEvent.setup();
    renderReception();

    expect(screen.queryByLabelText('Pallet')).not.toBeInTheDocument();
    const units = screen.getByLabelText('Tare units 1');
    await user.clear(units);
    await user.type(units, '20');

    expect(screen.getByLabelText('Pallet')).toBeInTheDocument();
  });

  it('shows the row weight beside the tare stepper and warns at zero units', async () => {
    const user = userEvent.setup();
    renderReception();

    // The default line starts on one Czech crate (0.50 kg) at a count of 1.
    expect(screen.getByText('0.50 kg')).toBeInTheDocument();

    const gross = screen.getByLabelText('Gross — berries including tare');
    await user.type(gross, '10');
    const units = screen.getByLabelText('Tare units 1');
    await user.clear(units);
    await user.type(units, '0');

    expect(
      screen.getByText(
        'Enter the tare quantity — without it the gross weight would count entirely as net.',
      ),
    ).toBeInTheDocument();
  });

  it('pre-selects the first priced grade on the first line', async () => {
    renderReception();

    await waitFor(() => {
      expect(screen.getByLabelText('Grade and day price')).toHaveValue('g1');
    });
  });
});

describe('ReceptionPage — accessibility', () => {
  it('has no axe violations at rest', async () => {
    const { container } = renderReception();
    await expectNoAxeViolations(container);
  });

  it('has no axe violations once a supplier is chosen and a line is drafted', async () => {
    const user = userEvent.setup();
    previewMock.mockReturnValue(SETTLED);
    balanceMock.mockReturnValue({
      data: { supplier_id: 's1', debt: '4000.00' },
      isPending: false,
      isError: false,
    });

    const { container } = renderReception();
    await user.click(screen.getByRole('button', { name: 'pick-nina' }));
    await fillDraft(user);

    await expectNoAxeViolations(container);
  });
});
