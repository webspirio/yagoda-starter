import { useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ApiError } from '@/shared/api';
import { useSession } from '@/entities/user';
import { Button } from '@/shared/ui/button';
import { Field } from '@/shared/ui/field';
import { TextInput } from '@/shared/ui/text-input';
import { register } from '../api/authApi';

export function RegisterForm() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const setToken = useSession((s) => s.setToken);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const mutation = useMutation({
    mutationFn: register,
    onSuccess: ({ access_token }) => {
      setToken(access_token);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from ?? '/', { replace: true });
    },
  });

  const message =
    mutation.error instanceof ApiError
      ? mutation.error.status === 409
        ? t('auth.usernameTaken')
        : mutation.error.message
      : null;

  return (
    <form
      className="mx-auto flex w-full max-w-sm flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        // Guard here rather than relying on `required`: the test drives submit
        // directly, and an empty POST would 400 for no reason.
        if (!username || !password) return;
        mutation.mutate({ username, password });
      }}
    >
      {/* `Field` takes the control id as `name` and passes a11y props to a
          RENDER-PROP child — spreading `{...a11y}` is what associates the
          label with the input, so getByLabelText can find it. */}
      <Field name="username" label={t('auth.username')} hint={t('auth.usernameHint')}>
        {(a11y) => (
          <TextInput
            {...a11y}
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        )}
      </Field>

      <Field name="password" label={t('auth.password')}>
        {(a11y) => (
          <TextInput
            {...a11y}
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        )}
      </Field>

      {message && (
        <p role="alert" className="text-sm text-destructive">
          {message}
        </p>
      )}

      <Button type="submit" disabled={mutation.isPending}>
        {t('auth.signUp')}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        {t('auth.haveAccount')} <Link to="/login" className="underline">{t('auth.signIn')}</Link>
      </p>
    </form>
  );
}
