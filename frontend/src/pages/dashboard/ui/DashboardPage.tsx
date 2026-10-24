import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { AlertTriangle } from 'lucide-react';
import { DashboardPage as DashboardTemplate } from '@/shared/ui/templates/dashboard-page';
import { StatGrid } from '@/shared/ui/stat-grid';
import { StatTile } from '@/shared/ui/stat-tile';
import { SectionCard } from '@/shared/ui/section-card';
import { Card } from '@/shared/ui/card';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { EmptyState } from '@/shared/ui/empty-state';
import { Spinner } from '@/shared/ui/spinner';
import { isTruncated } from '@/shared/api';
import { sum, formatUah } from '@/shared/lib/money';
import { todayIso, formatWeekday, formatLongDate } from '@/shared/lib/date';
import { useMeQuery } from '@/entities/user';
import { usePointOptionsQuery } from '@/entities/collection-point';
import { useSupplierBalancesQuery, supplierName } from '@/entities/supplier';
import { useStaleOpenShiftsQuery, type Shift } from '@/entities/shift';
import { useNetworkToday, type PointToday } from '../api/useNetworkToday';

/** Shift `Badge` look for a point's row. Berry is the brand and the one CTA,
 *  never a state (audit 2026-10-24 rule 1): an open shift is a `leaf`
 *  outline, «needs an explanation» reads `destructive`, closed is quiet
 *  (`secondary`), «no shift today» the emptiest `outline`. */
function shiftBadge(status: Shift['status'] | 'none'): {
  variant: 'secondary' | 'destructive' | 'outline';
  className?: string;
} {
  if (status === 'open') return { variant: 'outline', className: 'border-[var(--leaf)] text-[var(--leaf)]' };
  if (status === 'awaiting_explanation') return { variant: 'destructive' };
  if (status === 'closed') return { variant: 'secondary' };
  return { variant: 'outline' };
}

/** A money figure never breaks across lines (audit E10). */
const money = (value: string, locale: string) => (
  <span className="whitespace-nowrap">{formatUah(value, locale)}</span>
);

/**
 * «Зведення» — today across the network for the owner (shifts, receipts,
 * cash and the biggest balances, by point) and just the point's own row plus
 * three shortcuts for the operator. Both roles land on `/`; the content —
 * not the route — is what changes with role (§ overview-screens task 3).
 */
