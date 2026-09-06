import { useTranslation } from 'react-i18next';
import { useUrlParam } from '@/shared/lib/url-state';
import { Screen } from '@/shared/ui/screen';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/tabs';
import { ProductsTab } from './ProductsTab';
import { GradesTab } from './GradesTab';
import { TareTypesTab } from './TareTypesTab';

/**
 * One screen for all three catalogs, because they are one job: an owner
 * setting up a season adds a berry, adds its grades, then adds the crate types
 * it arrives in. Three nav destinations would split one task into three.
 *
 * The active tab lives in the query string so it survives a reload and can be
 * linked. `useUrlParam` REPLACES rather than pushes, so switching tabs does not
 * fill the back stack with dead entries.
 */
const TABS = ['products', 'grades', 'tareTypes'] as const;
type TabId = (typeof TABS)[number];

const isTabId = (value: string | null): value is TabId =>
  value !== null && (TABS as readonly string[]).includes(value);

export function CatalogPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useUrlParam('tab');

  // A hand-edited or stale URL falls back rather than rendering an empty
  // shell with no tab selected.
  const active: TabId = isTabId(tab) ? tab : 'products';

  return (
    <Screen>
      <h1 className="mb-6 text-2xl font-semibold">{t('catalog.title')}</h1>
      <Tabs value={active} onValueChange={(next) => setTab(next)}>
        <TabsList>
          <TabsTrigger value="products">{t('catalog.tabs.products')}</TabsTrigger>
          <TabsTrigger value="grades">{t('catalog.tabs.grades')}</TabsTrigger>
          <TabsTrigger value="tareTypes">{t('catalog.tabs.tareTypes')}</TabsTrigger>
        </TabsList>

        <TabsContent value="products">
          <ProductsTab />
        </TabsContent>
        <TabsContent value="grades">
          <GradesTab />
        </TabsContent>
        <TabsContent value="tareTypes">
          <TareTypesTab />
        </TabsContent>
      </Tabs>
    </Screen>
  );
}
