import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/shared/ui/badge';

/** One label/value pair on the paper, already resolved to display strings. */
export interface ReceiptRow {
  label: string;
  value: string;
  strong?: boolean;
  muted?: boolean;
}

/** One berry line, already resolved to display strings — the builder passes
 *  values only; the renderer owns the labels (Брутто, Піддон, Тара, …). */
export interface ReceiptBerryLine {
  label: string;
  gross: string;
  /** `null` hides the Піддон row — only shown when the intake had one. */
  pallet: string | null;
  /** «{units} × {tare name}»[, …] — every tare type on this line. */
  tareLabel: string;
  tareWeight: string;
  net: string;
  price: string;
  amount: string;
}

export type ReceiptSection =
  | { kind: 'rows'; rows: ReceiptRow[] }
  | { kind: 'berryLine'; line: ReceiptBerryLine }
  /** A muted small line (payout codes, annulments). */
  | { kind: 'caption'; text: string };

/** The receipt as data: a builder per document type fills it, `ReceiptView`
 *  is the one place that turns it into paper. */
export interface ReceiptDocument {
  voided: { reason: string } | null;
  header: { pointName: string; staffName: string };
  /** № квитанції, Операція, Дата, Постачальник. */
  meta: ReceiptRow[];
  /** Groups; a dashed rule precedes each group. */
  sections: ReceiptSection[][];
  /** `note` is the network's `receipt_note`, already wrapped — one printed line per `\n`. */
  footer: { note: string | null };
}

/** «Бондар Тарас», or «—» when nobody is known. */
export function staffName(
  p: { first_name: string; last_name: string } | null | undefined,
): string {
  return p ? `${p.last_name} ${p.first_name}` : '—';
}

function Row({
  label,
  value,
  strong,
  muted,
}: {
  label: ReactNode;
  value: ReactNode;
  strong?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-[3px]">
      <span className={muted ? 'text-neutral-500' : ''}>{label}</span>
      <span className={`font-mono ${strong ? 'text-base font-semibold' : ''}`}>{value}</span>
    </div>
  );
}

function Rule() {
  return <div className="my-3 border-t border-dashed border-neutral-300" />;
}

function BerryLine({ line }: { line: ReceiptBerryLine }) {
  const { t } = useTranslation();
  return (
    <div>
      <Row label={line.label} value="" muted />
      <Row label={t('receipt.gross')} value={line.gross} />
      {line.pallet !== null ? <Row label={t('receipt.pallet')} value={`− ${line.pallet}`} /> : null}
      <Row label={t('receipt.tare', { detail: line.tareLabel })} value={`− ${line.tareWeight}`} />
      <div className="my-1.5 border-t border-neutral-900" />
      <Row label={t('receipt.net')} value={line.net} strong />
      <Row label={t('receipt.pricePerKg')} value={line.price} />
      <Row label={t('receipt.amount')} value={line.amount} />
    </div>
  );
}

function Section({ section }: { section: ReceiptSection }) {
  switch (section.kind) {
    case 'rows':
      return (
        <>
          {section.rows.map((r, i) => (
            <Row key={i} label={r.label} value={r.value} strong={r.strong} muted={r.muted} />
          ))}
        </>
      );
    case 'berryLine':
      return <BerryLine line={section.line} />;
    case 'caption':
      return <div className="text-[10px] text-neutral-500">{section.text}</div>;
    default: {
      const unreachable: never = section;
      return unreachable;
    }
  }
}

/**
 * The one renderer for every printed receipt — `.printable` is what
 * `index.css`'s `@media print` rules keep on the page. Pure layout: no domain
 * knowledge, every string arrives resolved.
 */
export function ReceiptView({ doc }: { doc: ReceiptDocument }) {
  const { t } = useTranslation();
  const noteLines = doc.footer.note?.split('\n') ?? [];

  return (
    <div className="printable rounded-lg border border-dashed border-border bg-white p-4 text-[13px] text-neutral-900">
      {doc.voided ? (
        <div className="mb-3 rounded-md border-2 border-destructive p-2 text-center">
          <Badge variant="destructive" className="h-auto px-3 py-1 text-sm font-semibold">
            {t('receipt.voided')}
          </Badge>
          <p className="mt-1 text-xs text-destructive">
            {t('receipt.voidReason', { reason: doc.voided.reason })}
          </p>
        </div>
      ) : null}

      <div className="text-center">
        <div className="text-sm font-semibold tracking-tight">{t('receipt.docTitle')}</div>
        <div className="text-[11px] text-neutral-500">
          {doc.header.pointName} · {doc.header.staffName}
        </div>
      </div>

      <Rule />

      {doc.meta.map((r, i) => (
        <Row key={i} label={r.label} value={r.value} strong={r.strong} muted={r.muted} />
      ))}

      {doc.sections.map((group, gi) => (
        <div key={gi}>
          <Rule />
          {group.map((section, si) => (
            <Section key={si} section={section} />
          ))}
        </div>
      ))}

      {/* A note for the screen only — the paper ends with the footer block below. */}
      <div className="mt-4 text-center text-[10px] text-neutral-400 print:hidden">
        {t('receipt.footer')}
      </div>

      {/* The network's note as plain text (no rules, no blank lines for
          handwriting — PR #234 review), then the thanks and the fiscal
          disclaimer. Shown on screen and on paper. */}
      <div className="mt-4 break-inside-avoid text-center font-mono">
        {noteLines.map((l, i) => (
          <div key={i} className="whitespace-pre">
            {l || ' '}
          </div>
        ))}
        <div className={noteLines.length > 0 ? 'mt-2' : ''}>{t('receipt.thanks')}</div>
        <div className="text-[10px] text-neutral-500">{t('receipt.notFiscal')}</div>
      </div>
    </div>
  );
}
