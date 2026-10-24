import { Trans, useTranslation } from 'react-i18next';
import { Card } from '@/shared/ui/card';
import { Eyebrow } from '@/shared/ui/eyebrow';
import { TraceScope, TraceTerm } from '@/shared/ui/trace';
import { formatCount } from '@/shared/lib/money';
import { cn } from '@/shared/lib/cn';
import type { CrateStanding } from '@/entities/crate';

/**
 * The allotment, split into empty / with people / with berries — spec §8.2's
 * revised figures, §8.4's Bar bullet. The identity line
 * `400 ящ. = 350 ящ. + 50 ящ. + 0 ящ.` adds nothing to the data and is exactly why it is
 * here, and it is ALWAYS shown now: `on_hand` is never null any more, so the
 * sum is always computable even before an allotment is set.
 *
 * NOTHING IS COMPUTED HERE beyond the bar's own widths (clamped at 0 — there
 * is no negative width) and `Math.abs` for the shortfall/overage magnitude.
 * Every figure comes from `GET /crate-standing`. A negative `on_hand` is a
 * legitimate state since the 23.10.2026 call (§6.9) — the point owes people
 * crates — so it prints AMBER with its minus and the note below, never red,
 * and never hidden or clamped to 0 in the figures (only the bar's width is).
 *
 * Every stand-alone figure carries «ящ.» (`crates.standing.value`), and the
 * identity line is traced (client, 24.10): each operand lights the figure it
 * repeats (`crates:onHand` / `crates:inField` / `crates:withBerry`, in the
 * bar's own colours), and the total — shown nowhere else — lights all three.
 */
export function CrateStandingBar({ standing }: { standing: CrateStanding }) {
  const { t, i18n } = useTranslation();
  const n = (value: number) => formatCount(value, i18n.language);
  /** A stand-alone figure: the count with its unit. */
  const u = (value: number) => t('crates.standing.value', { n: n(value) });
  const {
    allotment,
    received,
    on_hand: onHand,
    in_field: inField,
    with_berry: withBerry,
    total,
    shortfall,
    in_transit: inTransit,
  } = standing;
  const negative = onHand < 0;

  const segments = [
    { key: 'onHand', value: Math.max(0, onHand), className: 'bg-[var(--leaf)]' },
    { key: 'inField', value: Math.max(0, inField), className: 'bg-[var(--amber)]' },
    { key: 'withBerry', value: Math.max(0, withBerry), className: 'bg-primary' },
  ];
  const barTotal = segments.reduce((sum, s) => sum + s.value, 0);

  return (
    <TraceScope>
      <Card className="p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <div className="flex items-baseline gap-2">
            <Eyebrow>{t('crates.standing.allotment')}</Eyebrow>
            <span
              className={cn(
                'font-mono text-[26px] leading-none font-semibold tracking-tight',
                allotment === null ? 'text-muted-foreground' : undefined,
              )}
            >
              {/* «—» is «не задано», NOT zero (§6.9 / §8.2). */}
              {allotment === null ? '—' : u(allotment)}
            </span>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          {t('crates.standing.received', { received: n(received) })}
        </p>
        {/* Sent, not yet accepted: not empties at the point until the transfer is taken in
          (audit 2026-10-24, F6) — said here, where the empties are counted. */}
        {inTransit > 0 ? (
          <p className="text-xs text-muted-foreground">
            {t('crates.standing.inTransit', { in_transit: n(inTransit) })}
          </p>
        ) : null}

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
            value={u(onHand)}
            trace="crates:onHand"
            tone={negative ? 'text-amber' : undefined}
          />
          <Figure
            label={t('crates.standing.inField')}
            dot="bg-[var(--amber)]"
            value={u(inField)}
            trace="crates:inField"
          />
          <Figure
            label={t('crates.standing.withBerry')}
            dot="bg-primary"
            value={u(withBerry)}
            trace="crates:withBerry"
          />
        </div>

        <p data-identity className="mt-3 text-xs text-muted-foreground">
          <Trans
            t={t}
            i18nKey="crates.standing.identity"
            values={{
              total: n(total),
              onHand: n(onHand),
              inField: n(inField),
              withBerry: n(withBerry),
            }}
            components={{
              total: (
                <TraceTerm
                  refs={['crates:onHand', 'crates:inField', 'crates:withBerry']}
                  hint={t('crates.standing.identityTotal')}
                />
              ),
              // A negative «empty at the point» is amber, the figure's own tone.
              onHand: (
                <TraceTerm
                  refs="crates:onHand"
                  tone={negative ? 'amber' : 'leaf'}
                  hint={t('crates.standing.onHand')}
                />
              ),
              inField: (
                <TraceTerm refs="crates:inField" tone="amber" hint={t('crates.standing.inField')} />
              ),
              withBerry: (
                <TraceTerm
                  refs="crates:withBerry"
                  tone="berry"
                  hint={t('crates.standing.withBerry')}
                />
              ),
            }}
          />
        </p>

        <div className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-line2 pt-3">
          {/* §8.4 — no allotment means no shortfall to name: a bare «—», no label at all. */}
          {allotment === null ? (
            <span className="font-mono text-xl font-semibold text-muted-foreground">
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
              <span className="font-mono text-xl font-semibold">{u(Math.abs(shortfall ?? 0))}</span>
            </>
          )}
        </div>

        {negative ? (
          <p className="mt-2 text-sm font-medium text-amber">{t('crates.standing.negative')}</p>
        ) : null}
      </Card>
    </TraceScope>
  );
}

function Figure({
  label,
  value,
  dot,
  trace,
  tone,
}: {
  label: string;
  value: string;
  dot: string;
  /** The `data-trace` id the identity line's operand lights. */
  trace: string;
  tone?: string;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span className={cn('size-2.5 shrink-0 rounded-[3px]', dot)} aria-hidden="true" />
      <div className="min-w-0">
        <Eyebrow className="truncate">{label}</Eyebrow>
        <p
          data-trace={trace}
          className={cn('mt-0.5 font-mono text-xl leading-none font-semibold', tone)}
        >
          {value}
        </p>
      </div>
    </div>
  );
}
