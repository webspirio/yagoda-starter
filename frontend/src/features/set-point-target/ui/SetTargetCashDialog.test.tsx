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
    // for a preview nobody can see yet.
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

  it('reads the point’s cash once it is open — the preview and the over-target copy both need it', () => {
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

  it('describes the CURRENT target when the point already has one', () => {
    renderDialog(vi.fn(), '600000.00');
    expect(screen.getByText('Current: 600,000.00 ₴')).toBeInTheDocument();
  });

  it('describes the point as never targeted when it has none yet', () => {
    renderDialog(vi.fn(), null);
    expect(screen.getByText("This point hasn't been assigned a cash target yet.")).toBeInTheDocument();
  });

  it('prefills the target field with the current target', () => {
    renderDialog(vi.fn(), '600000.00');
    expect(screen.getByLabelText('How much money, ₴')).toHaveValue('600000.00');
  });

  it('starts blank when the point has no target yet', () => {
    renderDialog(vi.fn(), null);
    expect(screen.getByLabelText('How much money, ₴')).toHaveValue('');
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

    await userEvent.type(screen.getByLabelText('How much money, ₴'), '145453.00');
    await userEvent.click(screen.getByRole('button', { name: 'Save target' }));

    expect(screen.queryByText('Enter a reason')).toBeNull();
    expect(setTargetMock).toHaveBeenCalledWith({
      pointId: 'p1',
      target_cash: '145453.00',
      reason: '',
    });
    expect(await screen.findByText('Cash target — 145,453.00 ₴')).toBeInTheDocument();
    expect(
      await screen.findByText(
        "Шипинки. The old target isn't recorded in history — it's a single number on the point.",
      ),
    ).toBeInTheDocument();
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

    const targetField = screen.getByLabelText('How much money, ₴');
    await userEvent.clear(targetField);
    await userEvent.type(targetField, '700000.00');
    await userEvent.type(screen.getByLabelText('Reason'), 'розширили точку');
    await userEvent.click(screen.getByRole('button', { name: 'Save target' }));

    expect(setTargetMock).toHaveBeenCalledWith({
      pointId: 'p1',
      target_cash: '700000.00',
      reason: 'розширили точку',
    });
    expect(await screen.findByText('Cash target — 700,000.00 ₴')).toBeInTheDocument();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows the fallback banner and stays open when the server refuses', async () => {
    setTargetMock.mockRejectedValue(new Error('network down'));
    const { onClose } = renderDialog();

    await userEvent.type(screen.getByLabelText('Reason'), 'причина');
    await userEvent.click(screen.getByRole('button', { name: 'Save target' }));

    expect(await screen.findByText('Could not update the target')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  describe('the live preview', () => {
    it('shows the point’s current berry cash as soon as it opens', () => {
      renderDialog(vi.fn(), '600000.00');
      expect(screen.getByText('Cash for berries right now')).toBeInTheDocument();
      expect(screen.getByText('400,000.00 ₴')).toBeInTheDocument();
    });

    it('computes the shortfall from the prefilled value as soon as it opens, no typing needed', () => {
      // The field starts prefilled with the CURRENT target, 600000.00 —
      // already above the 400000.00 at the point — so the preview is live
      // from the very first render, not only after the user types.
      renderDialog(vi.fn(), '600000.00');
      // 600000.00 (current target) − 400000.00 (cash) = 200000.00
      expect(screen.getByText('200,000.00 ₴')).toBeInTheDocument();
    });

    it('shows a dash for the shortfall while the field starts blank', () => {
      // A point's first-ever target starts with a blank field — nothing
      // valid to compare against yet.
      renderDialog(vi.fn(), null);
      const shortfallRow = screen.getByText('Will fall short of the target').closest('div');
      expect(shortfallRow).toHaveTextContent('—');
    });

    it('computes the shortfall live as the typed target grows past the current cash', async () => {
      renderDialog(vi.fn(), '600000.00');

      const targetField = screen.getByLabelText('How much money, ₴');
      await userEvent.clear(targetField);
      await userEvent.type(targetField, '500000.00');

      // 500000.00 (typed) − 400000.00 (cash) = 100000.00
      expect(await screen.findByText('100,000.00 ₴')).toBeInTheDocument();
    });

    it('falls back to a dash while the typed amount is not a valid decimal', async () => {
      renderDialog(vi.fn(), '600000.00');

      const targetField = screen.getByLabelText('How much money, ₴');
      await userEvent.clear(targetField);
      await userEvent.type(targetField, '12.999');

      const shortfallRow = screen.getByText('Will fall short of the target').closest('div');
      expect(shortfallRow).toHaveTextContent('—');
    });

    it('falls back to a dash once the typed target no longer exceeds the current cash', async () => {
      renderDialog(vi.fn(), '600000.00');

      const targetField = screen.getByLabelText('How much money, ₴');
      await userEvent.clear(targetField);
      await userEvent.type(targetField, '400000.00');

      const shortfallRow = screen.getByText('Will fall short of the target').closest('div');
      expect(shortfallRow).toHaveTextContent('—');
    });
  });

  describe('the over-target copy', () => {
    it('replaces the amber warning when the typed target is below the current cash — still not a block', async () => {
      // The point already holds 400000.00 in berry cash; typing 300000.00
      // means the drawer already covers more than the new target.
      const { onClose } = renderDialog(vi.fn(), '600000.00');

      const targetField = screen.getByLabelText('How much money, ₴');
      await userEvent.clear(targetField);
      await userEvent.type(targetField, '300000.00');
      await userEvent.type(screen.getByLabelText('Reason'), 'сезон закінчується');

      expect(await screen.findByRole('status')).toHaveTextContent(
        "There's already more in the drawer than this target. There will be no debt to the point at all — this can't be refused: a target is a management decision.",
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

    it('does not show for a target at or above what is already out', async () => {
      renderDialog(vi.fn(), '600000.00');

      const targetField = screen.getByLabelText('How much money, ₴');
      await userEvent.clear(targetField);
      await userEvent.type(targetField, '400000.00');

      expect(screen.queryByRole('status')).toBeNull();
    });
  });

  it('shows the static note about what changes and what does not', () => {
    renderDialog();
    expect(
      screen.getByText(
        'The drawer isn\'t recounted: only the figure used to measure "short of the target" changes.',
      ),
    ).toBeInTheDocument();
  });
});
