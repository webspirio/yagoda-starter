import { it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { expectNoAxeViolations } from '../../../test-axe';
import { DocumentPage } from './document-page';

it('малює заголовок як h1 і тіло документа', () => {
  render(
    <DocumentPage title="Аркуш керівника">
      <p>Тіло документа</p>
    </DocumentPage>,
  );

  expect(screen.getByRole('heading', { level: 1, name: 'Аркуш керівника' })).toBeInTheDocument();
  expect(screen.getByText('Тіло документа')).toBeInTheDocument();
});

it('малює кнопку «Друк» і клік по ній кличе onPrint рівно раз', async () => {
  const onPrint = vi.fn();
  render(
    <DocumentPage title="Аркуш керівника" onPrint={onPrint}>
      <p>Тіло документа</p>
    </DocumentPage>,
  );

  const button = screen.getByRole('button', { name: /Друк/ });
  expect(button).toBeInTheDocument();

  await userEvent.click(button);
  expect(onPrint).toHaveBeenCalledTimes(1);
});

it('за замовчуванням обгортає тіло в .printable, а з printable={false} — ні', () => {
  const { container: withPrintable } = render(
    <DocumentPage title="Аркуш керівника" onPrint={vi.fn()}>
      <p>Тіло документа</p>
    </DocumentPage>,
  );
  expect(withPrintable.querySelector('.printable')).not.toBeNull();

  const { container: withoutPrintable } = render(
    <DocumentPage title="Аркуш керівника" printable={false} onPrint={vi.fn()}>
      <p>Тіло документа</p>
    </DocumentPage>,
  );
  expect(withoutPrintable.querySelector('.printable')).toBeNull();
});

it('не має порушень a11y', async () => {
  const { container } = render(
    <DocumentPage
      title="Аркуш керівника"
      meta={<div>Точка: Шипинки · Дата: 04.08.2026</div>}
      onPrint={vi.fn()}
    >
      <p>Тіло документа</p>
    </DocumentPage>,
  );

  await expectNoAxeViolations(container);
});
