import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HeaderSlot } from './header-slot';

describe('HeaderSlot', () => {
  // A page test renders the page bare: with no shell there is no bar to move into, so the
  // content must stay exactly where the page wrote it — or every page test loses its picker.
  it('renders in place when no shell provides the bar', () => {
    render(
      <main>
        <HeaderSlot slot="scope">
          <select aria-label="Point" />
        </HeaderSlot>
      </main>,
    );
    expect(screen.getByRole('main')).toContainElement(
      screen.getByRole('combobox', { name: 'Point' }),
    );
  });
});
