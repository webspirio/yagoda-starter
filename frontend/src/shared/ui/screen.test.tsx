import { describe, it, expect } from 'vitest';
import { render, screen as rtl } from '@testing-library/react';
import { Screen } from './screen';

describe('Screen', () => {
  it('renders children inside a data-slot=screen element', () => {
    render(
      <Screen>
        <p>hello</p>
      </Screen>,
    );
    expect(rtl.getByText('hello')).toBeInTheDocument();
    const root = document.querySelector('[data-slot="screen"]');
    expect(root).not.toBeNull();
    expect(root).toHaveClass('bg-background');
    expect(root).toHaveClass('mx-auto');
  });

  it('merges a caller-provided className', () => {
    render(
      <Screen className="pt-8">
        <p>x</p>
      </Screen>,
    );
    expect(document.querySelector('[data-slot="screen"]')).toHaveClass('pt-8');
  });
});