export function DashboardPage() {
  const { t, i18n } = useTranslation();
  const { data: me, isPending: meIsPending } = useMeQuery();
  const {
    data: points,
    isPending: pointsIsPending,
    isError: pointsIsError,
  } = usePointOptionsQuery();

  const isOwner = me?.role === 'network_owner';
  const activePoints = points ?? [];
  const today = todayIso();

  const pointIds = isOwner
    ? activePoints.map((p) => p.id)
    : me?.collection_point_id
      ? [me.collection_point_id]
      : [];

  const network = useNetworkToday(pointIds);
  // The balances read is network-wide and owner-only — an operator never
  // fires it at all (`enabled: false`), not merely discards its result.
  const balances = useSupplierBalancesQuery({ includeZero: false, enabled: isOwner });
  // Зміни, що лишились відкритими з ПОПЕРЕДНІХ днів (#114). Оператор його не
  // питає взагалі — і не тому, що йому не можна, а тому, що його власну
  // незакриту зміну йому й так показує `OpenShiftAlert` просто там, де він
  // працює, разом із кнопкою «Закрити». Керівникові ж точка, що забула
  // закритись, не видна НІДЕ: `useNetworkToday` читає лише сьогодні, і така
  // точка виглядає в ньому як «Зміну ще не відкрито».
  const staleShifts = useStaleOpenShiftsQuery({ enabled: isOwner });

  // `staleShifts` серед цих термів НЕМАЄ свідомо: секція «Незакриті зміни» —
  // це додаткове попередження, воно має право приїхати пізніше, а не тримати
  // весь екран за спінером щоранку. Відсутність терма ще й закриває пастку
  // `enabled: false` структурно, а не пам'яттю про обхід: вимкнений запит
  // лишається `pending` НАЗАВЖДИ, тож кожен такий терм мусить нести поруч
  // `isOwner &&` — а терм, якого немає, забути цього не може.
  const isPending =
    meIsPending ||
    (isOwner && pointsIsPending) ||
    network.isPending ||
    (isOwner && balances.isPending);
  const isError = network.isError || (isOwner && (pointsIsError || balances.isError));

  const pointName = (id: string) => activePoints.find((p) => p.id === id)?.name ?? '';

  const openCount = network.rows.filter((r) => r.shift?.status === 'open').length;
  const totalReceipts = network.rows.reduce((n, r) => n + r.receipts, 0);
  const totalAccrued = sum(network.rows.map((r) => r.accrued));
  const totalPaid = sum(network.rows.map((r) => r.paid));

  // НЕ входить в `isError`: сьогоднішні цифри від падіння цього читання не
  // стали неправдою, і міняти весь екран на «Щось пішло не так» через
  // додаткове попередження — гірше, ніж сказати про невдачу одним рядком у
  // самій секції (див. `staleShiftsSection` нижче).
  //
  // Сортування тут — рішення ПОКАЗУ, а не недовіра до сервера: `ShiftsService.list`
  // віддає `business_date DESC` (свіже першим), а в цьому списку читають не
  // «що сталось останнім», а «що застрягло найдовше», тож першою має стояти
  // найстаріша. Сорт стабільний, тому серверний `id ASC` у межах однієї дати
  // лишається як був.
  const staleRows = [...(staleShifts.data?.data ?? [])].sort((a, b) =>
    a.business_date < b.business_date ? -1 : a.business_date > b.business_date ? 1 : 0,
  );

  const balanceRows = balances.data?.data ?? [];
  const topBalances = balanceRows.slice(0, 5);
  const truncatedHint = network.anyTruncated ? t('dashboard.tiles.truncatedHint') : undefined;

  // ONE COLUMN BELOW 400 px (audit E10): two 26-px money figures side by side
  // do not fit a phone. «Сума квитанцій», not «Нараховано» (E2): these are the
  // receipts alone, while cost of day's «нараховано» adds the доплати. «Всього
  // винні» is the SERVER's Σ over every row (#229, E7) — summing the first 100
  // here read low on a long list. Plain money is neutral ink (rule 1).
  const statsBand = (
    <StatGrid columns={5} className="max-[399px]:grid-cols-1">
      <StatTile
        label={t('dashboard.tiles.pointsOpen')}
        value={`${openCount} / ${activePoints.length}`}
      />
      <StatTile label={t('dashboard.tiles.receipts')} value={String(totalReceipts)} hint={truncatedHint} />
      <StatTile
        label={t('dashboard.tiles.accrued')}
        value={money(totalAccrued, i18n.language)}
        hint={truncatedHint}
      />
      <StatTile
        label={t('dashboard.tiles.paid')}
        value={money(totalPaid, i18n.language)}
        hint={truncatedHint}
      />
      <StatTile
        label={t('dashboard.tiles.balances')}
        value={balances.data ? money(balances.data.total_owed, i18n.language) : '—'}
        tone="amber"
      />
    </StatGrid>
  );

  // A point with no shift today has nothing to show but that fact — one line
  // for all of them instead of a card each (audit E11).
  const workingRows = network.rows.filter((r) => r.shift !== null);
  const idleNames = network.rows
    .filter((r) => r.shift === null)
    .map((r) => pointName(r.pointId))
    .filter(Boolean);

  const pointRow = (row: PointToday, withLinks: boolean) => {
    const status: Shift['status'] | 'none' = row.shift?.status ?? 'none';
    return (
      <Card key={row.pointId} className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="font-medium">{pointName(row.pointId)}</div>
            <Badge
              variant={shiftBadge(status).variant}
              className={`mt-1 ${shiftBadge(status).className ?? ''}`}
            >
              {t(`dashboard.points.status.${status}`)}
            </Badge>
            {row.truncated ? (
              <div className="mt-1 text-xs text-muted-foreground">
                {t('dashboard.tiles.truncatedHint')}
              </div>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
            <span>
              {t('dashboard.tiles.receipts')}: <span className="font-mono text-foreground">{row.receipts}</span>
            </span>
            <span>
              {t('dashboard.tiles.accrued')}:{' '}
              <span className="font-mono text-foreground">{money(row.accrued, i18n.language)}</span>
            </span>
            <span>
              {t('dashboard.tiles.paid')}:{' '}
              <span className="font-mono text-foreground">{money(row.paid, i18n.language)}</span>
            </span>
          </div>
          {withLinks ? (
            <div className="flex items-center gap-2">
              <Button asChild variant="outline" size="sm">
                <Link to={`/point-cash?point=${row.pointId}`}>{t('dashboard.points.pointCash')}</Link>
              </Button>
              {/* A row-level repeated action: outline, never a column of
                  berry buttons (rule 1). */}
              <Button asChild variant="outline" size="sm">
                <Link to={`/reception?point=${row.pointId}`}>{t('dashboard.points.reception')}</Link>
              </Button>
            </div>
          ) : null}
        </div>
      </Card>
    );
  };

  /**
   * «Незакриті зміни» — точки, що забули закритись у попередні дні (#114).
   *
   * ЧОМУ ТУТ І ЧОМУ ВИЩЕ ЗА «Точки сьогодні». Зміна, залишена відкритою, не
   * дає точці відкрити нову — тобто завтрашня прийомка на ній не почнеться,
   * — а сьогоднішнє зведення показує таку точку як «Зміну ще не відкрито»,
   * рівно як і ту, що просто ще не починала. Застрягла точка важливіша за
   * сьогоднішні числа, тому вона стоїть над ними.
   *
   * СПИСОК ІЗ ПОСИЛАННЯМИ, А НЕ `OpenShiftAlert`: закриває зміну лише
   * приймальник (§10.3), тому кнопки тут немає — робота керівника побачити й
   * перейти. Посилання несе І точку, І дату, бо «Каса точки» читає обидві з
   * query-рядка: керівник потрапляє одразу на той день, без крокування.
   *
   * Порожньо — не рендериться НІЧОГО: картка «незакритих змін немає» на
   * екрані, який має лишатись оглядовим, — це шум щодня заради рідкого дня.
   *
   * А ось ПОМИЛКА читання рендериться рядком, бо мовчання тут — це вже
   * відповідь: секція каже рівно «ці точки не закрились», тож її відсутність
   * читається як «жодна». Приглушено, а не тривожно: цифри поруч від
   * невдалого читання не стали неправдою, і кричати тут немає про що.
   */
  const staleShiftsSection = staleShifts.isError ? (
    <p className="text-xs text-muted-foreground">{t('dashboard.staleShifts.loadFailed')}</p>
  ) : staleRows.length === 0 ? null : (
    <Card className="border-amber/40 p-4">
      <div className="flex items-center gap-2">
        <AlertTriangle className="size-4 shrink-0 text-amber" />
        <p className="text-sm font-medium">{t('dashboard.staleShifts.title')}</p>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{t('dashboard.staleShifts.hint')}</p>
      <ul className="mt-2 divide-y divide-border">
        {staleRows.map((shift) => (
          <li key={shift.id}>
            <Link
              to={`/point-cash?point=${shift.collection_point_id}&date=${shift.business_date}`}
              className="flex items-center justify-between gap-3 py-2.5 text-sm transition-colors hover:bg-muted/60"
            >
              {/* `pointName` читає лише АКТИВНІ точки, а точку виводять з
                  роботи саме тоді, коли на ній перестали працювати — тією ж
                  подією, що лишила її останню зміну відкритою. Тут це не
                  рідкісний край, а звичайний випадок, і порожня назва була б
                  усім, що керівник побачить. UUID замість неї не допомагає:
                  його ніде в застосунку не показують, а сама точка вже є в
                  посиланні поруч. */}
              <span className="min-w-0 truncate">
                {pointName(shift.collection_point_id) || t('dashboard.staleShifts.inactivePoint')}
              </span>
              <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">
                {formatLongDate(shift.business_date, i18n.language)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {/* Те саме «перші 100», що й у плитці залишків: фраза про стелю
          читання, а не про те, ЩО саме читали — тому ключ один на двох
          (див. #77 про дублікати в i18n).
          На практиці недосяжно: `UQ_shifts_open_per_point` дає не більше
          ОДНІЄЇ відкритої зміни на точку, тож `total > 100` — це понад сто
          точок. Якби таки сталося, сервер віддав би НАЙСВІЖІШІ сто
          (`business_date DESC`), і відпали б якраз найдовше застряглі, які
          сорт вище ставить першими, — тому натяк тут не прикраса. */}
      {isTruncated(staleShifts.data) ? (
        <p className="mt-2 text-xs text-muted-foreground">{t('dashboard.tiles.balancesHint')}</p>
      ) : null}
    </Card>
  );

  const body = isError ? (
    <p role="alert" className="py-6 text-center text-destructive">
      {t('common.somethingWentWrong')}
    </p>
  ) : isPending ? (
    <div className="flex justify-center py-12">
      <Spinner />
    </div>
  ) : isOwner ? (
    <div className="space-y-4">
      {staleShiftsSection}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(300px,1fr)]">
        <SectionCard eyebrow={t('dashboard.points.title')}>
          {network.rows.length === 0 ? (
            <EmptyState title={t('dashboard.points.empty')} />
          ) : (
            <div className="space-y-3">
              {workingRows.map((row) => pointRow(row, true))}
              {idleNames.length > 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t('dashboard.points.idle', { names: idleNames.join(', ') })}
                </p>
              ) : null}
            </div>
          )}
        </SectionCard>
        <SectionCard eyebrow={t('dashboard.topBalances.title')}>
          {topBalances.length === 0 ? (
            <EmptyState title={t('dashboard.topBalances.empty')} />
          ) : (
            <ul className="divide-y divide-border">
              {topBalances.map((b) => (
                <li key={b.supplier_id}>
                  <Link
                    to={`/suppliers/${b.supplier_id}`}
                    className="flex items-center justify-between gap-3 py-2.5 text-sm transition-colors hover:bg-muted/60"
                  >
                    <span className="min-w-0 truncate">
                      {supplierName(b)} · {pointName(b.collection_point_id)}
                    </span>
                    <span className="ml-auto shrink-0 font-mono tabular-nums whitespace-nowrap">
                      {formatUah(b.debt, i18n.language)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>
    </div>
  ) : (
    <div className="space-y-4">
      {network.rows[0] ? pointRow(network.rows[0], false) : null}
      <SectionCard>
        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <Link to="/reception">{t('dashboard.shortcuts.reception')}</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/point-cash">{t('dashboard.shortcuts.pointCash')}</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/debts">{t('dashboard.shortcuts.balances')}</Link>
          </Button>
        </div>
      </SectionCard>
    </div>
  );

  return (
    <DashboardTemplate
      eyebrow={t('dashboard.eyebrow', {
        weekday: formatWeekday(today, i18n.language),
        year: today.slice(0, 4),
      })}
      title={t('dashboard.title')}
      description={t(isOwner ? 'dashboard.description' : 'dashboard.operatorDescription')}
      statsSlot={isOwner && !isPending && !isError ? statsBand : undefined}
    >
      {body}
    </DashboardTemplate>
  );
}
