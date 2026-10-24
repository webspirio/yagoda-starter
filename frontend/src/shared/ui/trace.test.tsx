import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { expectNoAxeViolations } from '../../test-axe';
import { TraceScope, TraceTerm } from './trace';

function Sheet() {
  return (
    <TraceScope>
      <table>
        <tbody>
          <tr>
            <td data-trace="p1:accrued">113 044,20</td>
            <td data-trace="p1:kg day:kg">596,80</td>
            <td data-trace="p2:accrued">596,60</td>
          </tr>
        </tbody>
      </table>
      <p>
        <TraceTerm refs="p1:accrued" tone="sky" hint="Нараховано · Малина">
          113 044,20 ₴
        </TraceTerm>
        ÷
        <TraceTerm refs={['p1:kg']}>596,80 кг</TraceTerm>
      </p>
    </TraceScope>
  );
}

describe('TraceTerm', () => {
  it('lights up its source cell and itself in its tone while pointed at, and clears on leave', () => {
    render(<Sheet />);
    const term = screen.getByText('113 044,20 ₴');
    const source = screen.getByText('113 044,20');

    fireEvent.pointerEnter(term);
    expect(source).toHaveAttribute('data-trace-hit', 'sky');
    expect(term).toHaveAttribute('data-trace-hit', 'sky');
    expect(screen.getByText('596,60')).not.toHaveAttribute('data-trace-hit');

    fireEvent.pointerLeave(term);
    expect(source).not.toHaveAttribute('data-trace-hit');
    expect(term).not.toHaveAttribute('data-trace-hit');
  });

  it('matches one id among several on a source, and works from the keyboard', () => {
    render(<Sheet />);
    const term = screen.getByText('596,80 кг');
    fireEvent.focus(term);
    expect(screen.getByText('596,80')).toHaveAttribute('data-trace-hit', 'neutral');
    expect(screen.getByText('113 044,20')).not.toHaveAttribute('data-trace-hit');
    fireEvent.blur(term);
    expect(screen.getByText('596,80')).not.toHaveAttribute('data-trace-hit');
  });

  it('pointing at a second term replaces the first highlight', () => {
    render(<Sheet />);
    fireEvent.pointerEnter(screen.getByText('113 044,20 ₴'));
    fireEvent.pointerEnter(screen.getByText('596,80 кг'));
    expect(screen.getByText('113 044,20')).not.toHaveAttribute('data-trace-hit');
    expect(screen.getByText('596,80')).toHaveAttribute('data-trace-hit');
  });

  it('is focusable inside a scope and names its source for a screen reader', () => {
    render(<Sheet />);
    const term = screen.getByText('113 044,20 ₴');
    expect(term).toHaveAttribute('tabindex', '0');
    expect(term).toHaveAttribute('aria-label', '113 044,20 ₴ — Нараховано · Малина');
  });

  it('outside a scope is a plain boxed figure — not focusable, nothing to light up', () => {
    render(<TraceTerm refs="x">1,00 ₴</TraceTerm>);
    const term = screen.getByText('1,00 ₴');
    expect(term).not.toHaveAttribute('tabindex');
    fireEvent.pointerEnter(term);
    expect(term).not.toHaveAttribute('data-trace-hit');
  });

  it('has no axe violations', async () => {
    const { container } = render(<Sheet />);
    await expectNoAxeViolations(container);
  });
});
