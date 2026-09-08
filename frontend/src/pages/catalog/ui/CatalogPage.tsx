import { useState, type ReactNode } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/cn';
import { useUrlParam } from '@/shared/lib/url-state';
import { PageHeader } from '@/shared/ui/page-header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/tabs';
import { DataTable, type Column } from '@/shared/ui/data-table';
import { Button } from '@/shared/ui/button';
import { Badge } from '@/shared/ui/badge';
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
 * — every grade listed UNDER its product, the mock's `RefsPage` grouping,
 * because a season is set up by adding a berry and then its grades and the
 * two are edited together — and «Тара», a plain table. The active tab lives
 * in the query string so it survives a reload and can be linked;
 * `useUrlParam` REPLACES rather than pushes, so switching tabs does not fill
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

/** The mock's list row: a hairline-bordered pill that IS the edit affordance. */
const GRADE_ROW_CLASS = cn(
  'flex w-full items-center gap-2.5 rounded-lg border border-border/70 px-3 py-1.5 text-left transition-colors',
  'hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
);

function ProductsPanel() {
  const { t } = useTranslation();
  const products = useProductsQuery();
  // Unfiltered and including inactive grades: the owner reactivates retired
  // grades from here, and grouping by product happens client-side.
  const grades = useProductGradesQuery();

  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [productOpen, setProductOpen] = useState(false);
  const [productInstance, setProductInstance] = useState(0);

  const [editingGrade, setEditingGrade] = useState<ProductGrade | null>(null);
  const [gradeProductId, setGradeProductId] = useState<string | null>(null);
  const [gradeOpen, setGradeOpen] = useState(false);
  const [gradeInstance, setGradeInstance] = useState(0);

  const openProduct = (product: Product | null) => {
    setEditingProduct(product);
    setProductInstance((n) => n + 1);
    setProductOpen(true);
  };
  const openGrade = (grade: ProductGrade | null, productId: string | null) => {
    setEditingGrade(grade);
    setGradeProductId(productId);
    setGradeInstance((n) => n + 1);
    setGradeOpen(true);
  };

  const productRows = products.data?.data ?? [];
  const gradeRows = grades.data?.data ?? [];
  const byProduct = new Map<string, ProductGrade[]>();
  for (const g of gradeRows)
    byProduct.set(g.product_id, [...(byProduct.get(g.product_id) ?? []), g]);
  const groups = [...productRows]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((product) => ({
      product,
      grades: (byProduct.get(product.id) ?? []).sort((a, b) => a.name.localeCompare(b.name)),
    }));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button onClick={() => openProduct(null)}>
          <Plus className="size-4" />
          {t('catalog.products.new')}
        </Button>
      </div>

      <AsyncBody
        isPending={products.isPending || grades.isPending}
        isError={products.isError || grades.isError}
        isEmpty={productRows.length === 0}
        empty={
          <EmptyState
            title={t('catalog.products.empty.title')}
            hint={t('catalog.products.empty.hint')}
          />
        }
      >
        {/* One card per product, its grades beneath — two columns on wide screens. */}
        <ul className="grid items-start gap-4 md:grid-cols-2">
          {groups.map(({ product, grades: list }) => (
            <li key={product.id} className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
              <div className="mb-2 flex items-center gap-2">
                <span className="font-display text-base font-medium">{product.name}</span>
                <span className="text-[11px] text-muted-foreground">
                  {t('catalog.grades.count', { count: list.length })}
                </span>
                <span className="ml-auto flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('catalog.products.edit', { name: product.name })}
                    onClick={() => openProduct(product)}
                  >
                    <Pencil />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label={t('catalog.grades.addAria', { name: product.name })}
                    onClick={() => openGrade(null, product.id)}
                  >
                    <Plus />
                    {t('catalog.grades.add')}
                  </Button>
                </span>
              </div>
              {list.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
                  {t('catalog.products.noGrades')}
                </p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {list.map((grade) => (
                    <li key={grade.id}>
                      <button
                        type="button"
                        className={cn(GRADE_ROW_CLASS, !grade.is_active && 'text-muted-foreground')}
                        onClick={() => openGrade(grade, grade.product_id)}
                      >
                        <span className="min-w-0 flex-1 truncate text-sm">{grade.name}</span>
                        {grade.is_active ? null : (
                          <Badge variant="outline">{t('catalog.grades.inactive')}</Badge>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </AsyncBody>

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
        defaultProductId={gradeProductId}
        open={gradeOpen}
        onClose={() => setGradeOpen(false)}
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
