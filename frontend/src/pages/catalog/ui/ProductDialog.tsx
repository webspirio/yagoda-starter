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
import { useCreateProductMutation, useUpdateProductMutation } from '../api/products';
import { apiErrorToFields } from '../lib/apiErrorToFields';
import type { Product, ProductFormValues } from '../model/product';

const FIELD_NAMES = ['name'] as const;

/**
 * One dialog for create AND edit — told apart by `product` (null = create). The
 * parent remounts it via a changing `key` on every open, so there is no reset
 * effect. The backend gives create and update the same one-field shape here.
 */
export function ProductDialog({
  product,
  open,
  onClose,
}: {
  product: Product | null;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const create = useCreateProductMutation();
  const update = useUpdateProductMutation();

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ProductFormValues>({ defaultValues: { name: product?.name ?? '' } });

  const [formError, setFormError] = useState<string | null>(null);

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    const name = values.name.trim();
    try {
      if (product) {
        await update.mutateAsync({ id: product.id, name });
        toast.success(t('catalog.products.toast.updated'));
      } else {
        await create.mutateAsync({ name });
        toast.success(t('catalog.products.toast.created'));
      }
      onClose();
    } catch (error) {
      const mapped = apiErrorToFields(error, FIELD_NAMES);
      for (const { field, messageKey } of mapped.fieldErrors) {
        setError(field as keyof ProductFormValues, { message: messageKey });
      }
      setFormError(mapped.formErrorKey);
    }
  });

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !isSubmitting && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {product ? t('catalog.products.form.editTitle') : t('catalog.products.form.createTitle')}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <Field
            name="name"
            label={t('catalog.products.form.name')}
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
