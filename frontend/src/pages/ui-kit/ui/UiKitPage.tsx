import { useState } from 'react';
import { Printer } from 'lucide-react';
import { PageHeader } from '@/shared/ui/page-header';
import { Eyebrow } from '@/shared/ui/eyebrow';
import { StatTile } from '@/shared/ui/stat-tile';
import { StatGrid } from '@/shared/ui/stat-grid';
import { ShareBar } from '@/shared/ui/share-bar';
import { Dot } from '@/shared/ui/dot';
import { Sparkline } from '@/shared/ui/sparkline';
import { EmptyState } from '@/shared/ui/empty-state';
import { LedgerRow } from '@/shared/ui/ledger-row';
import { SectionCard } from '@/shared/ui/section-card';
import { DataTable, type Column } from '@/shared/ui/data-table';
import { DateStepper } from '@/shared/ui/date-stepper';
import { Button } from '@/shared/ui/button';
import { Badge } from '@/shared/ui/badge';
import { CHART_COLORS } from '@/shared/ui/chart-colors';
import { ListPage } from '@/shared/ui/templates/list-page';
import { DashboardPage } from '@/shared/ui/templates/dashboard-page';
import { DocumentPage } from '@/shared/ui/templates/document-page';

/**
 * Living gallery of the shared/ui kit — the real React components under the
 * mock's tokens. Standalone dev route at `/ui-kit` (no shell, no auth).
 */

const SWATCHES: { name: string; token: string }[] = [
  { name: 'Папір', token: '--background' },
  { name: 'Картка', token: '--card' },
  { name: 'Чорнило', token: '--foreground' },
  { name: 'Беррі', token: '--primary' },
  { name: 'Лист', token: '--leaf' },
  { name: 'Бурштин', token: '--amber' },
  { name: 'Небо', token: '--sky' },
  { name: 'Табло', token: '--readout' },
];

function Band({ title, note }: { title: string; note?: string }) {
  return (
    <div className="mb-4 mt-11 flex items-baseline gap-3">
      <h2 className="font-display text-[15px] font-semibold">{title}</h2>
      <span className="h-px flex-1 bg-border" />
      {note ? <span className="font-mono text-xs text-muted-foreground">{note}</span> : null}
    </div>
  );
}

function Cell({ name, tag, children }: { name: string; tag: string; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3.5 py-2.5">
        <span className="font-mono text-[12.5px] font-semibold">{name}</span>
        <span className="rounded-full border border-border px-1.5 py-0.5 text-[10.5px] uppercase tracking-wider text-muted-foreground">
          {tag}
        </span>
      </div>
      <div className="bg-background p-4">{children}</div>
    </div>
  );
}

interface SupplierRow {
  id: string;
  name: string;
  village: string;
  crates: number;
  debt: string;
}
const supplierColumns: Column<SupplierRow>[] = [
  { id: 'name', header: 'Постачальник', cell: (r) => r.name },
  { id: 'village', header: 'Село', cell: (r) => r.village, hideBelow: 'sm' },
  { id: 'crates', header: 'Ящиків', align: 'right', className: 'tabular-nums', cell: (r) => r.crates },
  { id: 'debt', header: 'Борг, ₴', align: 'right', className: 'tabular-nums', cell: (r) => r.debt },
];
const supplierRows: SupplierRow[] = [
  { id: 'a', name: 'Оксана Г.', village: 'Шипинки', crates: 120, debt: '0,00' },
  { id: 'b', name: 'Марія С.', village: 'Гаї', crates: 64, debt: '1 240,00' },
  { id: 'c', name: 'Петро В.', village: 'Шипинки', crates: 341, debt: '0,00' },
];

