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
import { SelectField } from '@/shared/ui/select-field';
import { Switch } from '@/shared/ui/switch';
import { Button } from '@/shared/ui/button';
import { toast } from '@/shared/ui/toast';
import {
  useCreateCollectionPointMutation,
  useUpdateCollectionPointMutation,
} from '../api/collectionPoints';
import { apiErrorToFields } from '../lib/apiErrorToFields';
import type { CollectionPoint, CollectionPointFormValues } from '../model/collectionPoint';

const DECIMAL = /^\d{1,10}(\.\d{1,2})?$/;
const INTEGER = /^\d+$/;
const FIELD_NAMES = ['name', 'kind', 'target_cash', 'target_crates', 'is_active'] as const;

function toDefaults(point: CollectionPoint | null): CollectionPointFormValues {
  return {
    name: point?.name ?? '',
    kind: point?.kind ?? 'reception',
    target_cash: point?.target_cash ?? '',
    target_crates: point?.target_crates == null ? '' : String(point.target_crates),
    is_active: point?.is_active ?? true,
  };
}

/**
 * One dialog for create AND edit — told apart by `point` (null = create). The
 * parent remounts it via a changing `key` on every open, so there is no reset
 * effect. Money/crate targets are optional: an empty field clears the target
 * (sends `null`), never `0`.
 */
export function PointFormDialog({
  point,
  open,
  onClose,
}: {
  point: CollectionPoint | null;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const create = useCreateCollectionPointMutation();
  const update = useUpdateCollectionPointMutation();

  const {
    register,
    handleSubmit,
    control,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<CollectionPointFormValues>({ defaultValues: toDefaults(point) });

  const [formError, setFormError] = useState<string | null>(null);

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    const cash = values.target_cash.trim().replace(',', '.');
    const crates = values.target_crates.trim();
    const targets = {
      target_cash: cash === '' ? null : cash,
      target_crates: crates === '' ? null : Number(crates),
    };
    try {
      if (point) {
        await update.mutateAsync({
          id: point.id,
          name: values.name.trim(),
          kind: values.kind,
          is_active: values.is_active,
          ...targets,
        });
        toast.success(t('points.toast.updated'));
      } else {
        await create.mutateAsync({ name: values.name.trim(), kind: values.kind, ...targets });
        toast.success(t('points.toast.created'));
      }
      onClose();
    } catch (error) {
      const mapped = apiErrorToFields(error, FIELD_NAMES);
      for (const { field, messageKey } of mapped.fieldErrors) {
        setError(field as keyof CollectionPointFormValues, { message: messageKey });
      }
      setFormError(mapped.formErrorKey);
    }
  });

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !isSubmitting && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{point ? t('points.form.editTitle') : t('points.form.createTitle')}</DialogTitle>
        </DialogHeader>

        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <Field name="name" label={t('points.form.name')} required error={errors.name?.message}>
            {(a11y) => (
              <TextInput
                {...a11y}
                {...register('name', {
                  required: 'points.errors.nameRequired',
                  maxLength: { value: 128, message: 'points.errors.nameInvalid' },
                })}
                autoFocus
              />
            )}
          </Field>

          <Field name="kind" label={t('points.form.kind')}>
            {(a11y) => (
              <SelectField {...a11y} {...register('kind')}>
                <option value="reception">{t('points.kind.reception')}</option>
                <option value="base">{t('points.kind.base')}</option>
              </SelectField>
            )}
          </Field>

          <Field
            name="target_cash"
            label={t('points.form.targetCash')}
            hint={t('points.form.targetHint')}
            error={errors.target_cash?.message}
          >
            {(a11y) => (
              <TextInput
                {...a11y}
                inputMode="decimal"
                placeholder="—"
                {...register('target_cash', {
                  validate: (v) =>
                    v.trim() === '' ||
                    DECIMAL.test(v.trim().replace(',', '.')) ||
                    'points.errors.cashFormat',
                })}
              />
            )}
          </Field>

          <Field
            name="target_crates"
            label={t('points.form.targetCrates')}
            hint={t('points.form.targetHint')}
            error={errors.target_crates?.message}
          >
            {(a11y) => (
              <TextInput
                {...a11y}
                inputMode="numeric"
                placeholder="—"
                {...register('target_crates', {
                  validate: (v) =>
                    v.trim() === '' || INTEGER.test(v.trim()) || 'points.errors.cratesFormat',
                })}
              />
            )}
          </Field>

          {point ? (
            <Field name="is_active" label={t('points.form.active')}>
              {(a11y) => (
                <Controller
                  control={control}
                  name="is_active"
                  render={({ field }) => (
                    <Switch
                      id={a11y.id}
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
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
