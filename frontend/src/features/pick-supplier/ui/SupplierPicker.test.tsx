import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expectNoAxeViolations } from '../../../test-axe';
import type { Supplier } from '@/entities/supplier';
import { SupplierPicker } from './SupplierPicker';

const { suppliersMock, balancesMock } = vi.hoisted(() => ({ suppliersMock: vi.fn(), balancesMock: vi.fn() }));
vi.mock('@/entities/supplier', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/entities/supplier')>()),
  useSuppliersQuery: (...args: unknown[]) => suppliersMock(...args),
  useSupplierBalancesQuery: () => balancesMock(),
}));
vi.mock('@/features/edit-supplier', () => ({
  // Mirrors the real SupplierFormDialog's submit handler: onCreated fires,
  // THEN onClose — so a test can exercise the focus-restore wiring that
  // depends on the create path reaching onClose too.
  SupplierFormDialog: ({
    open,
    onCreated,
    onClose,
  }: {
    open: boolean;
    onCreated?: (s: unknown) => void;
    onClose?: () => void;
  }) =>
    open ? (
      <button
        onClick={() => {
          onCreated?.(nina);
          onClose?.();
        }}
      >
        create-nina
      </button>
    ) : null,
}));

const nina: Supplier = { id: 's1', collection_point_id: 'p1', first_name: 'Ніна', last_name: 'Ільчук', phone: '+380671000003', note: null, kind: 'wholesale', is_active: true, created_at: '' };
const vasyl: Supplier = { id: 's2', collection_point_id: 'p2', first_name: 'Василь', last_name: 'Яремчук', phone: null, note: null, kind: 'none', is_active: true, created_at: '' };

beforeEach(() => {
  suppliersMock.mockReturnValue({ data: { data: [nina, vasyl], total: 2 }, isPending: false });
  balancesMock.mockReturnValue({ data: { data: [{ supplier_id: 's1', debt: '10944.00', first_name: 'Ніна', last_name: 'Ільчук', is_active: true, collection_point_id: 'p1' }], total: 1 } });
});

describe('SupplierPicker', () => {
  it('opens on click, lists people with badge, phone and balance, picks with Enter', async () => {
    const onChange = vi.fn();
    render(<SupplierPicker pointId="p1" ownerMode={false} value={null} onChange={onChange} />);
    await userEvent.click(screen.getByRole('combobox'));
    const list = screen.getByRole('listbox');
    expect(within(list).getByText('Ніна Ільчук')).toBeInTheDocument();
    // Money formatting follows i18n's resolved language, which test-setup pins to
    // English — so the actual separators are en's (comma group, dot decimal), not
    // uk's (space group, comma decimal). Both alternatives are kept so the test
    // still passes if a future change reads locale differently.
    expect(within(list).getByText(/10.944,00|10,944\.00/)).toBeInTheDocument();
    expect(within(list).getByText(/телефон не вказано|no phone/)).toBeInTheDocument();
    await userEvent.keyboard('{ArrowDown}{Enter}');
    expect(onChange).toHaveBeenCalledWith(nina);
  });

  it('filters by the search box and shows the empty row', async () => {
    suppliersMock.mockReturnValue({ data: { data: [], total: 0 }, isPending: false });
    render(<SupplierPicker pointId="p1" ownerMode={false} value={null} onChange={vi.fn()} />);
    await userEvent.click(screen.getByRole('combobox'));
    const list = screen.getByRole('listbox');
    expect(within(list).getByText(/Нікого не знайшли|Nobody found/)).toBeInTheDocument();
    await userEvent.type(screen.getByRole('searchbox'), 'zzz');
    // useSuppliersQuery is called with the DEBOUNCED search value (useDebouncedValue's
    // default delay), so the last call only settles after that timer fires.
    await waitFor(() => {
      expect(suppliersMock).toHaveBeenLastCalledWith('zzz', 'p1');
    });
  });

  it('groups by point for the owner', async () => {
    render(<SupplierPicker pointId="p1" ownerMode value={null} onChange={vi.fn()} />);
    await userEvent.click(screen.getByRole('combobox'));
    const ourPoint = screen.getByRole('group', { name: /Наша точка|Our point/ });
    const otherPoints = screen.getByRole('group', { name: /Інші точки|Other points/ });
    expect(within(ourPoint).getByText('Ніна Ільчук')).toBeInTheDocument();
    expect(within(otherPoints).getByText('Василь Яремчук')).toBeInTheDocument();
  });

  it('shows the §2.11 hint for a wholesaler, without any bounds', () => {
    render(<SupplierPicker pointId="p1" ownerMode={false} value={nina} onChange={vi.fn()} />);
    expect(screen.getByText(/Це оптовик|wholesaler/)).toBeInTheDocument();
    expect(screen.queryByText(/₴\/кг|Межі/)).not.toBeInTheDocument();
  });

  it('creates a person inline and picks them', async () => {
    const onChange = vi.fn();
    render(<SupplierPicker pointId="p1" ownerMode={false} value={null} onChange={onChange} />);
    await userEvent.click(screen.getByRole('combobox'));
    await userEvent.click(screen.getByRole('button', { name: /Додати нового|Add a new/ }));
    await userEvent.click(screen.getByText('create-nina'));
    expect(onChange).toHaveBeenCalledWith(nina);
    // The dialog's own focus-restore (onClose) must not leave focus stranded
    // on document.body — the trigger gets it back.
    await waitFor(() => {
      expect(screen.getByRole('combobox')).toHaveFocus();
    });
  });

  it('has no axe violations open', async () => {
    const { container } = render(<SupplierPicker pointId="p1" ownerMode={false} value={null} onChange={vi.fn()} />);
    await userEvent.click(screen.getByRole('combobox'));
    await expectNoAxeViolations(container);
  });

  it('has no axe violations open in OWNER mode, with the grouped listbox rendered (M8)', async () => {
    // The owner's own tree is a step deeper than the plain listbox above:
    // `ul[role=listbox] > li[role=presentation] > ul[role=group] > li[role=option]`
    // — worth its own axe pass rather than assuming the flat tree's result
    // covers it.
    const { container } = render(
      <SupplierPicker pointId="p1" ownerMode value={null} onChange={vi.fn()} />,
    );
    await userEvent.click(screen.getByRole('combobox'));
    expect(screen.getByRole('group', { name: /Наша точка|Our point/ })).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });
});
