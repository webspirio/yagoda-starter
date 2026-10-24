import { Fragment, type ReactNode } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { TraceTerm, type TraceTone } from '@/shared/ui/trace';
import { formatKg, unbreakable } from '@/shared/lib/money';
import type { NetLine, NetParts } from '../lib/formula';

/** Where each operand of a net formula was read — the ids its terms light up. */
export interface NetTraceIds {
  gross: string;
  pallet: string;
  /** A tare row's count; `i` is the row. */
  units: (i: number) => string;
  /** A tare row's per-unit weight. */
  weight: (i: number) => string;
  tareKg: string;
  net: string;
}

/** A `<Trans>` slot that renders a node of its own, ignoring the (empty) tag. */
function Slot({ node }: { node: ReactNode }) {
  return <>{node}</>;
}

/**
 * `lib/formula`'s net line, rendered: «300,60 кг − 15,60 кг − 48 шт. × 1,20 кг =
 * 227,40 кг» with every operand a `TraceTerm` (client, 24.10) pointing at `ids` —
 * the form's fields, or the line's own figures. `netTone` is the result's colour:
 * berry where the net is the screen's brand figure (the form), neutral elsewhere.
 */
export function NetFormula({
  line,
  parts,
  ids,
  netTone = 'neutral',
}: {
  line: NetLine;
  parts: NetParts;
  ids: NetTraceIds;
  netTone?: TraceTone;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? 'uk';
  const kg = (value: string) => unbreakable(formatKg(value, locale));
  // An empty term: `<Trans>` fills it with the tag's own (formatted) figure.
  const term = (refs: string, hintKey: string, tone: TraceTone = 'neutral') => (
    <TraceTerm refs={refs} tone={tone} hint={t(hintKey)}>
      {null}
    </TraceTerm>
  );

  const terms: ReactNode[] = [];
  if (parts.pallet !== null) {
    terms.push(
      <TraceTerm key="pallet" refs={ids.pallet} hint={t('reweigh.trace.pallet')}>
        {kg(parts.pallet)}
      </TraceTerm>,
    );
  }
  if (parts.tare?.kind === 'units') {
    parts.tare.terms.forEach((row, i) => {
      terms.push(
        <Trans
          key={`units-${i}`}
          t={t}
          i18nKey="reweigh.formula.tareUnits"
          values={{ units: row.units, weight: kg(row.weightKg) }}
          components={{
            units: term(ids.units(i), 'reweigh.trace.units'),
            weight: term(ids.weight(i), 'reweigh.trace.weight'),
          }}
        />,
      );
    });
  } else if (parts.tare?.kind === 'kg') {
    terms.push(
      <Trans
        key="tareKg"
        t={t}
        i18nKey="reweigh.formula.tareKg"
        values={{ kg: kg(parts.tare.kg) }}
        components={{ kg: term(ids.tareKg, 'reweigh.trace.tareKg') }}
      />,
    );
  }
  const joined = terms.map((node, i) => (
    <Fragment key={i}>
      {i > 0 ? t('reweigh.formula.join') : null}
      {node}
    </Fragment>
  ));

  return (
    <Trans
      t={t}
      i18nKey="reweigh.formula.net"
      values={{ gross: kg(line.gross), net: kg(line.net) }}
      components={{
        gross: term(ids.gross, 'reweigh.trace.gross'),
        terms: <Slot node={joined} />,
        net: term(ids.net, 'reweigh.trace.net', netTone),
      }}
    />
  );
}
