import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expectNoAxeViolations } from '../../../test-axe';
import type { Transfer } from '@/entities/transfer';
import { TransferHistory } from './TransferHistory';

const transfer = (over: Partial<Transfer> = {}): Transfer => ({
  id: 't1',
  collection_point_id: 'p1',
  cash: '500.00',
  crates: 20,
  carrier: 'Petro',
  sent_by_user_id: 'u-owner',
  sent_at: '2026-09-10T08:00:00.000Z',
  status: 'sent',
  accepted_by_user_id: null,
  accepted_date: null,
  accepted_at: null,
  reported_cash: null,
  reported_crates: null,
  dispute_note: null,
  resolved_cash: null,
  resolved_crates: null,
  resolved_by_user_id: null,
  resolved_at: null,
  cash_discrepancy: null,
  crates_discrepancy: null,
  correction_of_transfer_id: null,
  voided_at: null,
  voided_by_user_id: null,
  void_reason: null,
  created_at: '2026-09-10T08:00:00.000Z',
  ...over,
});

const noop = () => {};

describe('TransferHistory', () => {
  it('shows an empty state when nothing has been sent yet', () => {
    render(<TransferHistory transfers={[]} pointName={() => '—'} onVoid={noop} />);
    expect(screen.getByText('No transfers sent yet.')).toBeInTheDocument();
  });

  it('lists each transfer with its point, amounts, carrier and status', () => {
    render(
      <TransferHistory
        transfers={[transfer({ status: 'accepted', cash: '750.00', crates: 30, carrier: 'Ihor' })]}
        pointName={(id) => (id === 'p1' ? 'Shypynky' : id)}
        onVoid={noop}
      />,
    );

    expect(screen.getByText('Shypynky')).toBeInTheDocument();
    expect(screen.getByText('750.00 ₴')).toBeInTheDocument();
    expect(screen.getByText('30')).toBeInTheDocument();
    expect(screen.getByText('Ihor')).toBeInTheDocument();
    expect(screen.getByText('Accepted')).toBeInTheDocument();
  });

  it("shows «Resolved», not «Doesn't match», for a dispute the owner already settled", () => {
    // `resolve()` never touches `status` (transfers.service.ts) — this is
    // the one place the FULL record is available to tell the two apart
    // (fix round 1, finding 4).
    render(
      <TransferHistory
        transfers={[transfer({ status: 'disputed', resolved_at: '2026-09-11T09:00:00.000Z' })]}
        pointName={() => 'Shypynky'}
        onVoid={noop}
      />,
    );

    expect(screen.getByText('Resolved')).toBeInTheDocument();
    expect(screen.queryByText("Doesn't match")).toBeNull();
  });

  it("still shows «Doesn't match» for a dispute nobody has resolved yet", () => {
    render(
      <TransferHistory
        transfers={[transfer({ status: 'disputed', resolved_at: null })]}
        pointName={() => 'Shypynky'}
        onVoid={noop}
      />,
    );

    expect(screen.getByText("Doesn't match")).toBeInTheDocument();
  });

  it('offers to void every listed transfer', async () => {
    const user = userEvent.setup();
    const onVoid = vi.fn();
    const t = transfer({ id: 't7' });
    render(<TransferHistory transfers={[t]} pointName={() => 'Shypynky'} onVoid={onVoid} />);

    await user.click(screen.getByRole('button', { name: 'Void' }));
    expect(onVoid).toHaveBeenCalledWith(t);
  });

  describe('the «sent» column — via shared/lib/date, pinned to TZ=UTC for a fixed literal', () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('shows short day.month then the time, exactly like formatDateTime', () => {
      vi.stubEnv('TZ', 'UTC');
      render(
        <TransferHistory
          transfers={[transfer({ sent_at: '2026-09-10T08:05:00.000Z' })]}
          pointName={() => 'Shypynky'}
          onVoid={noop}
        />,
      );

      // Test locale is 'en' (test-setup.ts) — month/day order and 12-hour
      // clock, not the uk `10.09 · 08:05` shown in iso.test.ts.
      expect(screen.getByText('09/10 · 08:05 AM')).toBeInTheDocument();
    });
  });

  describe('a disputed row expands to the dispute (#76)', () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    const open = transfer({
      id: 'open',
      status: 'disputed',
      reported_cash: '450.00',
      cash_discrepancy: '50.00',
      reported_crates: 18,
      crates_discrepancy: 2,
      dispute_note: 'Порахували менше',
    });
    const settled = transfer({
      id: 'settled',
      status: 'disputed',
      reported_cash: '450.00',
      cash_discrepancy: '50.00',
      reported_crates: 20,
      crates_discrepancy: 0,
      resolved_cash: '480.00',
      resolved_crates: 20,
      resolved_at: '2026-09-11T09:00:00.000Z',
    });

    it('makes only disputed rows expandable', () => {
      render(
        <TransferHistory
          transfers={[transfer({ id: 'plain', status: 'accepted' }), open]}
          pointName={() => 'Shypynky'}
          onVoid={noop}
        />,
      );
      expect(screen.getAllByRole('button', { expanded: false })).toHaveLength(1);
    });

    it("shows an open dispute's details and its own «Resolve»", async () => {
      const user = userEvent.setup();
      const onResolve = vi.fn();
      render(
        <TransferHistory
          transfers={[open]}
          pointName={() => 'Shypynky'}
          onVoid={noop}
          onResolve={onResolve}
        />,
      );

      await user.click(screen.getByRole('button', { name: "Doesn't match" }));
      const item = within(screen.getByRole('list')).getByRole('listitem');
      expect(item).toHaveTextContent('450.00 ₴');
      expect(item).toHaveTextContent('Порахували менше');
      expect(item).toHaveTextContent('Crates: sent 20 cr. · counted 18 cr. · difference 2 cr.');

      await user.click(within(item).getByRole('button', { name: 'Resolve' }));
      expect(onResolve).toHaveBeenCalledWith(open);
    });

    it('shows how a settled dispute was resolved, and no «Resolve»', async () => {
      const user = userEvent.setup();
      vi.stubEnv('TZ', 'UTC');
      render(
        <TransferHistory
          transfers={[settled]}
          pointName={() => 'Shypynky'}
          onVoid={noop}
          onResolve={noop}
        />,
      );

      await user.click(screen.getByRole('button', { name: 'Resolved' }));
      const item = within(screen.getByRole('list')).getByRole('listitem');
      expect(item).toHaveTextContent('Resolved: 480.00 ₴ · 20 cr. · 09/11 · 09:00 AM');
      expect(within(item).queryByRole('button', { name: 'Resolve' })).toBeNull();
    });

    it('toggles on a row click, but «Void» does not toggle', async () => {
      const user = userEvent.setup();
      const onVoid = vi.fn();
      render(<TransferHistory transfers={[open]} pointName={() => 'Shypynky'} onVoid={onVoid} />);

      await user.click(screen.getByText('Shypynky'));
      expect(screen.getByRole('list')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Void' }));
      expect(onVoid).toHaveBeenCalledWith(open);
      expect(screen.getByRole('list')).toBeInTheDocument();
      await user.click(screen.getByText('Shypynky'));
      expect(screen.queryByRole('list')).toBeNull();
    });

    it('does not make a plain row clickable', async () => {
      const user = userEvent.setup();
      render(
        <TransferHistory
          transfers={[transfer({ status: 'sent' })]}
          pointName={() => 'Shypynky'}
          onVoid={noop}
        />,
      );
      await user.click(screen.getByText('Shypynky'));
      expect(screen.queryByRole('list')).toBeNull();
    });
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <TransferHistory transfers={[transfer()]} pointName={() => 'Shypynky'} onVoid={noop} />,
    );
    await expectNoAxeViolations(container);
  });
});
