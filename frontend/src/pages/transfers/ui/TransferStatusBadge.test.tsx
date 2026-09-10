import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { expectNoAxeViolations } from '../../../test-axe';
import { TransferStatusBadge } from './TransferStatusBadge';

describe('TransferStatusBadge', () => {
  it('labels a sent transfer as in transit', () => {
    render(<TransferStatusBadge status="sent" />);
    expect(screen.getByText('In transit')).toBeInTheDocument();
  });

  it('labels an accepted transfer as accepted', () => {
    render(<TransferStatusBadge status="accepted" />);
    expect(screen.getByText('Accepted')).toBeInTheDocument();
  });

  it('labels a disputed transfer with the client-facing phrase used elsewhere in the app', () => {
    render(<TransferStatusBadge status="disputed" />);
    expect(screen.getByText("Doesn't match")).toBeInTheDocument();
  });

  it('has no axe violations', async () => {
    const { container } = render(<TransferStatusBadge status="disputed" />);
    await expectNoAxeViolations(container);
  });
});
