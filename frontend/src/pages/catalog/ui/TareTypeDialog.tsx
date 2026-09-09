import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
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
import { Switch } from '@/shared/ui/switch';
import { Button } from '@/shared/ui/button';
import { toast } from '@/shared/ui/toast';
import { useCreateTareTypeMutation, useUpdateTareTypeMutation } from '../api/tareTypes';
import { apiErrorToFields } from '../lib/apiErrorToFields';
import type { TareType, TareTypeFormValues } from '../model/tareType';

const FIELD_NAMES = ['name', 'weight_kg', 'deposit_price'] as const;

// The patterns mirror the server's columns exactly: numeric(10,2) is 8 integer
// digits, numeric(12,2) is 10. Zero is legal for both; the leading \d refuses a
// minus sign before the request is ever made.
const WEIGHT_PATTERN = /^\d{1,8}(\.\d{1,2})?$/;
const DEPOSIT_PATTERN = /^\d{1,10}(\.\d{1,2})?$/;

/**
 * One dialog for create AND edit — told apart by `tareType` (null = create). The
 * parent remounts it via a changing `key` on every open.
 *
 * The two numeric inputs are TEXT inputs with `inputMode="decimal"`, never
 * `type="number"`: a number input coerces '1.20' into 1.2 before the form state
 * settles, reintroducing binary float into money. `setValueAs` only substitutes
 * a comma for a dot (never `Number()`), so the value stays a string end to end.
 * `is_active` appears only when editing — a new tare type is active.
 */
export function TareTypeDialog({
  tareType,
  open,
  onClose,
}: {
  tareType: TareType | null;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const create = useCreateTareTypeMutation();
  const update = useUpdateTareTypeMutation();

  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<TareTypeFormValues>({
    defaultValues: {
      name: tareType?.name ?? '',
      weight_kg: tareType?.weight_kg ?? '',
      deposit_price: tareType?.deposit_price ?? '',
      is_crate: tareType?.is_crate ?? false,
      is_active: tareType?.is_active ?? true,
    },
  });

  const [formError, setFormError] = useState<string | null>(null);

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    const name = values.name.trim();
    try {
      if (tareType) {
        await update.mutateAsync({
          id: tareType.id,
          name,
          weight_kg: values.weight_kg,
          deposit_price: values.deposit_price,
          is_crate: values.is_crate,
          is_active: values.is_active,
        });
        toast.success(t('catalog.tareTypes.toast.updated'));
      } else {
        // `is_active` is not on the create DTO — spell out the four create
        // fields rather than spreading `values`.
        await create.mutateAsync({
          name,
          weight_kg: values.weight_kg,
          deposit_price: values.deposit_price,
          is_crate: values.is_crate,
        });
        toast.success(t('catalog.tareTypes.toast.created'));
      }
      onClose();
    } catch (error) {
      const mapped = apiErrorToFields(error, FIELD_NAMES);
      for (const { field, messageKey } of mapped.fieldErrors) {
        setError(field as keyof TareTypeFormValues, { message: messageKey });
      }
      setFormError(mapped.formErrorKey);
    }
  });

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !isSubmitting && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {tareType
              ? t('catalog.tareTypes.form.editTitle')
              : t('catalog.tareTypes.form.createTitle')}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <Field
            name="name"
            label={t('catalog.tareTypes.form.name')}
            required
            error={errors.name?.message}
          >
            {(a11y) => (
              <TextInput
                {...a11y}
                {...register('name', {
                  required: 'catalog.errors.nameRequired',
                  maxLength: { value: 128, message: 'catalog.errors.nameTooLong' },
                })}
                autoFocus
              />
            )}
          </Field>

          <Field
            name="weight_kg"
            label={t('catalog.tareTypes.form.weight')}
            required
            error={errors.weight_kg?.message}
          >
            {(a11y) => (
              <TextInput
                {...a11y}
                inputMode="decimal"
                {...register('weight_kg', {
                  required: 'catalog.errors.weightFormat',
                  pattern: { value: WEIGHT_PATTERN, message: 'catalog.errors.weightFormat' },
                  setValueAs: (v: string) => v.trim().replace(',', '.'),
                })}
              />
            )}
          </Field>

          <Field
            name="deposit_price"
            label={t('catalog.tareTypes.form.deposit')}
            required
            error={errors.deposit_price?.message}
          >
            {(a11y) => (
              <TextInput
                {...a11y}
                inputMode="decimal"
                {...register('deposit_price', {
                  required: 'catalog.errors.depositFormat',
                  pattern: { value: DEPOSIT_PATTERN, message: 'catalog.errors.depositFormat' },
                  setValueAs: (v: string) => v.trim().replace(',', '.'),
                })}
              />
            )}
          </Field>

          <Field name="is_crate" label={t('catalog.tareTypes.form.isCrate')}>
            {(a11y) => (
              <Controller
                control={control}
                name="is_crate"
                render={({ field }) => (
                  <Switch id={a11y.id} checked={field.value} onCheckedChange={field.onChange} />
                )}
              />
            )}
          </Field>

          {tareType ? (
            <Field name="is_active" label={t('catalog.tareTypes.form.active')}>
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
