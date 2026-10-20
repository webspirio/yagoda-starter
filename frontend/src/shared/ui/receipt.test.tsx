import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { i18n } from '../lib/i18n';
import { ReceiptView, type ReceiptDocument } from './receipt';

const line = {
  label: 'Лохина',
  gross: '120,00 кг',
  pallet: null,
  tareLabel: '10 × Ящик',
  tareWeight: '20,00 кг',
  net: '100,00 кг',
  price: '50,00 ₴',
  amount: '5 000,00 ₴',
};

function makeDoc(over: Partial<ReceiptDocument> = {}): ReceiptDocument {
  return {
    voided: null,
    header: { point: 'Точка № 3', staff: 'Приймальник № 5' },
    meta: [
      { label: '№ квитанції', value: 'Q-1' },
      { label: 'Операція', value: 'Прийомка ягоди' },
      { label: 'Постачальник', value: 'Іваненко Петро' },
    ],
    sections: [
      [{ kind: 'berryLine', line }],
      [{ kind: 'rows', rows: [{ label: 'Нараховано', value: '5 000,00 ₴', strong: true }] }],
    ],
    footer: { note: null },
    ...over,
  };
}

const rules = (c: HTMLElement) => c.querySelectorAll('.border-dashed.border-neutral-900');

describe('ReceiptView', () => {
  beforeEach(() => void i18n.changeLanguage('uk'));
  afterEach(() => void i18n.changeLanguage('en'));

  it('prints the title and the point · staff header', () => {
    render(<ReceiptView doc={makeDoc()} />);
    expect(screen.getByText('КВИТАНЦІЯ')).toBeInTheDocument();
    const point = screen.getByText('Точка № 3');
    expect(point.parentElement).toHaveTextContent('Точка № 3 · Приймальник № 5');
    expect(point).toHaveClass('whitespace-nowrap');
    expect(screen.getByText('Приймальник № 5')).toHaveClass('whitespace-nowrap');
  });

  it('lists the meta rows in order', () => {
    const { container } = render(<ReceiptView doc={makeDoc()} />);
    const text = container.textContent ?? '';
    const at = ['№ квитанції', 'Операція', 'Постачальник'].map((l) => text.indexOf(l));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it('shows the pallet row only when a pallet is given', () => {
    const { rerender } = render(<ReceiptView doc={makeDoc()} />);
    expect(screen.queryByText('Піддон')).not.toBeInTheDocument();
    expect(screen.getByText('Брутто')).toBeInTheDocument();
    expect(screen.getByText('Тара (10 × Ящик)')).toBeInTheDocument();
    rerender(
      <ReceiptView
        doc={makeDoc({ sections: [[{ kind: 'berryLine', line: { ...line, pallet: '2,00 кг' } }]] })}
      />,
    );
    expect(screen.getByText('Піддон')).toBeInTheDocument();
    expect(screen.getByText('− 2,00 кг')).toBeInTheDocument();
  });

  it('separates the header, the meta and every group with a dashed rule', () => {
    const { container } = render(<ReceiptView doc={makeDoc()} />);
    expect(rules(container)).toHaveLength(3);
  });

  it('renders a caption section', () => {
    render(
      <ReceiptView
        doc={makeDoc({ sections: [[{ kind: 'caption', text: 'виплату P-1 анульовано' }]] })}
      />,
    );
    expect(screen.getByText('виплату P-1 анульовано')).toBeInTheDocument();
  });

  it('stamps a voided receipt with its reason', () => {
    render(<ReceiptView doc={makeDoc({ voided: { reason: 'помилка' } })} />);
    expect(screen.getByText('АНУЛЬОВАНО')).toBeInTheDocument();
    expect(screen.getByText('Причина: помилка')).toBeInTheDocument();
  });

  it('prints the note lines before the thanks and the not-fiscal line', () => {
    const { container } = render(
      <ReceiptView doc={makeDoc({ footer: { note: 'Рядок 1\n\nРядок 3' } })} />,
    );
    const text = container.textContent ?? '';
    const note = text.indexOf('Рядок 1');
    const thanks = text.indexOf('Дякуємо за співпрацю!');
    const fiscal = text.indexOf('Не є фіскальним чеком');
    expect(note).toBeGreaterThanOrEqual(0);
    expect(note).toBeLessThan(thanks);
    expect(thanks).toBeLessThan(fiscal);
    expect(screen.getByText('Рядок 3')).toBeInTheDocument();
  });

  it('still prints the thanks and the not-fiscal line without a note', () => {
    render(<ReceiptView doc={makeDoc()} />);
    expect(screen.getByText('Дякуємо за співпрацю!')).toBeInTheDocument();
    expect(screen.getByText('Не є фіскальним чеком')).toBeInTheDocument();
  });

  // #254: a 58 mm thermal printer prints grey as a dot screen, and the paper was
  // unreadable — everything that reaches the paper is black.
  it('prints nothing grey', () => {
    const { container } = render(
      <ReceiptView
        doc={makeDoc({
          voided: { reason: 'помилка' },
          sections: [
            [{ kind: 'berryLine', line }],
            [
              { kind: 'caption', text: 'P-1' },
              { kind: 'rows', rows: [{ label: 'анульовано', value: '', muted: true }] },
            ],
          ],
          footer: { note: 'Рядок' },
        })}
      />,
    );
    const paper = [...container.querySelectorAll<HTMLElement>('.printable, .printable *')].filter(
      (el) => !el.closest('.print\\:hidden'),
    );
    expect(
      paper.filter((el) =>
        /\b(text-(neutral|gray|slate|zinc|stone|muted)|opacity-)/.test(el.className),
      ),
    ).toEqual([]);
  });

  it('marks its root as receipt paper — the print rules size the 58 mm strip by it', () => {
    const { container } = render(<ReceiptView doc={makeDoc()} />);
    expect(container.firstElementChild).toHaveClass('printable', 'receipt-paper');
  });

  it('drops a number that does not fit onto its own line, never breaking or clipping it', () => {
    render(
      <ReceiptView
        doc={makeDoc({
          sections: [
            [{ kind: 'berryLine', line: { ...line, tareLabel: '6 × Чешка, 2 × Ящик великий' } }],
          ],
        })}
      />,
    );
    const value = screen.getByText('− 20,00 кг');
    expect(value).toHaveClass('whitespace-nowrap', 'ml-auto');
    expect(value.parentElement).toHaveClass('flex-wrap');
  });

  it('lets a text value — a supplier name, a code — wrap instead of overflowing', () => {
    render(<ReceiptView doc={makeDoc()} />);
    const name = screen.getByText('Іваненко Петро');
    expect(name).not.toHaveClass('whitespace-nowrap');
    expect(name).toHaveClass('[overflow-wrap:anywhere]');
  });

  it('keeps the saved-in-system line on screen only', () => {
    render(<ReceiptView doc={makeDoc()} />);
    expect(screen.getByText(/Квитанція збережена в системі/)).toHaveClass('print:hidden');
  });
});
