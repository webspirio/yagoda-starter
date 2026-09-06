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
import { Button } from '@/shared/ui/button';
import { Field } from '@/shared/ui/field';
import { TextInput } from '@/shared/ui/text-input';
import { toastSuccess } from '@/shared/ui/toast';
import { useCreateProductMutation, useUpdateProductMutation } from '../api/products';
import { apiErrorToFields } from '../lib/apiErrorToFields';
import type { Product, ProductFormValues } from '../model/product';

const FIELDS = ['name'] as const;

/**
 * One dialog for create AND edit, told apart by whether `product` is null.
 *
 * They share every validation rule, and the backend deliberately gives create
 * and update DIFFERENT DTO shapes — so the difference belongs in one visible
 * mode flag rather than two components that drift apart.
 *
 * There is no reset-on-open effect here. `ProductsTab` remounts this
 * component (via a `key` that changes on every open) each time the dialog is
 * opened, so `useForm`'s `defaultValues` and this component's own
 * `formError` state are simply re-initialised by mounting rather than
 * reset by an effect — nothing here is derived from an impure external
 * system, so there is nothing an effect should own.
 */
export function ProductFormDialog({
  open,
  product,
  onClose,
}: {
  open: boolean;
  product: Product | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [formError, setFormError] = useState<string | null>(null);
  const create = useCreateProductMutation();
  const update = useUpdateProductMutation();

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ProductFormValues>({ defaultValues: { name: product?.name ?? '' } });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      if (product) await update.mutateAsync({ id: product.id, ...values });
      else await create.mutateAsync(values);
      toastSuccess(t('catalog.saved'));
      onClose();
    } catch (error) {
      const { fieldErrors, formErrorKey } = apiErrorToFields(error, FIELDS);
      for (const { field, messageKey } of fieldErrors) {
        setError(field as keyof ProductFormValues, { message: messageKey });
      }
      setFormError(formErrorKey);
    }
  });

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t(product ? 'catalog.products.editTitle' : 'catalog.products.createTitle')}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          {/* `Field`'s `error` takes an i18n KEY and resolves it internally,
              which is why every RHF `message` in this slice is a key. */}
          <Field
            name="name"
            label={t('catalog.products.name')}
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

          {formError && (
            <p role="alert" className="text-sm text-destructive">
              {t(formError)}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
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
