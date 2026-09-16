import { useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
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
import { PasswordInput } from '@/shared/ui/password-input';
import { SelectField } from '@/shared/ui/select-field';
import { Switch } from '@/shared/ui/switch';
import { Button } from '@/shared/ui/button';
import { toast } from '@/shared/ui/toast';
import { usePointOptionsQuery } from '@/entities/collection-point';
import { useCreateUserMutation, useUpdateUserMutation } from '../api/users';
import { apiErrorToFields } from '../lib/apiErrorToFields';
import type {
  AdminUser,
  CreateUserInput,
  UpdateUserInput,
  UserFormValues,
} from '../model/user';

const FIELD_NAMES = [
  'first_name',
  'last_name',
  'login',
  'password',
  'role',
  'collection_point_id',
  'is_active',
] as const;

function toDefaults(user: AdminUser | null): UserFormValues {
  return {
    first_name: user?.first_name ?? '',
    last_name: user?.last_name ?? '',
    login: user?.login ?? '',
    password: '',
    role: user?.role ?? 'point_operator',
    collection_point_id: user?.collection_point_id ?? '',
    is_active: user?.is_active ?? true,
  };
}

/**
 * One dialog for create AND edit — told apart by `user` (null = create). The
 * parent remounts it via a changing `key` on every open, so there is no reset
 * effect. The point select shows only for a point operator (an owner belongs to
 * the network, so their point is always `null`); the password field only in
 * create (reset has its own dialog); the active switch only in edit. The PATCH
 * carries a field only when it actually changed.
 */
export function UserFormDialog({
  user,
  open,
  onClose,
  onResetPassword,
}: {
  user: AdminUser | null;
  open: boolean;
  onClose: () => void;
  onResetPassword?: () => void;
}) {
  const { t } = useTranslation();
  const create = useCreateUserMutation();
  const update = useUpdateUserMutation();
  const { data: points } = usePointOptionsQuery();

  const {
    register,
    handleSubmit,
    control,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<UserFormValues>({ defaultValues: toDefaults(user) });

  const [formError, setFormError] = useState<string | null>(null);
  const role = useWatch({ control, name: 'role' });
  const isOperator = role === 'point_operator';

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    const firstName = values.first_name.trim();
    const lastName = values.last_name.trim();
    const login = values.login.trim();
    // Per role: an operator carries the selected point; an owner carries none.
    const nextPoint = values.role === 'point_operator' ? values.collection_point_id : null;

    try {
      if (user) {
        const body: UpdateUserInput = { id: user.id };
        if (firstName !== user.first_name) body.first_name = firstName;
        if (lastName !== user.last_name) body.last_name = lastName;
        if (login !== user.login) body.login = login;
        if (values.role !== user.role) body.role = values.role;
        if (values.is_active !== user.is_active) body.is_active = values.is_active;
        if (nextPoint !== user.collection_point_id) body.collection_point_id = nextPoint;
        await update.mutateAsync(body);
        toast.success(t('users.toast.updated'));
      } else {
        const input: CreateUserInput = {
          first_name: firstName,
          last_name: lastName,
          login,
          password: values.password,
          role: values.role,
          collection_point_id: nextPoint,
        };
        await create.mutateAsync(input);
        toast.success(t('users.toast.created'));
      }
      onClose();
    } catch (error) {
      const mapped = apiErrorToFields(error, FIELD_NAMES);
      for (const { field, messageKey } of mapped.fieldErrors) {
        setError(field as keyof UserFormValues, { message: messageKey });
      }
      setFormError(mapped.formErrorKey);
    }
  });

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !isSubmitting && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {user ? t('users.form.editTitle') : t('users.form.createTitle')}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <Field
            name="first_name"
            label={t('users.form.firstName')}
            required
            error={errors.first_name?.message}
          >
            {(a11y) => (
              <TextInput
                {...a11y}
                {...register('first_name', {
                  required: 'users.errors.nameRequired',
                  maxLength: { value: 64, message: 'users.errors.nameRequired' },
                })}
                autoFocus
              />
            )}
          </Field>

          <Field
            name="last_name"
            label={t('users.form.lastName')}
            required
            error={errors.last_name?.message}
          >
            {(a11y) => (
              <TextInput
                {...a11y}
                {...register('last_name', {
                  required: 'users.errors.nameRequired',
                  maxLength: { value: 64, message: 'users.errors.nameRequired' },
                })}
              />
            )}
          </Field>

          <Field name="login" label={t('users.form.login')} required error={errors.login?.message}>
            {(a11y) => (
              <TextInput
                {...a11y}
                autoComplete="off"
                {...register('login', {
                  required: 'users.errors.loginRequired',
                  minLength: { value: 3, message: 'users.errors.loginRequired' },
                  maxLength: { value: 64, message: 'users.errors.loginRequired' },
                  validate: (v) => !/\s/.test(v) || 'users.errors.loginWhitespace',
                })}
              />
            )}
          </Field>

          <Field name="role" label={t('users.form.role')}>
            {(a11y) => (
              <SelectField {...a11y} {...register('role')}>
                <option value="point_operator">{t('users.roleLabel.point_operator')}</option>
                <option value="network_owner">{t('users.roleLabel.network_owner')}</option>
              </SelectField>
            )}
          </Field>

          {isOperator ? (
            <Field
              name="collection_point_id"
              label={t('users.form.point')}
              required
              error={errors.collection_point_id?.message}
            >
              {(a11y) => (
                <SelectField
                  {...a11y}
                  {...register('collection_point_id', {
                    validate: (v) =>
                      role !== 'point_operator' || v !== '' || 'users.errors.pointRequired',
                  })}
                >
                  <option value="">—</option>
                  {(points ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </SelectField>
              )}
            </Field>
          ) : null}

          {!user ? (
            <Field
              name="password"
              label={t('users.form.password')}
              required
              error={errors.password?.message}
            >
              {(a11y) => (
                <PasswordInput
                  {...a11y}
                  autoComplete="new-password"
                  {...register('password', {
                    required: 'users.errors.passwordShort',
                    minLength: { value: 8, message: 'users.errors.passwordShort' },
                  })}
                />
              )}
            </Field>
          ) : null}

          {user ? (
            <Field name="is_active" label={t('users.form.active')}>
              {(a11y) => (
                <Controller
                  control={control}
                  name="is_active"
                  render={({ field }) => (
                    <Switch id={a11y.id} checked={field.value} onCheckedChange={field.onChange} />
                  )}
                />
              )}
            </Field>
          ) : null}

          {formError ? (
            <p role="alert" className="text-sm text-destructive">
              {t(formError)}
            </p>
          ) : null}

          <DialogFooter>
            {user && onResetPassword ? (
              <Button
                type="button"
                variant="outline"
                disabled={isSubmitting}
                onClick={onResetPassword}
                className="sm:mr-auto"
              >
                {t('users.form.resetPassword')}
              </Button>
            ) : null}
            <Button type="button" variant="ghost" disabled={isSubmitting} onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
