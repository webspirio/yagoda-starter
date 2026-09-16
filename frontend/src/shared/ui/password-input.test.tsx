import { expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expectNoAxeViolations } from '../../test-axe';
import { Field } from './field';
import { PasswordInput } from './password-input';

const renderInField = () =>
  render(
    <Field name="password" label="Password">
      {(a11y) => <PasswordInput {...a11y} />}
    </Field>,
  );

it('starts masked and shows the password while the eye is pressed', async () => {
  const { container } = renderInField();
  const input = screen.getByLabelText('Password');
  const eye = screen.getByRole('button', { name: 'Show password' });

  expect(input).toHaveAttribute('type', 'password');
  expect(eye).toHaveAttribute('aria-pressed', 'false');
  await expectNoAxeViolations(container);

  await userEvent.click(eye);
  expect(input).toHaveAttribute('type', 'text');
  expect(screen.getByRole('button', { name: 'Hide password' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await userEvent.click(screen.getByRole('button', { name: 'Hide password' }));
  expect(input).toHaveAttribute('type', 'password');
});

// The typed value must survive the toggle — a remount would clear the field
// mid-entry, which is exactly when someone reaches for the eye.
it('keeps what was typed when the mask flips', async () => {
  renderInField();
  const input = screen.getByLabelText('Password');

  await userEvent.type(input, 'hunter2!!');
  await userEvent.click(screen.getByRole('button', { name: 'Show password' }));

  expect(input).toHaveValue('hunter2!!');
});

// `type="button"`: inside a login form the default would be submit, and
// pressing the eye would post a half-typed password.
it('never submits the form it sits in', async () => {
  const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
  render(
    <form onSubmit={onSubmit}>
      <Field name="password" label="Password">
        {(a11y) => <PasswordInput {...a11y} />}
      </Field>
    </form>,
  );

  await userEvent.click(screen.getByRole('button', { name: 'Show password' }));
  expect(onSubmit).not.toHaveBeenCalled();
});

it('passes the field a11y props and autoComplete through to the input', () => {
  render(
    <Field name="password" label="Password" error="users.errors.passwordShort">
      {(a11y) => <PasswordInput {...a11y} autoComplete="new-password" />}
    </Field>,
  );

  const input = screen.getByLabelText('Password');
  expect(input).toHaveAttribute('id', 'password');
  expect(input).toHaveAttribute('aria-invalid', 'true');
  expect(input).toHaveAttribute('autocomplete', 'new-password');
});
