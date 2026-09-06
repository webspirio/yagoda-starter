import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUrlParam } from '@/shared/lib/url-state';
import { Button } from '@/shared/ui/button';
import { Badge } from '@/shared/ui/badge';
import { SelectField } from '@/shared/ui/select-field';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table';
import { Skeleton } from '@/shared/ui/skeleton';
import { useProductsQuery } from '../api/products';
import { useProductGradesQuery } from '../api/productGrades';
import { GradeFormDialog } from './GradeFormDialog';
import type { ProductGrade } from '../model/productGrade';

/**
 * Loads BOTH lists: a grade carries `product_id` and not the product's name,
 * so the product column, the create Select and the edit dialog's static parent
 * label are all client-side joins.
 *
 * The filter lives in the query string so "Малина's grades" is a link, and it
 * pre-selects that product when creating — the common path is adding several
 * grades to the berry already on screen.
 */
export function GradesTab() {
  const { t } = useTranslation();
  const [productId, setProductId] = useUrlParam('product_id');
  const products = useProductsQuery();
  const grades = useProductGradesQuery(productId ?? undefined);
  const [editing, setEditing] = useState<ProductGrade | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  // Bumped on every open so `GradeFormDialog` below remounts instead of being
  // reset by an effect: a fresh `key` gives it fresh `useForm` state (seeded
  // from `editing`/`productId` at mount) and a fresh `formError`, whether this
  // open is a different grade, the same grade again, or create after edit —
  // with no effect needed to tell those cases apart.
  const [dialogInstance, setDialogInstance] = useState(0);

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
    setDialogInstance((n) => n + 1);
  };
  const openEdit = (grade: ProductGrade) => {
    setEditing(grade);
    setDialogOpen(true);
    setDialogInstance((n) => n + 1);
  };

  if (grades.isPending || products.isPending) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  const productList = products.data?.data ?? [];
  const rows = grades.data?.data ?? [];
  const truncated = (grades.data?.total ?? 0) > rows.length;
  const nameOf = (id: string) => productList.find((p) => p.id === id)?.name ?? id;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <SelectField
          aria-label={t('catalog.grades.product')}
          className="max-w-xs"
          value={productId ?? ''}
          onChange={(event) => setProductId(event.target.value || null)}
        >
          <option value="">{t('catalog.grades.allProducts')}</option>
          {productList.map((product) => (
            <option key={product.id} value={product.id}>
              {product.name}
            </option>
          ))}
        </SelectField>
        <Button onClick={openCreate}>{t('catalog.grades.add')}</Button>
      </div>

      {truncated && (
        <p role="status" className="text-sm text-destructive">
          {t('catalog.truncated', { shown: rows.length, total: grades.data?.total })}
        </p>
      )}

      {rows.length === 0 ? (
        <p className="py-8 text-center text-muted-foreground">{t('catalog.grades.empty')}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('catalog.grades.product')}</TableHead>
              <TableHead>{t('catalog.grades.name')}</TableHead>
              <TableHead>{t('catalog.grades.active')}</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((grade) => (
              <TableRow key={grade.id}>
                <TableCell>{nameOf(grade.product_id)}</TableCell>
                <TableCell>{grade.name}</TableCell>
                <TableCell>
                  <Badge variant={grade.is_active ? 'default' : 'secondary'}>
                    {t(grade.is_active ? 'catalog.grades.active' : 'catalog.grades.inactive')}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    aria-label={`${t('catalog.actions.edit')} ${grade.name}`}
                    onClick={() => openEdit(grade)}
                  >
                    {t('catalog.actions.edit')}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <GradeFormDialog
        key={dialogInstance}
        open={dialogOpen}
        grade={editing}
        products={productList}
        defaultProductId={productId}
        onClose={() => setDialogOpen(false)}
      />
    </div>
  );
}
