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
  useCreateProductGradeMutation,
  useUpdateProductGradeMutation,
} from '../api/productGrades';
import { apiErrorToFields } from '../lib/apiErrorToFields';
import type { Product } from '../model/product';
import type { ProductGrade, ProductGradeFormValues } from '../model/productGrade';

const FIELD_NAMES = ['name', 'product_id'] as const;

/**
 * One dialog for create AND edit — told apart by `grade` (null = create). The
 * parent remounts it via a changing `key` on every open.
 *
 * `product_id` is a Select when CREATING and static text when EDITING (a grade
 * never changes parent, so a disabled control would only invite the question of
 * how to enable it). `is_active` appears only when editing — the create DTO has
 * no such field and a new grade is active. `defaultProductId` pre-selects the
 * product when a grade is created from a filtered view.
 */
export function GradeDialog({
  grade,
  products,
  defaultProductId,
  open,
  onClose,
}: {
  grade: ProductGrade | null;
  products: Product[];
  defaultProductId: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
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

  const [formError, setFormError] = useState<string | null>(null);

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    const name = values.name.trim();
    try {
      if (grade) {
        await update.mutateAsync({ id: grade.id, name, is_active: values.is_active });
        toast.success(t('catalog.grades.toast.updated'));
      } else {
        await create.mutateAsync({ product_id: values.product_id, name });
        toast.success(t('catalog.grades.toast.created'));
      }
      onClose();
    } catch (error) {
      const mapped = apiErrorToFields(error, FIELD_NAMES);
      for (const { field, messageKey } of mapped.fieldErrors) {
        setError(field as keyof ProductGradeFormValues, { message: messageKey });
      }
      setFormError(mapped.formErrorKey);
    }
  });

  const parentName = grade ? products.find((p) => p.id === grade.product_id)?.name : null;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !isSubmitting && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {grade ? t('catalog.grades.form.editTitle') : t('catalog.grades.form.createTitle')}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          {grade ? (
            // Static text, not a disabled Select: a label pointing at nothing
            // would announce as such to assistive tech, so this reproduces the
            // Field label styling directly rather than using Field.
            <div>
              <div className="mb-[7px] text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                {t('catalog.grades.form.product')}
              </div>
              <p className="text-base">{parentName ?? grade.product_id}</p>
            </div>
          ) : (
            <Field
              name="product_id"
              label={t('catalog.grades.form.product')}
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
            label={t('catalog.grades.form.name')}
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
                autoFocus={!grade}
              />
            )}
          </Field>

          {grade ? (
            <Field name="is_active" label={t('catalog.grades.form.active')}>
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
