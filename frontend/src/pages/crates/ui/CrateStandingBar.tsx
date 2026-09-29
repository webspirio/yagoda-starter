import { useTranslation } from 'react-i18next';
import { Card } from '@/shared/ui/card';
import { cn } from '@/shared/lib/cn';
import type { CrateStanding } from '@/entities/crate';

/**
 * The allotment, split into empty / with people / with berries — spec §8.2's
 * revised figures, §8.4's Bar bullet. The identity line
 * `400 = 350 + 50 + 0` adds nothing to the data and is exactly why it is
 * here, and it is ALWAYS shown now: `on_hand` is never null any more, so the
 * sum is always computable even before an allotment is set.
 *
 * NOTHING IS COMPUTED HERE beyond the bar's own widths (clamped at 0 — there
 * is no negative width) and `Math.abs` for the shortfall/overage magnitude.
 * Every figure comes from `GET /crate-standing`; a negative `on_hand` prints
 * red with the warning below rather than being hidden or clamped away.
 */
export function CrateStandingBar({ standing }: { standing: CrateStanding }) {
  const { t, i18n } = useTranslation();
  const n = (value: number) => value.toLocaleString(i18n.language).replace('-', '−');
  const {
    allotment,
    received,
    on_hand: onHand,
    in_field: inField,
    with_berry: withBerry,
    total,
    shortfall,
  } = standing;
  const negative = onHand < 0;

  const segments = [
    { key: 'onHand', value: Math.max(0, onHand), className: 'bg-[var(--leaf)]' },
    { key: 'inField', value: Math.max(0, inField), className: 'bg-[var(--amber)]' },
    { key: 'withBerry', value: Math.max(0, withBerry), className: 'bg-primary' },
  ];
  const barTotal = segments.reduce((sum, s) => sum + s.value, 0);

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="flex items-baseline gap-2">
          <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            {t('crates.standing.allotment')}
          </span>
          <span
            className={cn(
              'font-mono text-3xl leading-none font-semibold',
              allotment === null ? 'text-muted-foreground' : undefined,
            )}
          >
            {/* «—» is «не задано», NOT zero (§6.9 / §8.2). */}
            {allotment === null ? '—' : n(allotment)}
          </span>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {t('crates.standing.received', { received: n(received) })}
      </p>

      <div className="mt-4 flex h-2.5 w-full gap-[2px] overflow-hidden rounded-full bg-muted">
        {barTotal > 0
          ? segments.map((s) => (
              <div
                key={s.key}
                data-segment={s.key}
                className={cn('h-full first:rounded-l-full last:rounded-r-full', s.className)}
                style={{ width: `${(s.value / barTotal) * 100}%` }}
              />
            ))
          : null}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Figure
          label={t('crates.standing.onHand')}
          dot="bg-[var(--leaf)]"
          value={n(onHand)}
          tone={negative ? 'text-destructive' : undefined}
        />
        <Figure label={t('crates.standing.inField')} dot="bg-[var(--amber)]" value={n(inField)} />
        <Figure label={t('crates.standing.withBerry')} dot="bg-primary" value={n(withBerry)} />
      </div>

      <p className="mt-3 font-mono text-xs text-muted-foreground">
        {`${t('crates.standing.total')} ${n(total)} = ${n(onHand)} + ${n(inField)} + ${n(withBerry)}`}
      </p>

      <div className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-line2 pt-3">
        {/* §8.4 — no allotment means no shortfall to name: a bare «—», no label at all. */}
        {allotment === null ? (
          <span className="font-mono text-lg font-semibold text-muted-foreground">
            {t('crates.standing.shortfallNone')}
          </span>
        ) : shortfall === 0 ? (
          <span className="text-sm font-medium">{t('crates.standing.complete')}</span>
        ) : (
          <>
            <span className="text-sm font-medium">
              {shortfall !== null && shortfall < 0
                ? t('crates.standing.over')
                : t('crates.standing.shortfall')}
            </span>
            <span className="font-mono text-lg font-semibold">{n(Math.abs(shortfall ?? 0))}</span>
          </>
        )}
      </div>

      {negative ? (
        <p className="mt-2 text-sm font-medium text-destructive">{t('crates.standing.negative')}</p>
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
