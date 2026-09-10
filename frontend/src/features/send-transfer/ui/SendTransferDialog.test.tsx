import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MockAdapter from 'axios-mock-adapter';
import { httpClient } from '@/shared/api';
import { SendTransferDialog } from './SendTransferDialog';

const SUBMIT = /submit|Відправити/i;

let mock: MockAdapter;
afterEach(() => mock?.restore());

function setup(onClose = () => {}) {
  mock = new MockAdapter(httpClient);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <SendTransferDialog pointId="p1" pointName="Шипинки" open onClose={onClose} />
    </QueryClientProvider>,
  );
  return { mock, queryClient };
}

describe('SendTransferDialog', () => {
  it('refuses a transfer that is neither money nor crates', async () => {
    // бекендовий CHK_transfers_not_empty: cash > 0 OR crates > 0
    setup();
    await userEvent.type(screen.getByLabelText(/перевізник|carrier/i), 'Петро');
    await userEvent.click(screen.getByRole('button', { name: SUBMIT }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('refuses to submit with no carrier at all', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: SUBMIT }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('sends the transfer once cash, crates and carrier are all valid', async () => {
    const onClose = () => {};
    setup(onClose);
    mock.onPost('/transfers').reply(201, { id: 't1' });

    await userEvent.clear(screen.getByLabelText(/готівка|cash/i));
    await userEvent.type(screen.getByLabelText(/готівка|cash/i), '50000');
    await userEvent.clear(screen.getByLabelText(/ящик|crate/i));
    await userEvent.type(screen.getByLabelText(/ящик|crate/i), '120');
    await userEvent.type(screen.getByLabelText(/перевізник|carrier/i), 'Петро');
    await userEvent.click(screen.getByRole('button', { name: SUBMIT }));

    await waitFor(() => expect(mock.history.post).toHaveLength(1));
    expect(JSON.parse(mock.history.post[0].data as string)).toEqual({
      collection_point_id: 'p1',
      cash: '50000',
      crates: 120,
      carrier: 'Петро',
    });
  });
});
