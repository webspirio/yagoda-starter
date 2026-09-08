import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useUrlParam } from '@/shared/lib/url-state';
import { PageHeader } from '@/shared/ui/page-header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/tabs';
import { DataTable, type Column } from '@/shared/ui/data-table';
import { Button } from '@/shared/ui/button';
import { Badge } from '@/shared/ui/badge';
import { SelectField } from '@/shared/ui/select-field';
import { EmptyState } from '@/shared/ui/empty-state';
import { Spinner } from '@/shared/ui/spinner';
import { useProductsQuery } from '../api/products';
import { useProductGradesQuery } from '../api/productGrades';
import { useTareTypesQuery } from '../api/tareTypes';
import { ProductDialog } from './ProductDialog';
import { GradeDialog } from './GradeDialog';
import { TareTypeDialog } from './TareTypeDialog';
import type { Product } from '../model/product';
import type { ProductGrade } from '../model/productGrade';
import type { TareType } from '../model/tareType';

const TABS = ['products', 'grades', 'tareTypes'] as const;
type TabId = (typeof TABS)[number];

const isTabId = (value: string | null): value is TabId =>
  value !== null && (TABS as readonly string[]).includes(value);

/**
 * One owner-only screen for all three catalogs, because they are one job: an
 * owner setting up a season adds a berry, adds its grades, then adds the tare it
 * arrives in. The active tab lives in the query string so it survives a reload
 * and can be linked; `useUrlParam` REPLACES rather than pushes, so switching
 * tabs does not fill the back stack.
 */
