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
  // Mirrors the real SupplierFormDialog's two exits: submitting fires
  // onCreated THEN onClose (so a test can exercise the focus-restore wiring
  // that depends on the create path reaching onClose too), while Cancel
  // fires ONLY onClose — the path review finding 2 needs to reach the
  // footer's own close without ever picking a supplier.
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
      <>
        <button
          onClick={() => {
            onCreated?.(nina);
            onClose?.();
          }}
        >
          create-nina
        </button>
        <button onClick={() => onClose?.()}>cancel-dialog</button>
      </>
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

  it('the footer button resets search too — search, open the dialog, cancel, reopen shows an empty search', async () => {
    const user = userEvent.setup();
    render(<SupplierPicker pointId="p1" ownerMode={false} value={null} onChange={vi.fn()} />);
    await user.click(screen.getByRole('combobox'));
    await user.type(screen.getByRole('searchbox'), 'Пет');
    await user.click(screen.getByRole('button', { name: /Додати нового|Add a new/ }));
    // The real SupplierFormDialog is mocked in this file — trigger its
    // onClose (Cancel), not onCreated, so nothing is picked.
    await user.click(screen.getByText('cancel-dialog'));

    await user.click(screen.getByRole('combobox'));
    expect(screen.getByRole('searchbox')).toHaveValue('');
  });

  it('aria-controls is present only while the listbox is mounted (M7)', async () => {
    render(<SupplierPicker pointId="p1" ownerMode={false} value={null} onChange={vi.fn()} />);
    const trigger = screen.getByRole('combobox');
    expect(trigger).not.toHaveAttribute('aria-controls');

    await userEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-controls', screen.getByRole('listbox').id);

    await userEvent.click(trigger);
    expect(trigger).not.toHaveAttribute('aria-controls');
  });

  it('ArrowDown on the closed trigger opens the list and highlights the first option (M7)', async () => {
    const user = userEvent.setup();
    render(<SupplierPicker pointId="p1" ownerMode={false} value={null} onChange={vi.fn()} />);
    screen.getByRole('combobox').focus();
    await user.keyboard('{ArrowDown}');

    expect(screen.getByRole('combobox')).toHaveAttribute('aria-expanded', 'true');
    const firstOption = within(screen.getByRole('listbox')).getAllByRole('option')[0];
    expect(screen.getByRole('searchbox')).toHaveAttribute('aria-activedescendant', firstOption.id);
  });

  it('ArrowUp on the closed trigger opens the list and highlights the last option (M7)', async () => {
    const user = userEvent.setup();
    render(<SupplierPicker pointId="p1" ownerMode={false} value={null} onChange={vi.fn()} />);
    screen.getByRole('combobox').focus();
    await user.keyboard('{ArrowUp}');

    expect(screen.getByRole('combobox')).toHaveAttribute('aria-expanded', 'true');
    const options = within(screen.getByRole('listbox')).getAllByRole('option');
    expect(screen.getByRole('searchbox')).toHaveAttribute(
      'aria-activedescendant',
      options[options.length - 1].id,
    );
  });

  it('ArrowUp on the closed trigger resolves to the last row once the list actually arrives, even if it was still empty at keydown (review finding 3)', async () => {
    const user = userEvent.setup();
    // Simulates the up-to-300ms window where `flat` is still empty — e.g. a
    // debounce that hasn't caught up to a just-reset search — at the moment
    // ArrowUp is pressed. The highlight must resolve once real rows exist,
    // not stay pinned (or blank) at whatever `flat.length` was at keydown.
    suppliersMock.mockReturnValue({ data: { data: [], total: 0 }, isPending: true });
    const { rerender } = render(
      <SupplierPicker pointId="p1" ownerMode={false} value={null} onChange={vi.fn()} />,
    );
    screen.getByRole('combobox').focus();
    await user.keyboard('{ArrowUp}');
    expect(screen.getByRole('combobox')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('searchbox')).not.toHaveAttribute('aria-activedescendant');

    // The debounce catches up and the real list lands.
    suppliersMock.mockReturnValue({ data: { data: [nina, vasyl], total: 2 }, isPending: false });
    rerender(<SupplierPicker pointId="p1" ownerMode={false} value={null} onChange={vi.fn()} />);

    const options = within(screen.getByRole('listbox')).getAllByRole('option');
    expect(screen.getByRole('searchbox')).toHaveAttribute(
      'aria-activedescendant',
      options[options.length - 1].id,
    );
  });

  it('closing forgets the search — Escape resets it so a reopen starts clean (M7)', async () => {
    const user = userEvent.setup();
    render(<SupplierPicker pointId="p1" ownerMode={false} value={null} onChange={vi.fn()} />);
    await user.click(screen.getByRole('combobox'));
    await user.type(screen.getByRole('searchbox'), 'zzz');
    expect(screen.getByRole('searchbox')).toHaveValue('zzz');

    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('combobox'));
    expect(screen.getByRole('searchbox')).toHaveValue('');
  });

  it('Escape closes the list and restores focus to the trigger (M10)', async () => {
    const user = userEvent.setup();
    render(<SupplierPicker pointId="p1" ownerMode={false} value={null} onChange={vi.fn()} />);
    await user.click(screen.getByRole('combobox'));
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(screen.getByRole('combobox')).toHaveFocus();
  });

  it('a click outside closes the list without picking anything (M10)', async () => {
    const onChange = vi.fn();
    render(
      <div>
        <SupplierPicker pointId="p1" ownerMode={false} value={null} onChange={onChange} />
        <button type="button">outside</button>
      </div>,
    );
    await userEvent.click(screen.getByRole('combobox'));
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'outside' }));
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('owner mode: ArrowDown walks across the group boundary and Enter picks from the second group (M10)', async () => {
    const onChange = vi.fn();
    render(<SupplierPicker pointId="p1" ownerMode value={null} onChange={onChange} />);
    await userEvent.click(screen.getByRole('combobox'));
    // home = [nina] (1 row), others = [vasyl] — the SECOND ArrowDown must
    // cross the group boundary onto `others[0]` (flat index home.length + 0).
    // `onChange` alone doesn't travel through the `home.length + i` offset —
    // it only proves Enter picks whatever IS highlighted, not that the
    // highlight itself landed on the right row. So pin the VISIBLE cursor
    // (the `bg-muted` class) and `aria-activedescendant` together at each
    // step, across the group boundary.
    const ninaOption = screen.getByRole('option', { name: /Ніна/ });
    const vasylOption = screen.getByRole('option', { name: /Василь/ });
    const searchbox = screen.getByRole('searchbox');

    await userEvent.keyboard('{ArrowDown}');
    expect(ninaOption).toHaveClass('bg-muted');
    expect(vasylOption).not.toHaveClass('bg-muted');
    expect(searchbox).toHaveAttribute('aria-activedescendant', ninaOption.id);

    await userEvent.keyboard('{ArrowDown}');
    expect(vasylOption).toHaveClass('bg-muted');
    expect(ninaOption).not.toHaveClass('bg-muted');
    expect(searchbox).toHaveAttribute('aria-activedescendant', vasylOption.id);

    await userEvent.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledWith(vasyl);
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
