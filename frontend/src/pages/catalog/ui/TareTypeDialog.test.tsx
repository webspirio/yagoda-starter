import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { i18n } from '@/shared/lib/i18n';
import uk from '@/shared/lib/i18n/locales/uk.json';
import { TareTypeDialog } from './TareTypeDialog';
import type { TareType } from '../model/tareType';

const { createMock, updateMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
  updateMock: vi.fn(),
}));

vi.mock('../api/tareTypes', () => ({
  useCreateTareTypeMutation: () => ({ mutateAsync: createMock }),
  useUpdateTareTypeMutation: () => ({ mutateAsync: updateMock }),
}));
vi.mock('@/shared/ui/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const crate: TareType = {
  id: 't1',
  name: 'Ящик',
  weight_kg: '1.20',
  deposit_price: '150.00',
  is_crate: true,
  is_active: true,
  created_at: '2026-09-01T08:00:00.000Z',
};

beforeEach(async () => {
  createMock.mockReset().mockResolvedValue({});
  updateMock.mockReset().mockResolvedValue({});
  await act(() => i18n.changeLanguage('uk'));
});
afterEach(async () => {
  await act(() => i18n.changeLanguage('en'));
});

describe('TareTypeDialog — the prefill reads in the locale, the API gets the canonical form', () => {
  it('shows the weight and the deposit with the decimal comma', () => {
    render(<TareTypeDialog tareType={crate} open onClose={vi.fn()} />);
    expect(screen.getByLabelText(uk.catalog.tareTypes.form.weight)).toHaveValue('1,20');
    expect(screen.getByLabelText(uk.catalog.tareTypes.form.deposit)).toHaveValue('150,00');
  });

  it('an untouched save sends «1.20» and «150.00»', async () => {
    const onClose = vi.fn();
    render(<TareTypeDialog tareType={crate} open onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: uk.common.save }));

    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(1));
    expect(updateMock).toHaveBeenCalledWith({
      id: 't1',
      name: 'Ящик',
      weight_kg: '1.20',
      deposit_price: '150.00',
      is_crate: true,
      is_active: true,
    });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('a new tare type starts blank', () => {
    render(<TareTypeDialog tareType={null} open onClose={vi.fn()} />);
    expect(screen.getByLabelText(uk.catalog.tareTypes.form.weight)).toHaveValue('');
    expect(screen.getByLabelText(uk.catalog.tareTypes.form.deposit)).toHaveValue('');
  });
});
