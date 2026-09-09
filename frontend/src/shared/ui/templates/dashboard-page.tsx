import type * as React from 'react';
import { cn } from '@/shared/lib/cn';
import { PageHeader } from '@/shared/ui/page-header';
import { StatGrid } from '@/shared/ui/stat-grid';
import { StatTile } from '@/shared/ui/stat-tile';
import { SectionCard } from '@/shared/ui/section-card';

/**
 * Домен-незалежний шаблон панелі метрик. Володіє лише розкладкою: шапкою,
 * смугою показників (StatGrid + StatTile) і сіткою секцій. Графіки СВІДОМО
 * не імпортуються — вузол діаграми приходить ззовні через `section.content`,
 * тому цей шаблон нічого не знає ні про recharts, ні про предметну область.
 */
export interface StatItem {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: 'default' | 'berry' | 'amber' | 'leaf';
  icon?: React.ReactNode;
  onClick?: () => void;
}

export interface DashboardSection {
  id: string;
  eyebrow?: string;
  title?: React.ReactNode;
  aside?: React.ReactNode;
  content: React.ReactNode;
  span?: 1 | 2 | 'full';
  card?: boolean;
}

export interface DashboardPageProps {
  eyebrow?: string;
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  stats?: StatItem[];
  statsSlot?: React.ReactNode;
  statColumns?: 2 | 3 | 4 | 5;
  sections?: DashboardSection[];
  children?: React.ReactNode;
  layout?: 'stack' | 'two-column' | 'sidebar';
  maxWidth?: number | string;
  className?: string;
}

// Static class maps — never interpolate `col-span-${n}` or a layout string:
// Tailwind's scanner only sees literal class names, so a computed one would be
// missing from the built CSS.
const LAYOUTS = {
  stack: 'grid grid-cols-1 gap-4',
  'two-column': 'grid grid-cols-1 gap-4 lg:grid-cols-2',
  sidebar: 'grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(300px,1fr)]',
} as const;

const SPAN = {
  1: '',
  2: 'lg:col-span-2',
  full: 'col-span-full',
} as const;

export function DashboardPage({
  eyebrow,
  title,
  description,
  actions,
  stats,
  statsSlot,
  statColumns,
  sections,
  children,
  layout = 'stack',
  maxWidth,
  className,
}: DashboardPageProps): React.JSX.Element {
  let statBand: React.ReactNode = null;
  if (statsSlot != null) {
    statBand = <div className="mb-5">{statsSlot}</div>;
  } else if (stats && stats.length > 0) {
    statBand = (
      <div className="mb-5">
        <StatGrid columns={statColumns}>
          {stats.map((stat) =>
            // StatTile has no `onClick`; wrap it in a button only when interactive,
            // otherwise render the tile bare.
            stat.onClick ? (
              <button key={stat.label} type="button" onClick={stat.onClick} className="text-left">
                <StatTile
                  label={stat.label}
                  value={stat.value}
                  hint={stat.hint}
                  tone={stat.tone}
                  icon={stat.icon}
                />
              </button>
            ) : (
              <StatTile
                key={stat.label}
                label={stat.label}
                value={stat.value}
                hint={stat.hint}
                tone={stat.tone}
                icon={stat.icon}
              />
            ),
          )}
        </StatGrid>
      </div>
    );
  }

  let body: React.ReactNode = null;
  if (children != null) {
    body = children;
  } else if (sections && sections.length > 0) {
    body = (
      <div className={LAYOUTS[layout]}>
        {sections.map((section) => (
          <SectionCard
            key={section.id}
            eyebrow={section.eyebrow}
            title={section.title}
            aside={section.aside}
            card={section.card}
            className={section.span != null ? SPAN[section.span] : undefined}
          >
            {section.content}
          </SectionCard>
        ))}
      </div>
    );
  }

  return (
    <div className={cn('mx-auto w-full', className)} style={{ maxWidth: maxWidth ?? 1400 }}>
      <PageHeader eyebrow={eyebrow} title={title} description={description} actions={actions} />
      {statBand}
      {body}
    </div>
  );
}