const DAY = 86_400_000;
function fmt(d: Date) {
  return d.toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function UiKitPage() {
  const [day, setDay] = useState(() => new Date('2026-08-04T00:00:00'));

  return (
    <div className="mx-auto max-w-[1120px] px-6 pb-24">
      <header className="sticky top-0 z-10 -mx-6 mb-2 flex items-center gap-3 border-b border-border bg-background/85 px-6 py-3.5 backdrop-blur">
        <span className="size-3 rounded bg-primary" />
        <h1 className="font-display text-lg font-semibold tracking-tight">Ягода UI Kit</h1>
        <span className="text-xs text-muted-foreground">shared/ui — живі компоненти</span>
      </header>

      <Band title="Палітра" note="токени index.css" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {SWATCHES.map((s) => (
          <div key={s.token} className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="h-16" style={{ background: `var(${s.token})` }} />
            <div className="px-3 py-2">
              <div className="text-[13px] font-semibold">{s.name}</div>
              <code className="font-mono text-[11px] text-muted-foreground">{s.token}</code>
            </div>
          </div>
        ))}
      </div>

      <Band title="Типографіка" note="Unbounded · Onest · JetBrains Mono" />
      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-baseline gap-4 border-b border-border py-3">
          <span className="w-36 font-mono text-[11px] text-muted-foreground">display / Unbounded</span>
          <span className="font-display text-3xl font-semibold">Каса за день</span>
        </div>
        <div className="flex flex-wrap items-baseline gap-4 border-b border-border py-3">
          <span className="w-36 font-mono text-[11px] text-muted-foreground">eyebrow</span>
          <Eyebrow>Стан точки · Шипинки</Eyebrow>
        </div>
        <div className="flex flex-wrap items-baseline gap-4 border-b border-border py-3">
          <span className="w-36 font-mono text-[11px] text-muted-foreground">body / Onest</span>
          <span className="max-w-[60ch] text-[15px]">
            Кожна точка веде свій день окремо, а зведена каса складається сама.
          </span>
        </div>
        <div className="flex flex-wrap items-baseline gap-4 py-3">
          <span className="w-36 font-mono text-[11px] text-muted-foreground">mono / числа</span>
          <span className="font-mono text-lg tabular-nums">15 416,10 ₴ · 800 ящ · 341,5 кг</span>
        </div>
      </div>

      <Band title="Компоненти · патерни" note="shared/ui" />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Cell name="PageHeader" tag="патерн">
          <PageHeader eyebrow="Довідник" title="Тара і сорти" description="Товари, їхні сорти й типи тари." />
        </Cell>
        <Cell name="StatTile · StatGrid" tag="патерн">
          <StatGrid columns={2}>
            <StatTile label="У шухляді" value="15 416,10 ₴" hint="на ранок" />
            <StatTile label="За ягоду" value="1 616,10 ₴" tone="berry" hint="видано" />
            <StatTile label="Наділ" value="800" tone="leaf" hint="ящиків" />
            <StatTile label="Недостача" value="−120,00 ₴" tone="amber" hint="за зміну" />
          </StatGrid>
        </Cell>
        <Cell name="ShareBar · Dot" tag="патерн">
          <ShareBar
            className="mb-3.5"
            parts={[
              { value: 62, color: CHART_COLORS[0], label: 'Ягода' },
              { value: 26, color: CHART_COLORS[1], label: 'Завдаток' },
              { value: 12, color: CHART_COLORS[2], label: 'Тара' },
            ]}
          />
          <div className="flex flex-wrap gap-4 text-[13px]">
            <span className="inline-flex items-center gap-2">
              <Dot color={CHART_COLORS[0]} /> Ягода
            </span>
            <span className="inline-flex items-center gap-2">
              <Dot color={CHART_COLORS[1]} /> Завдаток
            </span>
            <span className="inline-flex items-center gap-2">
              <Dot color={CHART_COLORS[2]} /> Тара
            </span>
          </div>
        </Cell>
        <Cell name="Sparkline" tag="патерн">
          <Sparkline values={[12, 14, 13, 16, 15, 18, 17, 21]} />
          <div className="mt-2 font-mono text-xs text-muted-foreground">ціна сорту, 8 днів</div>
        </Cell>
        <Cell name="EmptyState" tag="патерн">
          <EmptyState
            title="Ще нічого не додано"
            hint="Постачальники цієї точки зʼявляться тут після першої прийомки."
            action={
              <Button variant="outline" className="mt-1">
                Додати постачальника
              </Button>
            }
          />
        </Cell>
        <Cell name="Button · Badge" tag="примітив">
          <div className="flex flex-wrap items-center gap-2">
            <Button>Прийняти</Button>
            <Button variant="outline">Друк</Button>
            <Button variant="ghost">Скасувати</Button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Badge>зійшлося</Badge>
            <Badge variant="secondary">чернетка</Badge>
            <Badge variant="destructive">не сходиться</Badge>
            <Badge variant="outline">архів</Badge>
          </div>
        </Cell>
      </div>

      <Band title="Компоненти · layout" note="shared/ui" />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Cell name="DataTable<Row>" tag="layout">
          <DataTable columns={supplierColumns} rows={supplierRows} rowKey={(r) => r.id} frame={false} />
        </Cell>
        <Cell name="SectionCard · LedgerRow" tag="layout">
          <SectionCard eyebrow="Розрахунок візиту" aside={<Badge>зійшлося</Badge>}>
            <LedgerRow label="За ягоду" value="1 616,10" />
            <LedgerRow label="Завдаток" value="200,00" />
            <LedgerRow label="Недостача тари" value="−120,00" tone="bad" />
            <LedgerRow label="Разом" value="1 696,10 ₴" strong />
          </SectionCard>
        </Cell>
        <Cell name="DateStepper" tag="layout">
          <DateStepper
            label={fmt(day)}
            onPrev={() => setDay((d) => new Date(d.getTime() - DAY))}
            onNext={() => setDay((d) => new Date(d.getTime() + DAY))}
            onToday={() => setDay(new Date('2026-08-04T00:00:00'))}
          />
        </Cell>
      </div>

      <Band title="Шаблони сторінок" note="shared/ui/templates" />
      <div className="grid grid-cols-1 gap-4">
        <Cell name="ListPage" tag="шаблон">
          <ListPage
            eyebrow="Довідник"
            title="Постачальники"
            actions={<Button>Новий</Button>}
            stats={
              <StatGrid columns={3}>
                <StatTile label="Усього" value="12" />
                <StatTile label="З боргом" value="1" tone="amber" />
                <StatTile label="Ящиків у полі" value="525" tone="leaf" />
              </StatGrid>
            }
            columns={supplierColumns}
            rows={supplierRows}
            rowKey={(r) => r.id}
          />
        </Cell>
        <Cell name="DashboardPage" tag="шаблон">
          <DashboardPage
            eyebrow="Сезон"
            title="Зведення"
            stats={[
              { label: 'Виторг', value: '128 400 ₴', tone: 'berry' },
              { label: 'Прийнято', value: '4 120 кг', tone: 'leaf' },
              { label: 'Середня ціна', value: '31,20 ₴/кг' },
            ]}
            statColumns={3}
            sections={[
              {
                id: 'trend',
                eyebrow: 'Динаміка ціни',
                content: <Sparkline values={[28, 29, 30, 31, 30, 32, 31, 33]} height={56} />,
              },
              {
                id: 'mix',
                eyebrow: 'Структура виплат',
                content: (
                  <ShareBar
                    parts={[
                      { value: 62, color: CHART_COLORS[0], label: 'Ягода' },
                      { value: 26, color: CHART_COLORS[1], label: 'Завдаток' },
                      { value: 12, color: CHART_COLORS[2], label: 'Тара' },
                    ]}
                  />
                ),
              },
            ]}
            layout="two-column"
          />
        </Cell>
        <Cell name="DocumentPage" tag="шаблон">
          <DocumentPage
            eyebrow="Аркуш"
            title="Аркуш керівника"
            meta={<span className="text-sm text-muted-foreground">04.08.2026 · Шипинки</span>}
            onPrint={() => {}}
            actions={
              <Button variant="ghost" size="icon" aria-label="Друк">
                <Printer />
              </Button>
            }
          >
            <LedgerRow label="Прийнято ягоди" value="341,50 кг" />
            <LedgerRow label="Виплачено" value="10 645,80 ₴" />
            <LedgerRow label="У шухляді на кінець" value="15 416,10 ₴" strong />
          </DocumentPage>
        </Cell>
      </div>
    </div>
  );
}
