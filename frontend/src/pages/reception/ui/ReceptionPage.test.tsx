import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { expectNoAxeViolations } from '../../../test-axe';
import type { Shift } from '@/entities/shift';
import type { Intake, IntakeDetail } from '@/entities/intake';
import type { Supplier } from '@/entities/supplier';
import type { PricedGrade } from '@/entities/product-grade';
import type { TareTypeOption } from '@/entities/tare-type';
import type { IntakePreview } from '../model/intakeForm';
import { ReceptionPage } from './ReceptionPage';

const {
  meMock,
  pointScopeMock,
  shiftMock,
  suppliersMock,
  balanceMock,
  intakesMock,
  gradesMock,
  tareTypesMock,
  previewMock,
  createMock,
  openShiftMock,
} = vi.hoisted(() => ({
  meMock: vi.fn(),
  pointScopeMock: vi.fn(),
  shiftMock: vi.fn(),
  suppliersMock: vi.fn(),
  balanceMock: vi.fn(),
  intakesMock: vi.fn(),
  gradesMock: vi.fn(),
  tareTypesMock: vi.fn(),
  previewMock: vi.fn(),
  createMock: vi.fn(),
  openShiftMock: vi.fn(),
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
  useSuppliersQuery: (search: string, pointId: string | null) => suppliersMock(search, pointId),
  useSupplierBalanceQuery: (id: string | null) => balanceMock(id),
  supplierName: (s: { first_name: string; last_name: string }) =>
    `${s.first_name} ${s.last_name}`,
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
  useOpenShiftMutation: () => ({ mutateAsync: openShiftMock, isPending: false }),
}));

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
};

const supplier = (over: Partial<Supplier> & Pick<Supplier, 'id'>): Supplier => ({
  collection_point_id: 'p1',
  first_name: 'Mariia',
  last_name: 'Kovalchuk',
  phone: '+380671112233',
  note: null,
  kind: 'none',
  is_active: true,
  created_at: '2026-05-01T08:00:00Z',
  ...over,
});

const SUPPLIERS: Supplier[] = [
  supplier({ id: 's1' }),
  supplier({ id: 's2', first_name: 'Petro', last_name: 'Bondar', kind: 'farmer', phone: null }),
  supplier({ id: 's3', first_name: 'Retired', last_name: 'Person', is_active: false }),
];

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
  ...over,
});

const page = <T,>(data: T[]) => ({
  data: { data, total: data.length, page: 1, limit: 100 },
  isPending: false,
  isError: false,
});

