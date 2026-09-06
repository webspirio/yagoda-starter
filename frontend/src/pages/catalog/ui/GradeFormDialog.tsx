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
import { SelectField } from '@/shared/ui/select-field';
import { Switch } from '@/shared/ui/switch';
import { toastSuccess } from '@/shared/ui/toast';
import {
  useCreateProductGradeMutation,
  useUpdateProductGradeMutation,
} from '../api/productGrades';
import { apiErrorToFields } from '../lib/apiErrorToFields';
import type { Product } from '../model/product';
import type { ProductGrade, ProductGradeFormValues } from '../model/productGrade';

const FIELDS = ['name', 'product_id'] as const;

/**
 * `product_id` is a Select when CREATING and static text when EDITING — not a
 * disabled Select. A grade never changes parent (moving it would retroactively
 * move every receipt line written against it into another product's totals),
 * and a disabled control invites someone to wonder how to enable it, whereas
 * text simply states a fact.
 *
 * `is_active` appears only when editing: the API has no such field on create,
 * and a new grade is active.
 *
 * There is no reset-on-open effect here. `GradesTab` remounts this component
 * (via a `key` that changes on every open) each time the dialog is opened, so
 * `useForm`'s `defaultValues` and this component's own `formError` state are
 * simply re-initialised by mounting rather than reset by an effect — nothing
 * here is derived from an impure external system, so there is nothing an
 * effect should own.
 */
export function GradeFormDialog({
  open,
  grade,
  products,
  defaultProductId,
  onClose,
}: {
  open: boolean;
  grade: ProductGrade | null;
  products: Product[];
  defaultProductId: string | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [formError, setFormError] = useState<string | null>(null);
  const create = useCreateProductGradeMutation();
  const update = useUpdateProductGradeMutation();

  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ProductGradeFormValues>({
    defaultValues: {
      product_id: grade?.product_id ?? defaultProductId ?? '',
      name: grade?.name ?? '',
      is_active: grade?.is_active ?? true,
    },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      if (grade) {
        await update.mutateAsync({
          id: grade.id,
          name: values.name,
          is_active: values.is_active,
        });
      } else {
        await create.mutateAsync({ product_id: values.product_id, name: values.name });
      }
      toastSuccess(t('catalog.saved'));
      onClose();
    } catch (error) {
      const { fieldErrors, formErrorKey } = apiErrorToFields(error, FIELDS);
      for (const { field, messageKey } of fieldErrors) {
        setError(field as keyof ProductGradeFormValues, { message: messageKey });
      }
      setFormError(formErrorKey);
    }
  });

  const parentName = grade ? products.find((p) => p.id === grade.product_id)?.name : null;

  return (
    // Gated on `isSubmitting` too: without it, Escape or an overlay click
    // can close a submitting dialog exactly like Cancel could (see below).
    <Dialog open={open} onOpenChange={(next) => !next && !isSubmitting && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t(grade ? 'catalog.grades.editTitle' : 'catalog.grades.createTitle')}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          {grade ? (
            // Not `Field`: its `<label htmlFor>` would point at no element
            // here, since this render prop is static text rather than a
            // focusable control — a label with no target does nothing on
            // click and announces to assistive tech as pointing nowhere.
            // This reproduces `Field`'s visual label styling directly.
            <div>
              <div className="mb-[7px] text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                {t('catalog.grades.product')}
              </div>
              <p className="text-base">
                {/* Falls back to the raw id: the FK guarantees the product
                    exists, so a blank cell here would hide a real bug. */}
                {parentName ?? grade.product_id}
              </p>
            </div>
          ) : (
            <Field
              name="product_id"
              label={t('catalog.grades.product')}
              required
              error={errors.product_id?.message}
            >
              {(a11y) => (
                <SelectField
                  {...a11y}
                  {...register('product_id', { required: 'catalog.errors.productRequired' })}
                >
                  <option value="">—</option>
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name}
                    </option>
                  ))}
                </SelectField>
              )}
            </Field>
          )}

          <Field
            name="name"
            label={t('catalog.grades.name')}
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

          {grade && (
            <Field name="is_active" label={t('catalog.grades.activeLabel')}>
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
