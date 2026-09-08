import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog';
import { Field } from '@/shared/ui/field';
import { TextInput } from '@/shared/ui/text-input';
import { Button } from '@/shared/ui/button';
import { toast } from '@/shared/ui/toast';
import { useSetPasswordMutation } from '../api/users';
import { apiErrorToFields } from '../lib/apiErrorToFields';
import type { AdminUser } from '../model/user';

interface PasswordValues {
  password: string;
}

/**
 * Minimal dialog with a single password field — password reset is its own
 * endpoint (`PUT /users/:id/password`), separate from the PATCH that edits the
 * rest of a user. Remounted by the parent via a changing `key`.
 */
export function SetPasswordDialog({
  user,
  open,
  onClose,
}: {
  user: AdminUser | null;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const setPassword = useSetPasswordMutation();

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<PasswordValues>({ defaultValues: { password: '' } });

  const [formError, setFormError] = useState<string | null>(null);

  const onSubmit = handleSubmit(async (values) => {
    if (!user) return;
    setFormError(null);
    try {
      await setPassword.mutateAsync({ id: user.id, password: values.password });
      toast.success(t('users.toast.passwordSet'));
      onClose();
    } catch (error) {
      const mapped = apiErrorToFields(error, ['password']);
      for (const { field, messageKey } of mapped.fieldErrors) {
        setError(field as keyof PasswordValues, { message: messageKey });
      }
      setFormError(mapped.formErrorKey);
    }
  });

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !isSubmitting && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('users.form.setPassword')}</DialogTitle>
        </DialogHeader>

        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <Field
            name="password"
            label={t('users.form.password')}
            required
            error={errors.password?.message}
          >
            {(a11y) => (
              <TextInput
                {...a11y}
                type="password"
                autoComplete="new-password"
                {...register('password', {
                  required: 'users.errors.passwordShort',
                  minLength: { value: 8, message: 'users.errors.passwordShort' },
                })}
                autoFocus
              />
            )}
          </Field>

          {formError ? (
            <p role="alert" className="text-sm text-destructive">
              {t(formError)}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="ghost" disabled={isSubmitting} onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {t('users.form.setPassword')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
