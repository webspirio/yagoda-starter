import { useState, type ReactNode } from 'react';
import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/cn';
import { useUrlParam } from '@/shared/lib/url-state';
import { PageHeader } from '@/shared/ui/page-header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/tabs';
import { DataTable, type Column } from '@/shared/ui/data-table';
import { Button } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { Badge } from '@/shared/ui/badge';
import { TextInput } from '@/shared/ui/text-input';
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

const TABS = ['products', 'tareTypes'] as const;
type TabId = (typeof TABS)[number];

const isTabId = (value: string | null): value is TabId =>
  value !== null && (TABS as readonly string[]).includes(value);

/**
 * One owner-only screen for all three catalogs, as TWO tabs: «Товари і сорти»
 * — a master–detail pair, the product list on the left and the chosen
 * product's grades on the right, because a berry and its grades are set up
 * and edited together — and «Тара», a plain table. The active tab and the
 * chosen product both live in the query string so they survive a reload and
 * can be linked; `useUrlParam` REPLACES rather than pushes, so neither fills
 * the back stack. A stale `?tab=grades` link falls back to the first tab.
 */
export function CatalogPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useUrlParam('tab');
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
          <TabsTrigger value="tareTypes">{t('catalog.tabs.tareTypes')}</TabsTrigger>
        </TabsList>

        <TabsContent value="products" className="mt-5">
          <ProductsPanel />
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

const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name);

