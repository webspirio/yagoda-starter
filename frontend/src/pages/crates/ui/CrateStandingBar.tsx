import { useTranslation } from 'react-i18next';
import { Card } from '@/shared/ui/card';
import { cn } from '@/shared/lib/cn';
import type { CrateStanding } from '@/entities/crate';

/**
 * The allotment, split into where the crates physically are — §6.8's 20:40
 * block, which the client asked to SEE rather than check in her head
 * («щоб вони візуально це бачили»). The identity line
 * `800 = 341 + 195 + 264` adds nothing to the data and is exactly why it is
 * here.
 *
 * NOTHING IS COMPUTED HERE. Every number comes from `GET /crate-standing`;
 * only the bar's widths are derived, and a negative on-hand draws no fill
 * (there is no negative width) — the red figure and the warning below say it.
 */
export function CrateStandingBar({ standing }: { standing: CrateStanding }) {
  const { t, i18n } = useTranslation();
  const n = (value: number) => value.toLocaleString(i18n.language).replace('-', '−');
  const { allotment, on_hand: onHand, in_field: inField, at_base: atBase, shortfall } = standing;
  const known = allotment !== null && onHand !== null;
  const overdrawn = onHand !== null && onHand < 0;

  const segments = [
    { key: 'onHand', value: Math.max(0, onHand ?? 0), className: 'bg-[var(--leaf)]' },
    { key: 'inField', value: Math.max(0, inField), className: 'bg-[var(--amber)]' },
    { key: 'atBase', value: Math.max(0, atBase), className: 'bg-primary' },
  ];
  const total = segments.reduce((sum, s) => sum + s.value, 0);

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="flex items-baseline gap-2">
          <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            {t('crates.standing.allotment')}
          </span>
          <span className={cn('font-mono text-3xl leading-none font-semibold', known ? undefined : 'text-muted-foreground')}>
            {/* «—» is «не задано», NOT zero (§6.9). */}
            {allotment === null ? '—' : n(allotment)}
          </span>
        </div>
        {allotment === null ? (
          <span className="text-xs text-muted-foreground">{t('crates.standing.unset')}</span>
        ) : null}
      </div>

      <div className="mt-4 flex h-2.5 w-full gap-[2px] overflow-hidden rounded-full bg-muted">
        {total > 0
          ? segments.map((s) => (
              <div
                key={s.key}
                data-segment={s.key}
                className={cn('h-full first:rounded-l-full last:rounded-r-full', s.className)}
                style={{ width: `${(s.value / total) * 100}%` }}
              />
            ))
          : null}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Figure label={t('crates.standing.onHand')} dot="bg-[var(--leaf)]"
          value={onHand === null ? '—' : n(onHand)} tone={overdrawn ? 'text-destructive' : undefined} />
        <Figure label={t('crates.standing.inField')} dot="bg-[var(--amber)]" value={n(inField)} />
        <Figure label={t('crates.standing.atBase')} dot="bg-primary" value={n(atBase)} />
      </div>

      {known ? (
        <p className="mt-3 font-mono text-xs text-muted-foreground">
          {`${n(allotment)} = ${n(onHand)} + ${n(inField)} + ${n(atBase)}`}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-line2 pt-3">
        <span className="text-sm font-medium">{t('crates.standing.shortfall')}</span>
        <span className="font-mono text-lg font-semibold">{n(shortfall)}</span>
        <span className="text-xs text-muted-foreground">
          {t('crates.standing.shortfallParts', { inField: n(inField), atBase: n(atBase) })}
        </span>
      </div>

      {overdrawn ? (
        <p className="mt-2 text-sm font-medium text-destructive">{t('crates.standing.overdrawn')}</p>
      ) : null}
    </Card>
  );
}

function Figure({ label, value, dot, tone }: { label: string; value: string; dot: string; tone?: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className={cn('size-2.5 shrink-0 rounded-[3px]', dot)} aria-hidden="true" />
      <div className="min-w-0">
        <p className="truncate text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
        <p className={cn('mt-0.5 font-mono text-xl leading-none font-semibold', tone)}>{value}</p>
      </div>
    </div>
  );
}
