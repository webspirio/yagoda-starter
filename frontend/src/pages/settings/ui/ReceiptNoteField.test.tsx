import { describe, expect, it } from 'vitest';
import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReceiptNoteField } from './ReceiptNoteField';

function Controlled() {
  const [value, setValue] = useState('');
  return <ReceiptNoteField value={value} onChange={setValue} />;
}

const box = () =>
  screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Note on every receipt' });

describe('ReceiptNoteField', () => {
  it('wraps a long line at its last space and takes nothing past the seventh', async () => {
    const user = userEvent.setup();
    render(<Controlled />);

    await user.type(box(), `${'a'.repeat(30)} ${'b'.repeat(15)}`);
    await user.type(box(), '{Enter}3{Enter}4{Enter}5{Enter}6{Enter}7');
    await user.type(box(), '{Enter}'); // an eighth line is not taken

    expect(box()).toHaveValue(
      [`${'a'.repeat(30)}`, `${'b'.repeat(15)}`, '3', '4', '5', '6', '7'].join('\n'),
    );
    expect(screen.getByText(/Line 7 of 7/)).toBeInTheDocument();
  });

  it('keeps the caret in place when a hard cut lands after it', async () => {
    const user = userEvent.setup();
    render(<Controlled />);

    await user.type(box(), 'x'.repeat(40));
    await user.type(box(), 'y', { initialSelectionStart: 5, initialSelectionEnd: 5 });
    expect(box()).toHaveValue(`xxxxxy${'x'.repeat(34)}\nx`);
    await waitFor(() => expect(box().selectionStart).toBe(6));
  });
});
