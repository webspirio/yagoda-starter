import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsPage } from './SettingsPage';

const { queryMock, mutateMock } = vi.hoisted(() => ({ queryMock: vi.fn(), mutateMock: vi.fn() }));

vi.mock('@/entities/network-settings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/entities/network-settings')>()),
  useNetworkSettingsQuery: () => queryMock(),
}));
vi.mock('../api/useUpdateNetworkSettingsMutation', () => ({
  useUpdateNetworkSettingsMutation: () => ({ mutateAsync: mutateMock, isPending: false }),
}));

const loaded = (receipt_note: string | null) => ({
  data: { receipt_note, updated_at: '2026-10-08T09:00:00.000Z' },
  isPending: false,
  isError: false,
});
const box = () => screen.getByRole('textbox', { name: 'Note on every receipt' });
const save = () => screen.getByRole('button', { name: 'Save' });

beforeEach(() => {
  queryMock.mockReset().mockReturnValue(loaded('Ящики до 20:00'));
  mutateMock
    .mockReset()
    .mockResolvedValue({ receipt_note: null, updated_at: '2026-10-08T10:00:00.000Z' });
});

describe('SettingsPage', () => {
  it('shows the saved note with Save disabled until it changes', () => {
    render(<SettingsPage />);
    expect(box()).toHaveValue('Ящики до 20:00');
    expect(save()).toBeDisabled();
  });

  it('sends the wrapped note', async () => {
    const user = userEvent.setup();
    queryMock.mockReturnValue(loaded(null));
    render(<SettingsPage />);

    await user.type(box(), `${'a'.repeat(30)} ${'b'.repeat(15)}`);
    await user.click(save());

    expect(mutateMock).toHaveBeenCalledWith({
      receipt_note: `${'a'.repeat(30)}\n${'b'.repeat(15)}`,
    });
  });

  it('sends null when the note is cleared', async () => {
    const user = userEvent.setup();
    render(<SettingsPage />);

    await user.clear(box());
    await user.click(save());

    expect(mutateMock).toHaveBeenCalledWith({ receipt_note: null });
  });

  it('keeps Save disabled for whitespace over an empty note', async () => {
    const user = userEvent.setup();
    queryMock.mockReturnValue(loaded(null));
    render(<SettingsPage />);

    await user.type(box(), '   ');
    expect(save()).toBeDisabled();
  });

  it('shows a banner when the save fails', async () => {
    const user = userEvent.setup();
    mutateMock.mockRejectedValue(new Error('network'));
    render(<SettingsPage />);

    await user.type(box(), '!');
    await user.click(save());

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save the settings');
  });

  it('says so when the settings fail to load', () => {
    queryMock.mockReturnValue({ data: undefined, isPending: false, isError: true });
    render(<SettingsPage />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});