export function CatalogPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useUrlParam('tab');
  // A hand-edited or stale URL falls back rather than rendering an empty shell.
  const active: TabId = isTabId(tab) ? tab : 'products';

  return (
    <div className="mx-auto w-full" style={{ maxWidth: 1200 }}>
      <PageHeader
        eyebrow={t('catalog.eyebrow')}
        title={t('catalog.title')}
        description={t('catalog.description')}
      />
      <Tabs value={active} onValueChange={(next) => setTab(next)}>
        <TabsList>
          <TabsTrigger value="products">{t('catalog.tabs.products')}</TabsTrigger>
          <TabsTrigger value="grades">{t('catalog.tabs.grades')}</TabsTrigger>
          <TabsTrigger value="tareTypes">{t('catalog.tabs.tareTypes')}</TabsTrigger>
        </TabsList>

        <TabsContent value="products" className="mt-5">
          <ProductsPanel />
        </TabsContent>
        <TabsContent value="grades" className="mt-5">
          <GradesPanel />
        </TabsContent>
        <TabsContent value="tareTypes" className="mt-5">
          <TareTypesPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/** Shared loading / error scaffold so each panel reads the same. */
function AsyncBody({
  isPending,
  isError,
  isEmpty,
  empty,
  children,
}: {
  isPending: boolean;
  isError: boolean;
  isEmpty: boolean;
  empty: ReactNode;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  if (isPending) {
    return (
      <div className="flex justify-center py-12">
        <Spinner />
      </div>
    );
  }
  if (isError) {
    return (
      <p role="alert" className="py-6 text-center text-destructive">
        {t('common.somethingWentWrong')}
      </p>
    );
  }
  if (isEmpty) return <>{empty}</>;
  return <>{children}</>;
}

function ProductsPanel() {
  const { t } = useTranslation();
  const { data, isPending, isError } = useProductsQuery();

  const [editing, setEditing] = useState<Product | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogInstance, setDialogInstance] = useState(0);

  const openCreate = () => {
    setEditing(null);
    setDialogInstance((n) => n + 1);
    setDialogOpen(true);
  };
  const openEdit = (product: Product) => {
    setEditing(product);
    setDialogInstance((n) => n + 1);
    setDialogOpen(true);
  };

  const rows = data?.data ?? [];

  const columns: Column<Product>[] = [
    {
      id: 'name',
      header: t('catalog.products.col.name'),
      cell: (p) => <span className="font-medium">{p.name}</span>,
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button onClick={openCreate}>{t('catalog.products.new')}</Button>
      </div>

      <AsyncBody
        isPending={isPending}
        isError={isError}
        isEmpty={rows.length === 0}
        empty={
          <EmptyState
            title={t('catalog.products.empty.title')}
            hint={t('catalog.products.empty.hint')}
          />
        }
      >
        <DataTable<Product> columns={columns} rows={rows} rowKey={(p) => p.id} onRowClick={openEdit} />
      </AsyncBody>

      <ProductDialog
        key={dialogInstance}
        product={editing}
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
      />
    </div>
  );
}

function GradesPanel() {
  const { t } = useTranslation();
  const [productId, setProductId] = useUrlParam('product_id');
  const filterId = productId ? productId : undefined;

  const { data: productsData } = useProductsQuery();
  const products = productsData?.data ?? [];
  const { data, isPending, isError } = useProductGradesQuery(filterId);

  const [editing, setEditing] = useState<ProductGrade | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogInstance, setDialogInstance] = useState(0);

  const openCreate = () => {
    setEditing(null);
    setDialogInstance((n) => n + 1);
    setDialogOpen(true);
  };
  const openEdit = (grade: ProductGrade) => {
    setEditing(grade);
    setDialogInstance((n) => n + 1);
    setDialogOpen(true);
  };

  const rows = data?.data ?? [];
  const productName = new Map(products.map((p) => [p.id, p.name]));

  const columns: Column<ProductGrade>[] = [
    {
      id: 'name',
      header: t('catalog.grades.col.name'),
      cell: (g) => <span className="font-medium">{g.name}</span>,
    },
    {
      id: 'product',
      header: t('catalog.grades.col.product'),
      cell: (g) => productName.get(g.product_id) ?? '—',
    },
    {
      id: 'is_active',
      header: t('catalog.grades.col.status'),
      align: 'right',
      cell: (g) => (
        <Badge variant={g.is_active ? 'default' : 'secondary'}>
          {g.is_active ? t('catalog.grades.active') : t('catalog.grades.inactive')}
        </Badge>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="w-full max-w-xs">
          <SelectField
            aria-label={t('catalog.grades.filterLabel')}
            value={productId ?? ''}
            onChange={(e) => setProductId(e.target.value === '' ? null : e.target.value)}
          >
            <option value="">{t('catalog.grades.allProducts')}</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </SelectField>
        </div>
        <Button onClick={openCreate}>{t('catalog.grades.new')}</Button>
      </div>

      <AsyncBody
        isPending={isPending}
        isError={isError}
        isEmpty={rows.length === 0}
        empty={
          <EmptyState
            title={t('catalog.grades.empty.title')}
            hint={t('catalog.grades.empty.hint')}
          />
        }
      >
        <DataTable<ProductGrade>
          columns={columns}
          rows={rows}
          rowKey={(g) => g.id}
          onRowClick={openEdit}
        />
      </AsyncBody>

      <GradeDialog
        key={dialogInstance}
        grade={editing}
        products={products}
        defaultProductId={filterId ?? null}
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
      />
    </div>
  );
}

function TareTypesPanel() {
  const { t } = useTranslation();
  const { data, isPending, isError } = useTareTypesQuery();

  const [editing, setEditing] = useState<TareType | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogInstance, setDialogInstance] = useState(0);

  const openCreate = () => {
    setEditing(null);
    setDialogInstance((n) => n + 1);
    setDialogOpen(true);
  };
  const openEdit = (tareType: TareType) => {
    setEditing(tareType);
    setDialogInstance((n) => n + 1);
    setDialogOpen(true);
  };

  const rows = data?.data ?? [];

  // Money/weight are decimal STRINGS from the wire — rendered raw, never through
  // toFixed or Number, so no value ever passes through a binary float here.
  const columns: Column<TareType>[] = [
    {
      id: 'name',
      header: t('catalog.tareTypes.col.name'),
      cell: (x) => <span className="font-medium">{x.name}</span>,
    },
    {
      id: 'weight_kg',
      header: t('catalog.tareTypes.col.weight'),
      align: 'right',
      className: 'font-mono tabular-nums',
      cell: (x) => x.weight_kg || '—',
    },
    {
      id: 'deposit_price',
      header: t('catalog.tareTypes.col.deposit'),
      align: 'right',
      className: 'font-mono tabular-nums',
      cell: (x) => x.deposit_price || '—',
    },
    {
      id: 'is_crate',
      header: t('catalog.tareTypes.col.isCrate'),
      align: 'right',
      hideBelow: 'sm',
      cell: (x) => (
        <Badge variant={x.is_crate ? 'default' : 'outline'}>
          {x.is_crate ? t('catalog.tareTypes.crate') : t('catalog.tareTypes.notCrate')}
        </Badge>
      ),
    },
    {
      id: 'is_active',
      header: t('catalog.tareTypes.col.status'),
      align: 'right',
      cell: (x) => (
        <Badge variant={x.is_active ? 'default' : 'secondary'}>
          {x.is_active ? t('catalog.tareTypes.active') : t('catalog.tareTypes.inactive')}
        </Badge>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button onClick={openCreate}>{t('catalog.tareTypes.new')}</Button>
      </div>

      <AsyncBody
        isPending={isPending}
        isError={isError}
        isEmpty={rows.length === 0}
        empty={
          <EmptyState
            title={t('catalog.tareTypes.empty.title')}
            hint={t('catalog.tareTypes.empty.hint')}
          />
        }
      >
        <DataTable<TareType>
          columns={columns}
          rows={rows}
          rowKey={(x) => x.id}
          onRowClick={openEdit}
        />
      </AsyncBody>

      <TareTypeDialog
        key={dialogInstance}
        tareType={editing}
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
      />
    </div>
  );
}