function ProductsPanel() {
  const { t } = useTranslation();
  const products = useProductsQuery();
  // Unfiltered and including inactive grades: the owner reactivates retired
  // grades from here, and grouping by product happens client-side.
  const grades = useProductGradesQuery();

  // The chosen product rides in the URL; an unknown or missing id falls back
  // to the first product, so the detail pane is never empty while data exists.
  const [productParam, setProductParam] = useUrlParam('product');
  const [search, setSearch] = useState('');

  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [productOpen, setProductOpen] = useState(false);
  const [productInstance, setProductInstance] = useState(0);

  const [editingGrade, setEditingGrade] = useState<ProductGrade | null>(null);
  const [gradeOpen, setGradeOpen] = useState(false);
  const [gradeInstance, setGradeInstance] = useState(0);

  const openProduct = (product: Product | null) => {
    setEditingProduct(product);
    setProductInstance((n) => n + 1);
    setProductOpen(true);
  };
  const openGrade = (grade: ProductGrade | null) => {
    setEditingGrade(grade);
    setGradeInstance((n) => n + 1);
    setGradeOpen(true);
  };

  const productRows = [...(products.data?.data ?? [])].sort(byName);
  const gradesByProduct = new Map<string, ProductGrade[]>();
  for (const g of grades.data?.data ?? [])
    gradesByProduct.set(g.product_id, [...(gradesByProduct.get(g.product_id) ?? []), g]);

  const selected = productRows.find((p) => p.id === productParam) ?? productRows[0] ?? null;
  const needle = search.trim().toLocaleLowerCase();
  const visible = needle
    ? productRows.filter((p) => p.name.toLocaleLowerCase().includes(needle))
    : productRows;

  const selectedGrades = selected ? [...(gradesByProduct.get(selected.id) ?? [])].sort(byName) : [];
  const activeCount = selectedGrades.filter((g) => g.is_active).length;

  const columns: Column<ProductGrade>[] = [
    {
      id: 'name',
      header: t('catalog.grades.col.name'),
      cell: (g) => (
        <span className={cn('font-medium', !g.is_active && 'text-muted-foreground')}>{g.name}</span>
      ),
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
    <>
      <AsyncBody
        isPending={products.isPending || grades.isPending}
        isError={products.isError || grades.isError}
        isEmpty={productRows.length === 0}
        empty={
          <EmptyState
            title={t('catalog.products.empty.title')}
            hint={t('catalog.products.empty.hint')}
            action={
              <Button onClick={() => openProduct(null)}>
                <Plus className="size-4" />
                {t('catalog.products.new')}
              </Button>
            }
          />
        }
      >
        <div className="grid items-start gap-5 md:grid-cols-[minmax(240px,300px)_1fr]">
          {/* Master: the product list — one flat, scannable column with a grade count. */}
          <div className="flex flex-col gap-3">
            <div className="flex gap-2">
              <TextInput
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('catalog.products.search')}
                aria-label={t('catalog.products.search')}
                className="min-w-0"
              />
              <Button className="h-[46px] shrink-0" onClick={() => openProduct(null)}>
                <Plus className="size-4" />
                {t('catalog.products.new')}
              </Button>
            </div>
            <Card>
              <ul aria-label={t('catalog.products.list')} className="divide-y divide-border">
                {visible.map((p) => {
                  const count = gradesByProduct.get(p.id)?.length ?? 0;
                  const isSelected = selected?.id === p.id;
                  return (
                    <li key={p.id}>
                      <button
                        type="button"
                        aria-current={isSelected ? 'true' : undefined}
                        className={cn(
                          'flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm transition-colors',
                          'hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset',
                          isSelected &&
                            'bg-primary/8 font-medium shadow-[inset_3px_0_0_var(--primary)]',
                          count === 0 && !isSelected && 'text-muted-foreground',
                        )}
                        onClick={() => setProductParam(p.id)}
                      >
                        <span className="min-w-0 flex-1 truncate">{p.name}</span>
                        <span className="font-mono text-xs tabular-nums text-muted-foreground">
                          {count}
                        </span>
                      </button>
                    </li>
                  );
                })}
                {visible.length === 0 ? (
                  <li className="px-4 py-6 text-center text-sm text-muted-foreground">
                    {t('catalog.products.noMatch')}
                  </li>
                ) : null}
              </ul>
            </Card>
          </div>

          {/* Detail: the chosen product's grades, with the ONE pair of actions in its header. */}
          {selected ? (
            <Card aria-labelledby="catalog-product-title" role="region">
              <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-4">
                <div className="min-w-0">
                  <h2 id="catalog-product-title" className="font-display text-lg font-medium">
                    {selected.name}
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    {t('catalog.grades.count', { count: selectedGrades.length })} ·{' '}
                    {t('catalog.grades.activeCount', { count: activeCount })}
                  </p>
                </div>
                <div className="ml-auto flex shrink-0 gap-2">
                  <Button variant="outline" size="sm" onClick={() => openProduct(selected)}>
                    {t('catalog.products.rename')}
                  </Button>
                  <Button size="sm" onClick={() => openGrade(null)}>
                    <Plus />
                    {t('catalog.grades.new')}
                  </Button>
                </div>
              </div>
              {selectedGrades.length === 0 ? (
                <div className="p-5">
                  <EmptyState
                    title={t('catalog.grades.empty.title')}
                    hint={t('catalog.grades.empty.hint')}
                  />
                </div>
              ) : (
                <DataTable<ProductGrade>
                  frame={false}
                  columns={columns}
                  rows={selectedGrades}
                  rowKey={(g) => g.id}
                  onRowClick={(g) => openGrade(g)}
                />
              )}
            </Card>
          ) : null}
        </div>
      </AsyncBody>

      {/* Outside AsyncBody on purpose: it renders `empty` INSTEAD of its
          children, so a dialog nested inside could never open from the empty
          state's own «New product» button. */}
      <ProductDialog
        key={productInstance}
        product={editingProduct}
        open={productOpen}
        onClose={() => setProductOpen(false)}
      />
      <GradeDialog
        key={gradeInstance}
        grade={editingGrade}
        products={productRows}
        defaultProductId={selected?.id ?? null}
        open={gradeOpen}
        onClose={() => setGradeOpen(false)}
      />
    </>
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
        <Badge variant={x.is_crate ? 'secondary' : 'outline'}>
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
        <Button onClick={openCreate}>
          <Plus className="size-4" />
          {t('catalog.tareTypes.new')}
        </Button>
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
