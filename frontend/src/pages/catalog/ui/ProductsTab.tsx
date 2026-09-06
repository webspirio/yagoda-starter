import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';
import { Skeleton } from '@/shared/ui/skeleton';
import { useProductsQuery } from '../api/products';
import { ProductFormDialog } from './ProductFormDialog';
import type { Product } from '../model/product';

/**
 * There is no delete action and there never will be: a product is retired by
 * deactivating its grades, which is why this table has no `is_active` column
 * either — a product has no such field.
 */
export function ProductsTab() {
  const { t } = useTranslation();
  const { data, isPending } = useProductsQuery();
  const [editing, setEditing] = useState<Product | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  // Bumped on every open so `ProductFormDialog` below remounts instead of
  // being reset by an effect: a fresh `key` gives it fresh `useForm` state
  // (seeded from `editing` at mount) and a fresh `formError`, whether this
  // open is a different product, the same product again, or create after
  // edit — with no effect needed to tell those cases apart.
  const [dialogInstance, setDialogInstance] = useState(0);

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
    setDialogInstance((n) => n + 1);
  };
  const openEdit = (product: Product) => {
    setEditing(product);
    setDialogOpen(true);
    setDialogInstance((n) => n + 1);
  };

  // Skeleton rows rather than a spinner: the row count is roughly known, so
  // this avoids the layout jump a spinner causes when data lands.
  if (isPending) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  const products = data?.data ?? [];
  const truncated = (data?.total ?? 0) > products.length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button onClick={openCreate}>{t('catalog.products.add')}</Button>
      </div>

      {truncated && (
        <p role="status" className="text-sm text-destructive">
          {t('catalog.truncated', { shown: products.length, total: data?.total })}
        </p>
      )}

      {products.length === 0 ? (
        <p className="py-8 text-center text-muted-foreground">{t('catalog.products.empty')}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('catalog.products.name')}</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {products.map((product) => (
              <TableRow key={product.id}>
                <TableCell>{product.name}</TableCell>
                <TableCell>
                  {/* Named per row so a test — and a screen reader — can tell
                      one Edit button from another. */}
                  <Button
                    variant="ghost"
                    aria-label={`${t('catalog.actions.edit')} ${product.name}`}
                    onClick={() => openEdit(product)}
                  >
                    {t('catalog.actions.edit')}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <ProductFormDialog
        key={dialogInstance}
        open={dialogOpen}
        product={editing}
        onClose={() => setDialogOpen(false)}
      />
    </div>
  );
}
