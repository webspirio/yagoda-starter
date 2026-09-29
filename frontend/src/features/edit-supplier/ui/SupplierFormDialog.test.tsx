import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expectNoAxeViolations } from '../../../test-axe';
import { SupplierFormDialog } from './SupplierFormDialog';
import type { Me } from '@/entities/user';

const { createMock, updateMock, meMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
  updateMock: vi.fn(),
  meMock: vi.fn(),
}));

vi.mock('../api/suppliers', () => ({
  useCreateSupplierMutation: () => createMock(),
  useUpdateSupplierMutation: () => updateMock(),
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

vi.mock('@/entities/user', () => ({
  useMeQuery: () => meMock(),
}));

const owner: Me = {
  id: 'u1',
  username: 'owner',
  display_name: 'Olena H.',
  avatar_url: null,
  language_code: null,
  role: 'network_owner',
  collection_point_id: null,
};

const operator: Me = {
  id: 'u2',
  username: 'maria',
  display_name: 'Maria S.',
  avatar_url: null,
  language_code: null,
  role: 'point_operator',
  collection_point_id: 'p1',
};

beforeEach(() => {
  createMock.mockReset().mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
  updateMock.mockReset().mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
  // An operator's point select never renders (it comes from their token), so
  // the create flow needs no point choice — matching the brief's `created`
  // fixture, whose collection_point_id ('p1') is the server-derived point.
  meMock.mockReset().mockReturnValue({ data: operator });
});

describe('SupplierFormDialog', () => {
  it('hands the created supplier to onCreated before closing', async () => {
    const created = {
      id: 's-new',
      first_name: 'Марія',
      last_name: 'Ковальчук',
      kind: 'none',
      phone: null,
      note: null,
      is_active: true,
      collection_point_id: 'p1',
      created_at: '',
    };
    createMock.mockReturnValue({ mutateAsync: vi.fn().mockResolvedValue(created), isPending: false });
    const onCreated = vi.fn();
    const onClose = vi.fn();
    render(<SupplierFormDialog supplier={null} open onClose={onClose} onCreated={onCreated} />);
    await userEvent.type(screen.getByLabelText(/Ім'я|First name/), 'Марія');
    await userEvent.type(screen.getByLabelText(/Прізвище|Last name/), 'Ковальчук');
    await userEvent.click(screen.getByRole('button', { name: /Зберегти|Save/ }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(created));
    expect(onClose).toHaveBeenCalled();
  });

  it('pre-selects defaultPointId in the owner point select on create', async () => {
    meMock.mockReturnValue({ data: owner });
    render(<SupplierFormDialog supplier={null} open onClose={vi.fn()} defaultPointId="p2" />);
    expect(screen.getByLabelText('Collection point')).toHaveValue('p2');
  });

  it('is axe-clean', async () => {
    const { container } = render(<SupplierFormDialog supplier={null} open onClose={vi.fn()} />);
    await expectNoAxeViolations(container);
  });
});
