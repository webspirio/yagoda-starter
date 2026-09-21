import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MockAdapter from 'axios-mock-adapter';
import type { ReactNode } from 'react';
import { ApiError, httpClient } from '@/shared/api';
import { CountDrawerDialog } from './CountDrawerDialog';

// Matches the submit button whether i18n has resolved it yet (raw key), is
// showing the Ukrainian copy, or the English one this suite's locale renders.
const SUBMIT_COUNT = /day\.count\.submit|Записати|Record/i;

let mock: MockAdapter;
let queryClient: QueryClient;

beforeEach(() => {
  mock = new MockAdapter(httpClient);
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => mock.restore());

const wrap = (node: ReactNode) => (
  <QueryClientProvider client={queryClient}>{node}</QueryClientProvider>
);

function setup(onConfirm = vi.fn().mockResolvedValue(undefined), mode: 'open' | 'close' = 'open') {
  render(
    wrap(
      <CountDrawerDialog
        mode={mode}
        shiftId={mode === 'close' ? 's1' : null}
        open
        onClose={() => {}}
        onConfirm={onConfirm}
      />,
    ),
  );
  return onConfirm;
}

/** The drawer-count field, which every mode has. Close mode has a second
 *  textbox (the breakage), so `getByRole('textbox')` is ambiguous there. */
const amountBox = () => screen.getByRole('textbox', { name: /drawer|шухляд|amount/i });
const brokenBox = () => screen.getByRole('textbox', { name: /broken|бій/i });

describe('CountDrawerDialog', () => {
  it('sends the amount normalised — a comma is how the keyboard types it', async () => {
    const onConfirm = setup();
    await userEvent.type(screen.getByRole('textbox'), '1 500,50');
    await userEvent.click(screen.getByRole('button', { name: SUBMIT_COUNT }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith('1500.50', null));
  });

  it('refuses to submit an empty drawer count', async () => {
    const onConfirm = setup();
    await userEvent.click(screen.getByRole('button', { name: SUBMIT_COUNT }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('never shows an expected figure — the count is a control, not a form to match', () => {
    setup();
    expect(screen.queryByText(/очікув|expected/i)).toBeNull();
  });

  it('shows the close-specific copy in close mode', () => {
    setup(undefined, 'close');
    expect(screen.getByText('Count the drawer before closing')).toBeInTheDocument();
  });

  it('shows the refusal and stays open when onConfirm rejects', async () => {
    const onConfirm = vi
      .fn()
      .mockRejectedValue(new ApiError(409, 'nope', undefined, 'SHIFT_ALREADY_OPEN'));
    const onClose = vi.fn();
    render(
      wrap(
        <CountDrawerDialog
          mode="open"
          shiftId={null}
          open
          onClose={onClose}
          onConfirm={onConfirm}
        />,
      ),
    );

    await userEvent.type(screen.getByRole('textbox'), '1500.00');
    await userEvent.click(screen.getByRole('button', { name: SUBMIT_COUNT }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A shift is already open at this point',
    );
    // Stays open: the caller was never told to close it, and the typed
    // amount — the one thing worth not losing on a refusal — is still there.
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox')).toHaveValue('1500.00');
  });

  it('clears a stale server banner as soon as the next submit is attempted', async () => {
    const onConfirm = vi
      .fn()
      .mockRejectedValue(new ApiError(409, 'nope', undefined, 'SHIFT_ALREADY_OPEN'));
    render(
      wrap(
        <CountDrawerDialog
          mode="open"
          shiftId={null}
          open
          onClose={() => {}}
          onConfirm={onConfirm}
        />,
      ),
    );

    await userEvent.type(screen.getByRole('textbox'), '1500.00');
    await userEvent.click(screen.getByRole('button', { name: SUBMIT_COUNT }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A shift is already open at this point',
    );

    // A later submit that never reaches `onConfirm` — client validation
    // refuses it first — must not leave the stale server banner standing
    // alongside the new field error.
    await userEvent.clear(screen.getByRole('textbox'));
    await userEvent.type(screen.getByRole('textbox'), '1.234');
    await userEvent.click(screen.getByRole('button', { name: SUBMIT_COUNT }));

    await waitFor(() =>
      expect(screen.queryByText('A shift is already open at this point')).toBeNull(),
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Enter an amount — at most two decimals',
    );
  });

  it('asks for the breakage in close mode, and not in open mode', async () => {
    setup(undefined, 'close');
    expect(brokenBox()).toBeInTheDocument();
  });

  it('never asks for a breakage when opening a shift — nothing has broken yet', () => {
    setup();
    expect(screen.queryByRole('textbox', { name: /broken|бій/i })).toBeNull();
  });

  it('refuses to close with the breakage left blank', async () => {
    mock.onGet('/shifts/s1/crates').reply(200, { with_berry: 142, broken: null, dispatched: null });
    const onConfirm = setup(vi.fn().mockResolvedValue(undefined), 'close');

    await userEvent.type(amountBox(), '980.40');
    await userEvent.click(screen.getByRole('button', { name: SUBMIT_COUNT }));

    // «А number that can be skipped gets skipped» — the field starts EMPTY, never
    // pre-filled with 0, so closing is a claim the operator actually made.
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('passes a zero breakage through as 0, not as null or a dropped field', async () => {
    mock.onGet('/shifts/s1/crates').reply(200, { with_berry: 142, broken: null, dispatched: null });
    const onConfirm = setup(vi.fn().mockResolvedValue(undefined), 'close');

    await userEvent.type(amountBox(), '980.40');
    await userEvent.type(brokenBox(), '0');
    await userEvent.click(screen.getByRole('button', { name: SUBMIT_COUNT }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith('980.40', 0));
  });

  it('shows §6.8’s three numbers and adds the breakage as it is typed', async () => {
    mock.onGet('/shifts/s1/crates').reply(200, { with_berry: 142, broken: null, dispatched: null });
    setup(undefined, 'close');

    expect(await screen.findByText('142')).toBeInTheDocument();

    await userEvent.type(brokenBox(), '3');
    // «Відвантажено» is computed here, not fetched: the endpoint returns
    // `dispatched: null` while the shift is open, which is right for it and
    // useless to a form being filled in.
    await waitFor(() => expect(screen.getByText('145')).toBeInTheDocument());
  });

  it('still closes when the crate read fails — a derived number cannot hold the drawer hostage', async () => {
    mock.onGet('/shifts/s1/crates').reply(500);
    const onConfirm = setup(vi.fn().mockResolvedValue(undefined), 'close');

    await userEvent.type(amountBox(), '980.40');
    await userEvent.type(brokenBox(), '2');
    await userEvent.click(screen.getByRole('button', { name: SUBMIT_COUNT }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith('980.40', 2));
  });
});
