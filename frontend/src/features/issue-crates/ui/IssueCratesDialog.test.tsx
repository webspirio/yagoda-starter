import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '@/shared/api';
import { IssueCratesDialog } from './IssueCratesDialog';

const { issueMock, suppliersMock } = vi.hoisted(() => ({
  issueMock: vi.fn(),
  suppliersMock: vi.fn(),
}));

vi.mock('../api/useIssueCrates', () => ({
  useIssueCratesMutation: () => ({ mutateAsync: issueMock }),
}));

vi.mock('@/entities/supplier', () => ({
  useSuppliersQuery: () => suppliersMock(),
  supplierName: (s: { first_name: string; last_name: string }) =>
    `${s.first_name} ${s.last_name}`,
}));

const open = (pointId?: string) =>
  render(<IssueCratesDialog pointId={pointId} open onClose={() => {}} />);

beforeEach(() => {
  vi.clearAllMocks();
  suppliersMock.mockReturnValue({
    data: { data: [{ id: 's1', first_name: 'Василь', last_name: 'Яремчук' }], total: 1 },
    isPending: false,
    isError: false,
  });
  issueMock.mockResolvedValue({});
});

describe('IssueCratesDialog', () => {
  it('sends the person, a whole number of crates and the mode', async () => {
    const user = userEvent.setup();
    open();

    await user.selectOptions(screen.getByLabelText('Person'), 's1');
    await user.type(screen.getByLabelText('Crates'), '20');
    await user.click(screen.getByRole('button', { name: /^issue$/i }));

    await waitFor(() => expect(issueMock).toHaveBeenCalledTimes(1));
    expect(issueMock).toHaveBeenCalledWith({ supplier_id: 's1', units: 20, mode: 'deposit' });
  });

  it('carries the point an OWNER picked, since they have none of their own', async () => {
    const user = userEvent.setup();
    open('p1');

    await user.selectOptions(screen.getByLabelText('Person'), 's1');
    await user.type(screen.getByLabelText('Crates'), '5');
    await user.click(screen.getByRole('button', { name: /^issue$/i }));

    await waitFor(() => expect(issueMock).toHaveBeenCalledTimes(1));
    expect(issueMock.mock.calls[0][0].collection_point_id).toBe('p1');
  });

  /**
   * §6.4 — «різниця лише в грошах». An operator who does not know which mode
   * they are choosing is choosing whether the network is covered, so the
   * consequence is spelled out beside the control rather than left to a label.
   */
  it('explains what each mode means, beside the choice', async () => {
    const user = userEvent.setup();
    open();

    expect(screen.getByText(/money is taken now/i)).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Taken as'), 'receipt');

    expect(screen.getByText(/NO money changes hands/i)).toBeInTheDocument();
    expect(screen.queryByText(/money is taken now/i)).not.toBeInTheDocument();
  });

  it('refuses a fractional count before the server sees it', async () => {
    const user = userEvent.setup();
    open();

    await user.selectOptions(screen.getByLabelText('Person'), 's1');
    await user.type(screen.getByLabelText('Crates'), '2.5');
    await user.click(screen.getByRole('button', { name: /^issue$/i }));

    await waitFor(() => expect(screen.getByText(/whole number of crates/i)).toBeInTheDocument());
    expect(issueMock).not.toHaveBeenCalled();
  });

  it('refuses a missing person', async () => {
    const user = userEvent.setup();
    open();

    await user.type(screen.getByLabelText('Crates'), '20');
    await user.click(screen.getByRole('button', { name: /^issue$/i }));

    // NOT the placeholder's wording: a validation message that repeats the
    // placeholder verbatim tells the operator nothing they were not already
    // looking at.
    await waitFor(() =>
      expect(screen.getByText(/pick who is taking the crates/i)).toBeInTheDocument(),
    );
    expect(issueMock).not.toHaveBeenCalled();
  });

  /** No tare type marked as the crate — the operator is told where to fix it. */
  it('names NO_CRATE_TYPE rather than showing a generic failure', async () => {
    const user = userEvent.setup();
    issueMock.mockRejectedValue(new ApiError(400, 'no crate', undefined, 'NO_CRATE_TYPE'));
    open();

    await user.selectOptions(screen.getByLabelText('Person'), 's1');
    await user.type(screen.getByLabelText('Crates'), '20');
    await user.click(screen.getByRole('button', { name: /^issue$/i }));

    await waitFor(() => expect(screen.getByText(/marked as the crate/i)).toBeInTheDocument());
  });

  it('falls back to a generic banner for an unmapped failure', async () => {
    const user = userEvent.setup();
    issueMock.mockRejectedValue(new ApiError(500, 'boom'));
    open();

    await user.selectOptions(screen.getByLabelText('Person'), 's1');
    await user.type(screen.getByLabelText('Crates'), '20');
    await user.click(screen.getByRole('button', { name: /^issue$/i }));

    await waitFor(() => expect(screen.getByText(/could not issue/i)).toBeInTheDocument());
  });
});
