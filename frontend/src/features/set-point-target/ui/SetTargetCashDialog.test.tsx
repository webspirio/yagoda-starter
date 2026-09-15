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
  usePointCashForPointQuery: (pointId: string | null, asOf?: string, enabled?: boolean) =>
    pointCashMock(pointId, asOf, enabled),
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
  it('does not read the point’s cash while it is closed', () => {
    // The page mounts this dialog closed for every owner + point, so an
    // ungated read here is one extra request per point the owner picks —
    // for a warning nobody can see yet.
    render(
      <SetTargetCashDialog
        pointId="p1"
        pointName="Шипинки"
        currentTarget="600000.00"
        open={false}
        onClose={vi.fn()}
      />,
    );

    expect(pointCashMock).toHaveBeenCalledWith('p1', undefined, false);
  });

  it('reads the point’s cash once it is open — the §6.1 warning needs it', () => {
    renderDialog();
    expect(pointCashMock).toHaveBeenCalledWith('p1', undefined, true);
  });

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

  it('refuses a blank reason when changing an EXISTING target and does not call the mutation', async () => {
    // §6.1 — the reason requirement is conditional on a PREVIOUS level having
    // existed; `currentTarget` here is non-null (the default), so this is the
    // "changing an existing target" side and a blank reason must still refuse.
    const { onClose } = renderDialog();

    await userEvent.click(screen.getByRole('button', { name: 'Save target' }));

    expect(await screen.findByText('Enter a reason')).toBeInTheDocument();
    expect(setTargetMock).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('submits a blank reason when setting a point\'s FIRST-EVER target', async () => {
    // §6.1: «Для першого цільового значення точки причина не потрібна —
    // попереднього рівня не існувало» — `currentTarget: null` is the signal.
    const { onClose } = renderDialog(vi.fn(), null);

    await userEvent.type(screen.getByLabelText('New target'), '145453.00');
    await userEvent.click(screen.getByRole('button', { name: 'Save target' }));

    expect(screen.queryByText('Enter a reason')).toBeNull();
    expect(setTargetMock).toHaveBeenCalledWith({
      pointId: 'p1',
      target_cash: '145453.00',
      reason: '',
    });
    expect(await screen.findByText('Target updated')).toBeInTheDocument();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('drops aria-required from the reason field for a point\'s first-ever target', () => {
    // `Field`'s required marker is a sibling of <label>, outside the
    // accessible-name chain — `aria-required` on the control itself is the
    // real, testable half of "the required marker follows the condition".
    renderDialog(vi.fn(), null);
    expect(screen.getByLabelText('Reason')).not.toHaveAttribute('aria-required');
  });

  it('keeps aria-required on the reason field when changing an existing target', () => {
    renderDialog(vi.fn(), '600000.00');
    expect(screen.getByLabelText('Reason')).toHaveAttribute('aria-required', 'true');
  });

  it('refuses a reason over 500 characters', async () => {
    renderDialog();

    await userEvent.type(screen.getByLabelText('Reason'), 'а'.repeat(501));
    await userEvent.click(screen.getByRole('button', { name: 'Save target' }));

    expect(await screen.findByText('Reason — 500 characters or fewer')).toBeInTheDocument();
    expect(setTargetMock).not.toHaveBeenCalled();
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
