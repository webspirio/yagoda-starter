import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Toaster } from '@/shared/ui/sonner';
import { expectNoAxeViolations } from '../../../test-axe';
import { SetTargetCashDialog } from './SetTargetCashDialog';

const { setTargetMock, pointCashMock } = vi.hoisted(() => ({
  setTargetMock: vi.fn(),
  pointCashMock: vi.fn(),
}));

vi.mock('../api/useSetPointTarget', () => ({
  useSetPointTargetMutation: () => ({ mutateAsync: setTargetMock }),
}));

vi.mock('@/entities/point-cash', () => ({
  usePointCashForPointQuery: (pointId: string | null) => pointCashMock(pointId),
}));

function renderDialog(onClose = vi.fn(), currentTarget: string | null = '600000.00') {
  return {
    onClose,
    ...render(
      <>
        <SetTargetCashDialog
          pointId="p1"
          pointName="Шипинки"
          currentTarget={currentTarget}
          open
          onClose={onClose}
        />
        <Toaster />
      </>,
    ),
  };
}

beforeEach(() => {
  setTargetMock.mockReset().mockResolvedValue({});
  pointCashMock.mockReset().mockReturnValue({
    data: { collection_point_id: 'p1', cash: '400000.00' },
    isPending: false,
  });
});

describe('SetTargetCashDialog', () => {
  it('renders the point name in the title', async () => {
    const { container } = renderDialog();
    expect(
      screen.getByRole('heading', { name: 'Change the cash target — Шипинки' }),
    ).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('prefills the target field with the current target', () => {
    renderDialog(vi.fn(), '600000.00');
    expect(screen.getByLabelText('New target')).toHaveValue('600000.00');
  });

  it('starts blank when the point has no target yet', () => {
    renderDialog(vi.fn(), null);
    expect(screen.getByLabelText('New target')).toHaveValue('');
  });

  it('refuses a blank reason and does not call the mutation', async () => {
    const { onClose } = renderDialog();

    await userEvent.click(screen.getByRole('button', { name: 'Save target' }));

    expect(await screen.findByText('Enter a reason')).toBeInTheDocument();
    expect(setTargetMock).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('submits the new target with the reason and closes', async () => {
    const { onClose } = renderDialog();

    const targetField = screen.getByLabelText('New target');
    await userEvent.clear(targetField);
    await userEvent.type(targetField, '700000.00');
    await userEvent.type(screen.getByLabelText('Reason'), 'розширили точку');
    await userEvent.click(screen.getByRole('button', { name: 'Save target' }));

    expect(setTargetMock).toHaveBeenCalledWith({
      pointId: 'p1',
      target_cash: '700000.00',
      reason: 'розширили точку',
    });
    expect(await screen.findByText('Target updated')).toBeInTheDocument();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('warns when the new target is below what is already out, but still submits', async () => {
    // §6.1 — a lower target is allowed WITH A WARNING, never a refusal: a
    // target is a management decision, and this point already holds
    // 400000.00, more than the 300000.00 being typed here.
    const { onClose } = renderDialog(vi.fn(), '600000.00');

    const targetField = screen.getByLabelText('New target');
    await userEvent.clear(targetField);
    await userEvent.type(targetField, '300000.00');
    await userEvent.type(screen.getByLabelText('Reason'), 'сезон закінчується');

    expect(await screen.findByRole('status')).toHaveTextContent(
      'This is below the 400,000.00 ₴ already at the point',
    );

    const submitButton = screen.getByRole('button', { name: 'Save target' });
    expect(submitButton).not.toBeDisabled();
    await userEvent.click(submitButton);

    expect(setTargetMock).toHaveBeenCalledWith({
      pointId: 'p1',
      target_cash: '300000.00',
      reason: 'сезон закінчується',
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not warn for a target at or above what is already out', async () => {
    renderDialog(vi.fn(), '600000.00');

    const targetField = screen.getByLabelText('New target');
    await userEvent.clear(targetField);
    await userEvent.type(targetField, '400000.00');

    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows the fallback banner and stays open when the server refuses', async () => {
    // `CollectionPointsService.update` has no assert-level rejection of its
    // own for this field — a non-owner never reaches it (`@Auth(NetworkOwner)`
    // refuses first, with `INSUFFICIENT_ROLE`, a code this map does not carry
    // because the button this dialog belongs to never renders for that actor
    // in the first place, per §10.2). A network failure is what a REAL caller
    // of this dialog can actually hit, so that is what this test simulates.
    setTargetMock.mockRejectedValue(new Error('network down'));
    const { onClose } = renderDialog();

    await userEvent.type(screen.getByLabelText('Reason'), 'причина');
    await userEvent.click(screen.getByRole('button', { name: 'Save target' }));

    expect(await screen.findByText('Could not update the target')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
