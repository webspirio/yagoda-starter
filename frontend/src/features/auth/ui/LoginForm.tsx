import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ApiError } from '@/shared/api';
import { apiErrorToBanner } from '@/shared/lib/api-error';
import { useSession } from '@/entities/user';
import { Button } from '@/shared/ui/button';
import { Field } from '@/shared/ui/field';
import { TextInput } from '@/shared/ui/text-input';
import { PasswordInput } from '@/shared/ui/password-input';
import { login } from '../api/authApi';

export function LoginForm() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const setToken = useSession((s) => s.setToken);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const mutation = useMutation({
    mutationFn: login,
    onSuccess: ({ access_token }) => {
      setToken(access_token);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from ?? '/', { replace: true });
    },
  });

  // A 401 here means bad credentials whether or not the body carried the code;
  // every other failure goes through the shared map. The server's `message` is
  // English prose for a log and is never rendered.
  const error = mutation.error;
  const messageKey = !error
    ? null
    : error instanceof ApiError && (error.code === 'INVALID_CREDENTIALS' || (!error.code && error.status === 401))
      ? 'auth.invalidCredentials'
      : apiErrorToBanner(error, 'auth.loginFailed');

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
          <PasswordInput
            {...a11y}
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        )}
      </Field>

      {messageKey && (
        <p role="alert" className="text-sm text-destructive">
          {t(messageKey)}
        </p>
      )}

      <Button type="submit" disabled={mutation.isPending}>
        {t('auth.signIn')}
      </Button>
    </form>
  );
}
