import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CopyableField } from './CopyableField';

const writeText = vi.fn().mockResolvedValue(undefined);
beforeEach(() => {
  writeText.mockClear();
  Object.assign(navigator, { clipboard: { writeText } });
});

describe('CopyableField', () => {
  it('renders the label and value', () => {
    render(<CopyableField label="Account ID" value="42" />);
    expect(screen.getByText('Account ID')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('copies the value on click', async () => {
    render(<CopyableField label="Account ID" value="42" />);
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('42'));
  });
});
