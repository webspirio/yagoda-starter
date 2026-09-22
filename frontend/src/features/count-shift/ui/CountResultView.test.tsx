import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expectNoAxeViolations } from '../../../test-axe';
import { CountResultView } from './CountResultView';

describe('CountResultView — the recount shape (expected + counted + pill + note)', () => {
  it('shows Expected and Counted, and no pill without a discrepancy prop', () => {
    render(
      <CountResultView
        open
        title="Cash recount"
        expected="1000.00"
        counted="1000.00"
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Cash recount' })).toBeInTheDocument();
    expect(screen.getByText('Expected')).toBeInTheDocument();
    expect(screen.getAllByText('1,000.00 ₴')).toHaveLength(2);
    expect(screen.queryByText('Discrepancy')).toBeNull();
  });

  it('shows a leaf pill for a matching discrepancy, and no note by default', async () => {
    const { container } = render(
      <CountResultView
        open
        title="Cash recount"
        expected="1000.00"
        counted="1000.00"
        discrepancy="0.00"
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText('Discrepancy').closest('span')).toHaveClass('text-leaf');
    expect(screen.queryByText(/cannot be changed/i)).toBeNull();
    await expectNoAxeViolations(container);
  });

  it('shows a destructive pill and the caller-supplied note for a non-zero discrepancy', () => {
    render(
      <CountResultView
        open
        title="Cash recount"
        expected="1000.00"
        counted="950.00"
        discrepancy="-50.00"
        note="This figure cannot be changed in the app."
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText('Discrepancy').closest('span')).toHaveClass('text-destructive');
    expect(screen.getByText('This figure cannot be changed in the app.')).toBeInTheDocument();
  });
});

describe('CountResultView — the open/close shape (counted only, optional pill, title carries the sentence)', () => {
  it('shows only Counted for an open result — no Expected row, no pill', () => {
    render(
      <CountResultView open title="Shift opened" counted="2500.00" onClose={vi.fn()} />,
    );

    expect(screen.getByRole('heading', { name: 'Shift opened' })).toBeInTheDocument();
    expect(screen.getByText('Counted')).toBeInTheDocument();
    expect(screen.queryByText('Expected')).toBeNull();
    expect(screen.getByText('2,500.00 ₴')).toBeInTheDocument();
    expect(screen.queryByText('Discrepancy')).toBeNull();
  });

  it('shows a leaf pill for a settled close, with the sentence in the title alone', () => {
    render(
      <CountResultView
        open
        title="Shift closed. The day matched."
        counted="3000.00"
        discrepancy="0.00"
        onClose={vi.fn()}
      />,
    );

    expect(
      screen.getByRole('heading', { name: 'Shift closed. The day matched.' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Discrepancy').closest('span')).toHaveClass('text-leaf');
    // The close result folds its explanation into the title — no separate note line.
    expect(screen.queryByText(/cannot be changed/i)).toBeNull();
  });

  it('shows a destructive pill for a close with a discrepancy', () => {
    render(
      <CountResultView
        open
        title="Shift closed. Discrepancy −50.00 ₴ — the owner will see it on their own list."
        counted="2950.00"
        discrepancy="-50.00"
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText('Discrepancy').closest('span')).toHaveClass('text-destructive');
  });
});

describe('CountResultView — footer', () => {
  it('calls onClose from the «Done» button', async () => {
    const onClose = vi.fn();
    render(<CountResultView open title="Shift opened" counted="1000.00" onClose={onClose} />);

    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalled();
  });
});
