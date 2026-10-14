import { describe, it, expect } from 'vitest';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { decimalRules } from '@/shared/lib/money';
import { DecimalInput } from './decimal-input';

function Controlled({ allowNegative }: { allowNegative?: boolean }) {
  const [value, setValue] = useState('');
  return (
    <DecimalInput
      aria-label="sum"
      value={value}
      allowNegative={allowNegative}
      onChange={(e) => setValue(e.target.value)}
    />
  );
}

function Registered({
  onValid,
  initial = '',
  allowNegative = false,
}: {
  onValid: (value: string) => void;
  initial?: string;
  allowNegative?: boolean;
}) {
  const { register, handleSubmit, formState } = useForm({ defaultValues: { amount: initial } });
  return (
    <form onSubmit={handleSubmit((data) => onValid(data.amount))}>
      <DecimalInput
        aria-label="sum"
        allowNegative={allowNegative}
        {...register('amount', decimalRules({ allowNegative }))}
      />
      <span>{formState.errors.amount?.message}</span>
      <button type="submit">go</button>
    </form>
  );
}

describe('DecimalInput', () => {
  it('is a decimal text field', () => {
    render(<Controlled />);
    const input = screen.getByLabelText('sum');
    expect(input).toHaveAttribute('type', 'text');
    expect(input).toHaveAttribute('inputmode', 'decimal');
  });

  it('never holds a space — typed or pasted', async () => {
    render(<Controlled />);
    const input = screen.getByLabelText('sum');
    await userEvent.type(input, '980 40');
    expect(input).toHaveValue('98040');
    await userEvent.clear(input);
    await userEvent.click(input);
    await userEvent.paste('12 000,00');
    expect(input).toHaveValue('12000.00');
  });

  it('drops a minus unless allowNegative', async () => {
    const { unmount } = render(<Controlled />);
    await userEvent.type(screen.getByLabelText('sum'), '-5');
    expect(screen.getByLabelText('sum')).toHaveValue('5');
    unmount();
    render(<Controlled allowNegative />);
    await userEvent.type(screen.getByLabelText('sum'), '-5');
    expect(screen.getByLabelText('sum')).toHaveValue('-5');
  });

  it('works with register: a half-typed sum shows the shared key, the masked one submits', async () => {
    const seen: string[] = [];
    render(<Registered onValid={(value) => seen.push(value)} />);
    const input = screen.getByLabelText('sum');
    await userEvent.type(input, '12.');
    await userEvent.click(screen.getByRole('button', { name: 'go' }));
    expect(await screen.findByText('errors.decimalFormat')).toBeInTheDocument();
    await userEvent.type(input, '5');
    await userEvent.click(screen.getByRole('button', { name: 'go' }));
    expect(seen).toEqual(['12.5']);
  });

  it('never drops a digit or a separator: «12,000.00» stays visible and is refused (#72)', async () => {
    const seen: string[] = [];
    render(<Registered onValid={(value) => seen.push(value)} />);
    const input = screen.getByLabelText('sum');
    await userEvent.click(input);
    await userEvent.paste('12,000.00');
    expect(input).toHaveValue('12.000.00');
    await userEvent.click(screen.getByRole('button', { name: 'go' }));
    expect(await screen.findByText('errors.decimalFormat')).toBeInTheDocument();
    expect(seen).toEqual([]);
  });

  it('submits a server-canonical default untouched', async () => {
    const seen: string[] = [];
    render(<Registered initial="1500.00" onValid={(value) => seen.push(value)} />);
    await userEvent.click(screen.getByRole('button', { name: 'go' }));
    await waitFor(() => expect(seen).toEqual(['1500.00']));
  });

  it('lets a minus through register when the field opts in', async () => {
    const seen: string[] = [];
    render(<Registered allowNegative onValid={(value) => seen.push(value)} />);
    await userEvent.type(screen.getByLabelText('sum'), '-2,5');
    await userEvent.click(screen.getByRole('button', { name: 'go' }));
    await waitFor(() => expect(seen).toEqual(['-2.5']));
  });
});
