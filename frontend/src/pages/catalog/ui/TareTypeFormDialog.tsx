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
import { Button } from '@/shared/ui/button';
import { Field } from '@/shared/ui/field';
import { TextInput } from '@/shared/ui/text-input';
import { Switch } from '@/shared/ui/switch';
import { toastSuccess } from '@/shared/ui/toast';
import { useCreateTareTypeMutation, useUpdateTareTypeMutation } from '../api/tareTypes';
import { apiErrorToFields } from '../lib/apiErrorToFields';
import type { TareType, TareTypeFormValues } from '../model/tareType';

const FIELDS = ['name', 'weight_kg', 'deposit_price'] as const;

/**
 * The two numeric inputs are TEXT inputs with `inputMode="decimal"`, never
 * `type="number"`. A number input hands back a coerced value, which turns
 * '1.20' into 1.2 before the form state has even settled — reintroducing
 * binary float into money the moment someone types. `inputMode` still gets a
 * numeric keypad on a phone without changing the value's type.
 *
 * The patterns mirror the server's columns exactly: `numeric(10,2)` is 8
 * integer digits, `numeric(12,2)` is 10. Zero is legal for both; negative is
 * not, and the leading `\d` refuses a minus sign before the request is made.
 *
 * There is deliberately NO rule tying `deposit_price` to `is_crate`. The
 * backend refused to add that CHECK because no domain rule asks for it, and a
 * form that invents it would block a case the domain permits.
 */
const WEIGHT_PATTERN = /^\d{1,8}(\.\d{1,2})?$/;
const DEPOSIT_PATTERN = /^\d{1,10}(\.\d{1,2})?$/;

/**
 * There is no reset-on-open effect here. `TareTypesTab` remounts this
 * component (via a `key` that changes on every open) each time the dialog is
 * opened, so `useForm`'s `defaultValues` and this component's own `formError`
 * state are simply re-initialised by mounting rather than reset by an effect —
 * nothing here is derived from an impure external system, so there is nothing
 * an effect should own.
 */
export function TareTypeFormDialog({
  open,
  tareType,
  onClose,
}: {
  open: boolean;
  tareType: TareType | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [formError, setFormError] = useState<string | null>(null);
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

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      if (tareType) {
        await update.mutateAsync({ id: tareType.id, ...values });
      } else {
        // Built explicitly rather than destructured off `values`: `is_active`
        // is not on the create DTO (a new tare type is active), and spelling
        // out the four create fields here documents that DTO's shape at the
        // call site instead of relying on an unused-binding discard.
        await create.mutateAsync({
          name: values.name,
          weight_kg: values.weight_kg,
          deposit_price: values.deposit_price,
          is_crate: values.is_crate,
        });
      }
      toastSuccess(t('catalog.saved'));
      onClose();
    } catch (error) {
      const { fieldErrors, formErrorKey } = apiErrorToFields(error, FIELDS);
      for (const { field, messageKey } of fieldErrors) {
        setError(field as keyof TareTypeFormValues, { message: messageKey });
      }
      setFormError(formErrorKey);
    }
  });

  return (
    // Gated on `isSubmitting` too: without it, Escape or an overlay click
    // can close a submitting dialog exactly like Cancel could (see below).
    <Dialog open={open} onOpenChange={(next) => !next && !isSubmitting && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t(tareType ? 'catalog.tareTypes.editTitle' : 'catalog.tareTypes.createTitle')}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <Field
            name="name"
            label={t('catalog.tareTypes.name')}
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
              />
            )}
          </Field>

          <Field
            name="weight_kg"
            label={t('catalog.tareTypes.weight')}
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
                  // `inputMode="decimal"` shows the device locale's
                  // separator, which is a comma on a Ukrainian phone or
                  // keyboard layout. A pure string substitution — never
                  // `Number()`/`parseFloat`, which would put a binary float
                  // back between the keypress and the wire.
                  setValueAs: (v: string) => v.replace(',', '.'),
                })}
              />
            )}
          </Field>

          <Field
            name="deposit_price"
            label={t('catalog.tareTypes.deposit')}
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
                  setValueAs: (v: string) => v.replace(',', '.'),
                })}
              />
            )}
          </Field>

          <Field name="is_crate" label={t('catalog.tareTypes.isCrate')}>
            {(a11y) => (
              <Controller
                name="is_crate"
                control={control}
                render={({ field }) => (
                  <Switch {...a11y} checked={field.value} onCheckedChange={field.onChange} />
                )}
              />
            )}
          </Field>

          {tareType && (
            <Field name="is_active" label={t('catalog.tareTypes.activeLabel')}>
              {(a11y) => (
                <Controller
                  name="is_active"
                  control={control}
                  render={({ field }) => (
                    <Switch {...a11y} checked={field.value} onCheckedChange={field.onChange} />
                  )}
                />
              )}
            </Field>
          )}

          {formError && (
            <p role="alert" className="text-sm text-destructive">
              {t(formError)}
            </p>
          )}

          <DialogFooter>
            {/* Disabled while submitting: a stale instance's `await
                mutateAsync` resolving after Cancel → Add-again would
                otherwise close the freshly-opened dialog and discard what
                the user just typed into it. */}
            <Button type="button" variant="ghost" onClick={onClose} disabled={isSubmitting}>
              {t('catalog.actions.cancel')}
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {t('catalog.actions.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
