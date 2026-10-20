import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/shared/ui/badge';

/** One label/value pair on the paper, already resolved to display strings. */
interface ReceiptRow {
  label: string;
  value: string;
  strong?: boolean;
  muted?: boolean;
}

/** One berry line, already resolved to display strings — the builder passes
 *  values only; the renderer owns the labels (Брутто, Піддон, Тара, …). */
interface ReceiptBerryLine {
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
  /** «Точка № 3», «Приймальник № 5» — resolved by the builder (#145: numbers, not names). */
  header: { point: string; staff: string };
  /** № квитанції, Операція, Постачальник. */
  meta: ReceiptRow[];
  /** Groups; a dashed rule precedes each group. */
  sections: ReceiptSection[][];
  /** `note` is the network's `receipt_note`, already wrapped — one printed line per `\n`. */
  footer: { note: string | null };
}

function Row({
  label,
  value,
  strong,
  muted,
  text,
}: {
  label: ReactNode;
  value: ReactNode;
  strong?: boolean;
  muted?: boolean;
  /** A text value (a name, a code) wraps; a number never does. */
  text?: boolean;
}) {
  // #254: a 58 mm strip holds ~32 characters. A pair that doesn't fit drops
  // its number onto the next line, right-aligned — never clipped the way
  // «24,50 кг» printed as «24,50 к».
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-2 py-[3px]">
      <span className={muted ? 'italic' : ''}>{label}</span>
      <span
        className={`ml-auto font-mono ${text ? 'text-right [overflow-wrap:anywhere]' : 'whitespace-nowrap'} ${strong ? 'text-[1.2em] font-bold' : ''}`}
      >
        {value}
      </span>
    </div>
  );
}

function Rule() {
  return <div className="my-3 border-t border-dashed border-neutral-900" />;
}

function BerryLine({ line }: { line: ReceiptBerryLine }) {
  const { t } = useTranslation();
  return (
    <div>
      <div className="py-[3px] font-bold">{line.label}</div>
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
      return <div className="text-[0.87em]">{section.text}</div>;
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
    <div className="printable receipt-paper rounded-lg border border-dashed border-border bg-white p-4 text-[15px] font-semibold text-black">
      {doc.voided ? (
        <div className="mb-3 rounded-md border-2 border-destructive p-2 text-center">
          <Badge variant="destructive" className="h-auto px-3 py-1 text-[1.13em] font-bold">
            {t('receipt.voided')}
          </Badge>
          <p className="mt-1 text-[0.87em] text-destructive">
            {t('receipt.voidReason', { reason: doc.voided.reason })}
          </p>
        </div>
      ) : null}

      <div className="text-center">
        <div className="text-[1.13em] font-bold tracking-tight">{t('receipt.docTitle')}</div>
        {/* Each half wraps as a whole — «№» never parts from its number. */}
        <div className="text-[0.87em]">
          <span className="whitespace-nowrap">{doc.header.point}</span> ·{' '}
          <span className="whitespace-nowrap">{doc.header.staff}</span>
        </div>
      </div>

      <Rule />

      {doc.meta.map((r, i) => (
        <Row key={i} label={r.label} value={r.value} strong={r.strong} muted={r.muted} text />
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
            {l || '\u00a0'}
          </div>
        ))}
        <div className={noteLines.length > 0 ? 'mt-2' : ''}>{t('receipt.thanks')}</div>
        <div className="text-[0.87em]">{t('receipt.notFiscal')}</div>
      </div>
    </div>
  );
}
