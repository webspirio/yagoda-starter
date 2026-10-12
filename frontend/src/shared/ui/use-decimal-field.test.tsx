import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DecimalInput } from './decimal-input';
import { useDecimalField } from './use-decimal-field';

function Harness({
  allowNegative,
  errorId,
  onBlur,
}: {
  allowNegative?: boolean;
  errorId?: string;
  onBlur?: () => void;
}) {
  const [value, setValue] = useState('');
  const field = useDecimalField(value, { allowNegative, errorId, onBlur });
  return (
    <>
      <DecimalInput
        aria-label="sum"
        {...field.inputProps}
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <output data-testid="parsed">{String(field.parsed)}</output>
      <output data-testid="malformed">{String(field.isMalformed)}</output>
      {field.error ? <p id={errorId}>{field.error}</p> : null}
      <button type="button">elsewhere</button>
    </>
  );
}

describe('useDecimalField', () => {
  it('parses live, refuses at once, but names the refusal only once the field is left', async () => {
    render(<Harness />);
    const input = screen.getByLabelText('sum');
    await userEvent.type(input, '12.');
    expect(screen.getByTestId('malformed')).toHaveTextContent('true');
    expect(screen.queryByText('errors.decimalFormat')).not.toBeInTheDocument();
    await userEvent.tab();
    expect(screen.getByText('errors.decimalFormat')).toBeInTheDocument();
    await userEvent.click(input);
    expect(screen.queryByText('errors.decimalFormat')).not.toBeInTheDocument();
    await userEvent.type(input, '5');
    expect(screen.getByTestId('parsed')).toHaveTextContent('12.5');
  });

  it('treats empty as «not typed yet», not as an error', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByLabelText('sum'));
    await userEvent.tab();
    expect(screen.getByTestId('malformed')).toHaveTextContent('false');
    expect(screen.queryByText('errors.decimalFormat')).not.toBeInTheDocument();
  });

  it('carries allowNegative to the mask AND the grammar at once', async () => {
    render(<Harness allowNegative />);
    await userEvent.type(screen.getByLabelText('sum'), '-2,5');
    expect(screen.getByLabelText('sum')).toHaveValue('-2.5');
    expect(screen.getByTestId('parsed')).toHaveTextContent('-2.5');
  });

  it('wires aria only when given an errorId, and runs the field\'s own onBlur', async () => {
    const onBlur = vi.fn();
    render(<Harness errorId="sum-error" onBlur={onBlur} />);
    const input = screen.getByLabelText('sum');
    await userEvent.type(input, '1.2.3');
    await userEvent.tab();
    expect(onBlur).toHaveBeenCalledTimes(1);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('aria-describedby', 'sum-error');
  });

  it('leaves aria alone without an errorId (inside a Field, Field owns it)', async () => {
    render(<Harness />);
    const input = screen.getByLabelText('sum');
    await userEvent.type(input, '1.2.3');
    await userEvent.tab();
    expect(input).not.toHaveAttribute('aria-invalid');
  });
});
