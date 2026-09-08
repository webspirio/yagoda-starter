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
import { SelectField } from '@/shared/ui/select-field';
import { Switch } from '@/shared/ui/switch';
import { Textarea } from '@/shared/ui/textarea';
import { Button } from '@/shared/ui/button';
import { toast } from '@/shared/ui/toast';
import { usePointOptionsQuery } from '@/entities/collection-point';
import { useMeQuery } from '@/entities/user';
import { useCreateSupplierMutation, useUpdateSupplierMutation } from '../api/suppliers';
import { apiErrorToFields } from '../lib/apiErrorToFields';
import type {
  CreateSupplierInput,
  Supplier,
  SupplierFormValues,
  UpdateSupplierInput,
} from '../model/supplier';

const FIELD_NAMES = [
  'first_name',
  'last_name',
  'phone',
  'note',
  'kind',
  'collection_point_id',
  'is_active',
] as const;

function toDefaults(supplier: Supplier | null): SupplierFormValues {
  return {
    first_name: supplier?.first_name ?? '',
    last_name: supplier?.last_name ?? '',
    phone: supplier?.phone ?? '',
    // A stored supplier with no phone opens with the "no number" case set.
    hasNoPhone: supplier ? supplier.phone === null : false,
    kind: supplier?.kind ?? 'none',
    note: supplier?.note ?? '',
    collection_point_id: supplier?.collection_point_id ?? '',
    is_active: supplier?.is_active ?? true,
  };
}

/**
 * One dialog for create AND edit — told apart by `supplier` (null = create).
 * The parent remounts it via a changing `key` on every open, so there is no
 * reset effect.
 *
 * BOTH roles reach this form (suppliers are point-level and taken in the
 * moment). The point select shows ONLY for a network owner CREATING a supplier
 * — they must name the point; an operator's point comes from their token and
 * is omitted, and no one can re-point an existing supplier (§3.9), so the
 * select is absent on edit. The active switch shows only on edit. The PATCH
 * carries a field only when it actually changed.
 */
export function SupplierFormDialog({
  supplier,
  open,
  onClose,
}: {
  supplier: Supplier | null;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const create = useCreateSupplierMutation();
  const update = useUpdateSupplierMutation();
  const { data: points } = usePointOptionsQuery();
  const { data: me } = useMeQuery();
  const isOwner = me?.role === 'network_owner';

  const {
    register,
    handleSubmit,
    control,
    setError,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<SupplierFormValues>({ defaultValues: toDefaults(supplier) });

  const [formError, setFormError] = useState<string | null>(null);
  const hasNoPhone = useWatch({ control, name: 'hasNoPhone' });
  // Owner names a point at creation; on edit the point is fixed.
  const showPointSelect = isOwner && !supplier;

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    const firstName = values.first_name.trim();
    const lastName = values.last_name.trim();
    const note = values.note.trim();
    const nextNote = note === '' ? null : note;
    // "No phone" submits null WITHOUT reading the (disabled, cleared) field; an
    // enabled-but-blank field is null too — never an empty string.
    const rawPhone = values.hasNoPhone ? '' : values.phone.trim();
    const nextPhone = rawPhone === '' ? null : rawPhone;

    try {
      if (supplier) {
        const body: UpdateSupplierInput = { id: supplier.id };
        if (firstName !== supplier.first_name) body.first_name = firstName;
        if (lastName !== supplier.last_name) body.last_name = lastName;
        if (nextPhone !== supplier.phone) body.phone = nextPhone;
        if (nextNote !== supplier.note) body.note = nextNote;
        if (values.kind !== supplier.kind) body.kind = values.kind;
        if (values.is_active !== supplier.is_active) body.is_active = values.is_active;
        await update.mutateAsync(body);
        toast.success(t('suppliers.toast.updated'));
      } else {
        const input: CreateSupplierInput = {
          first_name: firstName,
          last_name: lastName,
          phone: nextPhone,
          note: nextNote,
          kind: values.kind,
        };
        // Owner sends the chosen point; operator omits it (server derives it).
        if (isOwner) input.collection_point_id = values.collection_point_id;
        await create.mutateAsync(input);
        toast.success(t('suppliers.toast.created'));
      }
      onClose();
    } catch (error) {
      const mapped = apiErrorToFields(error, FIELD_NAMES);
      for (const { field, messageKey } of mapped.fieldErrors) {
        setError(field as keyof SupplierFormValues, { message: messageKey });
      }
      setFormError(mapped.formErrorKey);
    }
  });

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !isSubmitting && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {supplier ? t('suppliers.form.editTitle') : t('suppliers.form.createTitle')}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <Field
            name="first_name"
            label={t('suppliers.form.firstName')}
            required
            error={errors.first_name?.message}
          >
            {(a11y) => (
              <TextInput
                {...a11y}
                {...register('first_name', {
                  required: 'suppliers.errors.nameRequired',
                  maxLength: { value: 128, message: 'suppliers.errors.nameRequired' },
                })}
                autoFocus
              />
            )}
          </Field>

          <Field
            name="last_name"
            label={t('suppliers.form.lastName')}
            required
            error={errors.last_name?.message}
          >
            {(a11y) => (
              <TextInput
                {...a11y}
                {...register('last_name', {
                  required: 'suppliers.errors.nameRequired',
                  maxLength: { value: 128, message: 'suppliers.errors.nameRequired' },
                })}
              />
            )}
          </Field>

          <Field name="phone" label={t('suppliers.form.phone')} error={errors.phone?.message}>
            {(a11y) => (
              <TextInput
                {...a11y}
                inputMode="tel"
                autoComplete="off"
                disabled={hasNoPhone}
                {...register('phone', {
                  maxLength: { value: 32, message: 'suppliers.errors.phoneInvalid' },
                })}
              />
            )}
          </Field>

          <Field name="hasNoPhone" label={t('suppliers.form.noPhone')}>
            {(a11y) => (
              <Controller
                control={control}
                name="hasNoPhone"
                render={({ field }) => (
                  <Switch
                    id={a11y.id}
                    checked={field.value}
                    onCheckedChange={(checked) => {
                      field.onChange(checked);
                      // Clear the number when "no phone" is turned on.
                      if (checked) setValue('phone', '');
                    }}
                  />
                )}
              />
            )}
          </Field>

          <Field name="kind" label={t('suppliers.form.kind')}>
            {(a11y) => (
              <SelectField {...a11y} {...register('kind')}>
                <option value="none">{t('suppliers.kindLabel.none')}</option>
                <option value="wholesale">{t('suppliers.kindLabel.wholesale')}</option>
                <option value="farmer">{t('suppliers.kindLabel.farmer')}</option>
              </SelectField>
            )}
          </Field>

          <Field name="note" label={t('suppliers.form.note')} error={errors.note?.message}>
            {(a11y) => <Textarea {...a11y} {...register('note')} />}
          </Field>

          {showPointSelect ? (
            <Field
              name="collection_point_id"
              label={t('suppliers.form.point')}
              required
              error={errors.collection_point_id?.message}
            >
              {(a11y) => (
                <SelectField
                  {...a11y}
                  {...register('collection_point_id', {
                    validate: (v) => v !== '' || 'suppliers.errors.pointRequired',
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

          {supplier ? (
            <Field name="is_active" label={t('suppliers.form.active')}>
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
