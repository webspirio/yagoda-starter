import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Shift } from '@/entities/shift';
import { formatTime } from '@/shared/lib/date';
import { ShiftClosedState, ShiftStatus } from './ShiftState';

const SHIFT = {
  id: 's1',
  created_at: '2026-09-21T04:12:00Z',
} as Shift;

describe('ShiftStatus', () => {
  it('reads the opening time from the shift’s created_at', () => {
    render(<ShiftStatus shift={{ status: 'open', shift: SHIFT }} />);
    expect(
      screen.getByText(`Shift open since ${formatTime(SHIFT.created_at, 'en')}`),
    ).toBeInTheDocument();
  });

  it('says the shift is not opened, with no action of its own', () => {
    render(<ShiftStatus shift={{ status: 'none' }} />);
    expect(screen.getByText('Shift not opened yet')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows the error, not «not opened», when the shift read failed', () => {
    render(<ShiftStatus shift={{ status: 'error' }} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
    expect(screen.queryByText('Shift not opened yet')).toBeNull();
  });

  it('renders nothing while the shift is still loading', () => {
    const { container } = render(<ShiftStatus shift={{ status: 'pending' }} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('ShiftClosedState', () => {
  it('offers the operator «Open shift» and calls onOpenShift', async () => {
    const onOpenShift = vi.fn();
    render(<ShiftClosedState canOpen isOpening={false} onOpenShift={onOpenShift} />);

    expect(screen.getByText("Today's shift isn't open yet")).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Open shift' }));
    expect(onOpenShift).toHaveBeenCalledTimes(1);
  });

  it('tells the owner the operator opens the shift, with no button', () => {
    render(<ShiftClosedState canOpen={false} isOpening={false} onOpenShift={vi.fn()} />);

    expect(
      screen.getByText(
        "The point's operator opens the shift. Once it's open, reception appears here.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open shift' })).toBeNull();
  });

  it('disables the button while the shift is being opened', () => {
    render(<ShiftClosedState canOpen isOpening onOpenShift={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Open shift' })).toBeDisabled();
  });
});
