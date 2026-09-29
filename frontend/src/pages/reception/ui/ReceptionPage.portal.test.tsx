import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MockAdapter from 'axios-mock-adapter';
import { httpClient } from '@/shared/api';
import type { Supplier } from '@/entities/supplier';
import { SupplierPicker } from '@/features/pick-supplier';
import { isOwnFormEvent } from '../lib/formEventGuards';

/**
 * Finding C1 (whole-branch review): `SupplierFormDialog` (opened inline from
 * `SupplierPicker`'s «Додати нового постачальника» footer) is portaled to
 * `document.body` by `shared/ui/dialog.tsx`'s `DialogContent`, but it is
 * still a REACT-TREE descendant of whatever `<form>` renders `SupplierPicker`
 * — on the real screen, `ReceptionPage`'s own `<form>`. React bubbles
 * `submit`/`keydown` along that fiber tree regardless of the DOM, so without
 * a guard the dialog's own submit reaches the outer form's `onSubmit` (a real
 * `POST /intakes` nobody asked for) and its Enter keystrokes reach the outer
 * form's Enter guard.
 *
 * This suite mounts the REAL `SupplierPicker` and the REAL `SupplierFormDialog`
 * — nothing here stands in for either — inside a bare harness form that
 * applies the SAME guard (`isOwnFormEvent`) the page's own form now uses.
 * Only the entity reads and the create mutation's HTTP call are stubbed.
 */

const { suppliersMock, balancesMock } = vi.hoisted(() => ({
  suppliersMock: vi.fn(),
  balancesMock: vi.fn(),
}));

vi.mock('@/entities/supplier', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/entities/supplier')>()),
  useSuppliersQuery: (...args: unknown[]) => suppliersMock(...args),
  useSupplierBalancesQuery: () => balancesMock(),
}));

vi.mock('@/entities/collection-point', () => ({
  usePointOptionsQuery: () => ({
    data: [{ id: 'p1', name: 'Shypynky' }],
    isPending: false,
    isError: false,
  }),
}));

vi.mock('@/entities/user', () => ({
  // An operator: `SupplierFormDialog` skips the point select entirely, so
  // filling the dialog needs only the two name fields.
  useMeQuery: () => ({
    data: {
      id: 'u1',
      username: 'operator',
      display_name: 'Olha',
      role: 'point_operator',
      collection_point_id: 'p1',
    },
  }),
}));

const created: Supplier = {
  id: 's-new',
  collection_point_id: 'p1',
  first_name: 'Марія',
  last_name: 'Ковальчук',
  phone: null,
  note: null,
  kind: 'none',
  is_active: true,
  created_at: '',
};

let mock: MockAdapter;

beforeEach(() => {
  mock = new MockAdapter(httpClient);
  mock.onPost('/suppliers').reply(201, created);
  suppliersMock.mockReset().mockReturnValue({ data: { data: [], total: 0 }, isPending: false });
  balancesMock.mockReset().mockReturnValue({ data: { data: [], total: 0 } });
});

afterEach(() => mock.restore());

/**
 * The page's own harness: a `<form>` around `SupplierPicker`, guarded the
 * same way `ReceptionPage`'s form is — the guard is what THIS suite proves,
 * not something it assumes.
 */
function Harness({ onSubmitSpy }: { onSubmitSpy: () => void }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <form
        onSubmit={(e) => {
          if (!isOwnFormEvent(e)) return;
          e.preventDefault();
          onSubmitSpy();
        }}
        onKeyDown={(e) => {
          if (!isOwnFormEvent(e)) return;
          // Mirrors the page's own Enter guard while the form is not ready to
          // submit — the exact condition under which a stray Enter used to
          // get swallowed even though it was typed into the DIALOG, not this
          // form.
          if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') {
            e.preventDefault();
          }
        }}
      >
        <SupplierPicker pointId="p1" ownerMode={false} value={null} onChange={() => {}} />
      </form>
    </QueryClientProvider>
  );
}

describe('a portaled SupplierFormDialog inside the reception form', () => {
  it("never bubbles the dialog's submit into the outer form, though the create call still fires", async () => {
    const user = userEvent.setup();
    const onSubmitSpy = vi.fn();
    render(<Harness onSubmitSpy={onSubmitSpy} />);

    await user.click(screen.getByRole('combobox'));
    await user.click(screen.getByRole('button', { name: /Додати нового|Add a new/ }));
    await user.type(screen.getByLabelText(/Ім'я|First name/), 'Марія');
    await user.type(screen.getByLabelText(/Прізвище|Last name/), 'Ковальчук');
    await user.click(screen.getByRole('button', { name: /Зберегти|Save/ }));

    await waitFor(() => expect(mock.history.post).toHaveLength(1));
    expect(mock.history.post[0].url).toBe('/suppliers');
    expect(onSubmitSpy).not.toHaveBeenCalled();
  });

  it("never lets the outer form's Enter guard swallow a keystroke typed into the dialog", async () => {
    const user = userEvent.setup();
    const onSubmitSpy = vi.fn();
    render(<Harness onSubmitSpy={onSubmitSpy} />);

    await user.click(screen.getByRole('combobox'));
    await user.click(screen.getByRole('button', { name: /Додати нового|Add a new/ }));

    const firstNameInput = screen.getByLabelText(/Ім'я|First name/);
    const enterEvent = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    // `dispatchEvent` returns false exactly when a listener called
    // `preventDefault()` — true here is the direct proof the outer form's
    // guard did NOT fire for an event that belongs to the portaled dialog.
    expect(firstNameInput.dispatchEvent(enterEvent)).toBe(true);
  });
});
