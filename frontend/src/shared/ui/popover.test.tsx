import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Popover, PopoverContent, PopoverTrigger } from './popover';

describe('Popover', () => {
  it('opens its content in a portal on trigger click and closes on Escape', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <Popover>
        <PopoverTrigger>open</PopoverTrigger>
        <PopoverContent>body</PopoverContent>
      </Popover>,
    );
    expect(screen.queryByText('body')).toBeNull();

    await user.click(screen.getByText('open'));
    const body = screen.getByText('body');
    expect(document.body).toContainElement(body);
    expect(container).not.toContainElement(body);

    await user.keyboard('{Escape}');
    expect(screen.queryByText('body')).toBeNull();
  });
});