interface PreviewState {
  preview: IntakePreview | null;
  error: { fieldErrors: { field: string; messageKey: string }[]; formErrorKey: string | null } | null;
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
  const units = screen.getByLabelText('Tare units');
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
  suppliersMock.mockReset().mockReturnValue(page(SUPPLIERS));
  balanceMock.mockReset().mockReturnValue({ data: undefined, isPending: false, isError: false });
  intakesMock.mockReset().mockReturnValue(page<Intake>([]));
  gradesMock.mockReset().mockReturnValue({ data: GRADES, isPending: false, isError: false });
  tareTypesMock
    .mockReset()
    .mockReturnValue({ data: TARE_TYPES, isPending: false, isError: false });
  previewMock.mockReset().mockReturnValue(previewState());
  createMock.mockReset().mockResolvedValue(CREATED);
  openShiftMock.mockReset().mockResolvedValue(openShift);
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
    await waitFor(() => expect(openShiftMock).toHaveBeenCalledTimes(1));
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
  it('searches, picks a supplier, then shows their balance and last receipts', async () => {
    const user = userEvent.setup();
    balanceMock.mockReturnValue({
      data: { supplier_id: 's1', debt: '4000.00' },
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

    // A deactivated supplier is never offered on a new receipt.
    expect(screen.queryByRole('button', { name: /Retired Person/ })).toBeNull();

    await user.type(screen.getByLabelText('Last name or phone…'), 'Kova');
    await waitFor(() => expect(suppliersMock).toHaveBeenCalledWith('Kova', 'p1'));

    await user.click(screen.getByRole('button', { name: /Mariia Kovalchuk/ }));

    expect(screen.getByText('Previous balance 4,000.00 ₴')).toBeInTheDocument();
    expect(screen.getByText('Intake history')).toBeInTheDocument();
    expect(screen.getByText('SHP-IN-20260907-00007')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Supplier card' })).toHaveAttribute(
      'href',
      '/suppliers/s1',
    );

    // The chip replaces the list until «Change» is pressed.
    expect(screen.getByRole('button', { name: 'Change' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Last name or phone…')).toBeNull();
  });

  it('reads a negative balance as money owed to the supplier, not by them', async () => {
    const user = userEvent.setup();
    balanceMock.mockReturnValue({
      data: { supplier_id: 's1', debt: '-250.00' },
      isPending: false,
      isError: false,
    });

    renderReception();
    await user.click(screen.getByRole('button', { name: /Mariia Kovalchuk/ }));

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

    await user.click(screen.getByRole('button', { name: /Mariia Kovalchuk/ }));
    await user.type(screen.getByLabelText('Receipt no.'), '00412');
    await fillDraft(user);

    // Net weight and the amount are the SERVER's, never computed here.
    expect(screen.getByText(/net 120\.40 kg/)).toBeInTheDocument();
    expect(screen.getByText('Accrued').closest('div')).toHaveTextContent('1,204.00 ₴');

    const submit = screen.getByRole('button', { name: 'Accept 120.40 kg' });
    expect(submit).toBeEnabled();
    await user.click(submit);

    await waitFor(() =>
      expect(createMock).toHaveBeenCalledWith({
        code: '00412',
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
    // A saved document leaves a clean form behind — the next supplier is next.
    expect(screen.getByLabelText('Receipt no.')).toHaveValue('');
    expect(screen.getByLabelText('Last name or phone…')).toBeInTheDocument();
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

    await user.click(screen.getByRole('button', { name: /Mariia Kovalchuk/ }));
    await user.type(screen.getByLabelText('Receipt no.'), '00412');
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

    await user.click(screen.getByRole('button', { name: /Mariia Kovalchuk/ }));
    await user.type(screen.getByLabelText('Receipt no.'), '00412');
    await fillDraft(user);

    // No weight on the button and no total: those numbers are not this form's.
    expect(screen.getByRole('button', { name: 'Accept' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Accept 120.40 kg/ })).toBeNull();
    expect(screen.getByText('Accrued').closest('div')).toHaveTextContent('…');
    expect(screen.getByRole('button', { name: 'Add line' })).toBeDisabled();
  });

  it('will not submit a receipt number the paper book could not carry', async () => {
    const user = userEvent.setup();
    renderReception();

    await user.click(screen.getByRole('button', { name: /Mariia Kovalchuk/ }));
    await fillDraft(user);
    await user.type(screen.getByLabelText('Receipt no.'), '-12');

    expect(screen.getByRole('button', { name: 'Accept 120.40 kg' })).toBeDisabled();
    expect(screen.getByText('1–16 Latin letters, digits or dashes')).toBeInTheDocument();
  });
});

describe('ReceptionPage — several lines', () => {
  beforeEach(() => {
    previewMock.mockReturnValue(SETTLED);
  });

  it('commits the draft into the lines table and stops at five', async () => {
    const user = userEvent.setup();
    renderReception();

    await user.click(screen.getByRole('button', { name: /Mariia Kovalchuk/ }));

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

    await user.click(screen.getByRole('button', { name: /Mariia Kovalchuk/ }));
    await fillDraft(user);
    await user.click(screen.getByRole('button', { name: 'Add line' }));
    expect(screen.getAllByRole('button', { name: 'Remove line' })[0]).toBeEnabled();

    // The operator closed the shift in the other tab; the receipt cannot be
    // written any more, so it cannot be edited any more either.
    shiftMock.mockReturnValue({ data: null, isPending: false, isError: false });
    await user.type(screen.getByLabelText('Receipt no.'), 'A');

    expect(screen.getAllByRole('button', { name: 'Remove line' })[0]).toBeDisabled();
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

    await user.click(screen.getByRole('button', { name: /Mariia Kovalchuk/ }));
    await user.type(screen.getByLabelText('Receipt no.'), '00412');
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
    await user.click(screen.getByRole('button', { name: /Mariia Kovalchuk/ }));

    const pallet = screen.getByLabelText('Pallet');
    expect(pallet).toHaveAttribute('aria-invalid', 'true');
    expect(pallet.getAttribute('aria-describedby')).toContain('items.0.pallet_kg-error');
    expect(screen.getByText('Enter a weight like 126.40')).toBeInTheDocument();
  });

  it('says so out loud when the refused field is on a line the editor no longer shows', async () => {
    const user = userEvent.setup();
    previewMock.mockReturnValue(SETTLED);

    renderReception();
    await user.click(screen.getByRole('button', { name: /Mariia Kovalchuk/ }));
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
    await user.type(screen.getByLabelText('Receipt no.'), 'A');

    expect(
      screen.getByText('The server refused one of the lines — check the rows in the table'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Accept' })).toBeDisabled();
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
    await user.click(screen.getByRole('button', { name: /Mariia Kovalchuk/ }));
    await fillDraft(user);

    await expectNoAxeViolations(container);
  });
});
