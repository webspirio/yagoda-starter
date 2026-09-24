import type { ComponentProps } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MockAdapter from 'axios-mock-adapter';
import { httpClient, attachAuthInterceptors } from '@/shared/api';
import type { Shift } from '@/entities/shift';
import { OpenShiftAlert } from './OpenShiftAlert';

// Without this, a mocked 404 surfaces as a plain AxiosError rather than the
// ApiError `useCurrentShiftQuery`'s 404-as-null branch checks for, and a
// refused close would never reach `apiErrorToBanner`'s code map. Attached
// once at module scope so it is never stacked on the shared httpClient
// singleton (`attachAuthInterceptors` is a set, not an add).
attachAuthInterceptors(httpClient, { getToken: () => null, onUnauthorized: () => {} });

// Matches the CountDrawerDialog's submit button whether i18n has resolved it
// yet (raw key), is showing the Ukrainian copy, or the English one this
// suite's locale renders.
const SUBMIT_COUNT = /day\.count\.submit|Записати|Record/i;

const { meMock } = vi.hoisted(() => ({ meMock: vi.fn() }));

vi.mock('@/entities/user', () => ({
  useMeQuery: () => meMock(),
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

/** An open shift five days behind TODAY — #114's whole subject. */
const staleShift: Shift = {
  id: 's-stale',
  collection_point_id: 'p1',
  business_date: '2026-09-08',
  status: 'open',
  opened_by_user_id: 'u1',
  opened_by_name: null,
  closed_by_user_id: null,
  closed_by_name: null,
  closed_at: null,
  created_at: '2026-09-08T05:00:00Z',
  explanation: null,
  broken_crates: null,
};

/** Today's own shift, perfectly healthy — the operator is simply looking at
 *  some other day. Nothing is stale about it and nothing may nag about it. */
const todaysShift: Shift = {
  ...staleShift,
  id: 's-today',
  business_date: '2026-09-13',
  created_at: '2026-09-13T05:00:00Z',
};

let mock: MockAdapter;

beforeEach(() => {
  // Only Date is faked, so testing-library's waitFor and user-event keep their
  // real timers. «Today» is 2026-09-13, which is what `todayIso()` reads — and
  // what «earlier than today» is now measured against.
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-09-13T09:00:00') });
  mock = new MockAdapter(httpClient);
  mock.onGet('/shifts/current').reply(200, staleShift);
  mock
    .onGet('/shifts/s-stale/crates')
    .reply(200, { with_berry: 12, broken: null, dispatched: null });
  mock.onPost('/shifts/s-stale/close').reply(200, { ...staleShift, status: 'closed' });
  meMock.mockReset().mockReturnValue({ data: OPERATOR });
});

afterEach(() => {
  mock.restore();
  vi.useRealTimers();
});

function renderAlert(props: Partial<ComponentProps<typeof OpenShiftAlert>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <OpenShiftAlert pointId="p1" viewedDate="2026-09-13" {...props} />
    </QueryClientProvider>,
  );
}

const TITLE = /The shift for September 8, 2026 is not closed yet/;

describe('OpenShiftAlert — when it speaks at all', () => {
  it('names the open shift when it was left behind on an EARLIER day', async () => {
    renderAlert();
    expect(await screen.findByText(TITLE)).toBeInTheDocument();
  });

  it('stays silent about today’s own shift, whatever day the screen is showing', async () => {
    // The alert asks «is this shift stale?», not «is this shift elsewhere?».
    // Browsing back through the week while today's shift is legitimately open
    // is not a problem to warn about — and the first cut of this rule did.
    mock.onGet('/shifts/current').reply(200, todaysShift);
    renderAlert({ viewedDate: '2026-09-10' });
    await waitFor(() => expect(mock.history.get.length).toBeGreaterThan(0));
    expect(screen.queryByText(/is not closed yet/)).toBeNull();
  });

  it('stays silent when the stale shift IS the day on screen — the toolbar closes it there', async () => {
    renderAlert({ viewedDate: '2026-09-08' });
    // The read has to settle before «nothing rendered» means anything.
    await waitFor(() => expect(mock.history.get.length).toBeGreaterThan(0));
    expect(screen.queryByText(TITLE)).toBeNull();
  });

  it('stays silent when no shift is open anywhere', async () => {
    // 404 is «none open», not a failure — `useCurrentShiftQuery` folds it to null.
    mock.onGet('/shifts/current').reply(404);
    renderAlert();
    await waitFor(() => expect(mock.history.get.length).toBeGreaterThan(0));
    expect(screen.queryByText(TITLE)).toBeNull();
  });
});

describe('OpenShiftAlert — closing in place', () => {
  it('closes the stale shift without leaving the screen', async () => {
    const user = userEvent.setup();
    renderAlert();

    await user.click(await screen.findByRole('button', { name: 'Close shift' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByRole('textbox', { name: /drawer|amount/i }), '980.40');
    await user.type(within(dialog).getByRole('textbox', { name: /broken/i }), '3');
    await user.click(within(dialog).getByRole('button', { name: SUBMIT_COUNT }));

    await waitFor(() => expect(mock.history.post).toHaveLength(1));
    expect(mock.history.post[0].url).toBe('/shifts/s-stale/close');
    expect(JSON.parse(mock.history.post[0].data as string)).toEqual({
      counted_amount: '980.40',
      broken_crates: 3,
    });
  });

  it('keeps the refusal inside the dialog instead of dropping the alert', async () => {
    const user = userEvent.setup();
    mock
      .onPost('/shifts/s-stale/close')
      .reply(409, { code: 'SHIFT_ALREADY_CLOSED', message: 'nope' });
    renderAlert();

    await user.click(await screen.findByRole('button', { name: 'Close shift' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByRole('textbox', { name: /drawer|amount/i }), '980.40');
    await user.type(within(dialog).getByRole('textbox', { name: /broken/i }), '0');
    await user.click(within(dialog).getByRole('button', { name: SUBMIT_COUNT }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('The shift is not open');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

describe('OpenShiftAlert — the owner', () => {
  it('is told about the shift but is not offered the operator’s action (§10.3)', async () => {
    meMock.mockReturnValue({ data: OWNER });
    renderAlert();

    expect(await screen.findByText(TITLE)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Close shift' })).toBeNull();
  });
});

describe('OpenShiftAlert — the way to that day', () => {
  it('hands the shift’s own business date back to whoever knows how to navigate', async () => {
    const user = userEvent.setup();
    const onGoToDate = vi.fn();
    renderAlert({ onGoToDate });

    await user.click(await screen.findByRole('button', { name: 'Go to that day' }));
    expect(onGoToDate).toHaveBeenCalledWith('2026-09-08');
  });

  it('offers no such button when the screen has nowhere to send anyone', async () => {
    renderAlert();
    expect(await screen.findByText(TITLE)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Go to that day' })).toBeNull();
  });
});
