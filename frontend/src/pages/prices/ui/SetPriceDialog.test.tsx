import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { i18n } from '@/shared/lib/i18n';
import uk from '@/shared/lib/i18n/locales/uk.json';
import { SetPriceDialog } from './SetPriceDialog';

const { setPriceMock, bulkMock, toastMock } = vi.hoisted(() => {
  const toastMock = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() });
  return { setPriceMock: vi.fn(), bulkMock: vi.fn(), toastMock };
});

vi.mock('../api/gradePrices', () => ({
  useSetPriceMutation: () => ({ mutateAsync: setPriceMock }),
}));
vi.mock('../api/priceSheet', () => ({
  useBulkSetPriceMutation: () => ({ mutateAsync: bulkMock }),
}));
vi.mock('@/shared/ui/toast', () => ({ toast: toastMock }));

const grade = { id: 'g1', name: 'Вищий сорт', productId: 'pr1', productName: 'Малина' };
const current = { base_price: '150.00', max_markup: '30.00', max_discount: '20.00' };

function renderDialog(onClose = vi.fn()) {
  render(
    <SetPriceDialog
      pointIds={['p1']}
      pointName="Шипинки"
      grade={grade}
      current={current}
      open
      onClose={onClose}
    />,
  );
  return { onClose };
}

beforeEach(async () => {
  setPriceMock.mockReset().mockResolvedValue({});
  bulkMock.mockReset();
  toastMock.mockReset();
  toastMock.success.mockReset();
  await act(() => i18n.changeLanguage('uk'));
});
afterEach(async () => {
  await act(() => i18n.changeLanguage('en'));
});

describe('SetPriceDialog — the prefill reads in the locale, the API gets the canonical form', () => {
  it('shows the current price with the decimal comma', () => {
    renderDialog();
    expect(screen.getByLabelText(uk.prices.form.base)).toHaveValue('150,00');
    expect(screen.getByLabelText(uk.prices.form.markup)).toHaveValue('30,00');
    expect(screen.getByLabelText(uk.prices.form.discount)).toHaveValue('20,00');
  });

  it('an untouched save is still «the same price» — nothing is written', async () => {
    const { onClose } = renderDialog();
    await userEvent.click(screen.getByRole('button', { name: uk.common.save }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(toastMock).toHaveBeenCalledWith(uk.prices.toast.unchanged);
    expect(setPriceMock).not.toHaveBeenCalled();
  });

  it('sends the untouched fields canonical beside the edited one', async () => {
    renderDialog();
    const base = screen.getByLabelText(uk.prices.form.base);
    await userEvent.clear(base);
    await userEvent.type(base, '155');
    await userEvent.click(screen.getByRole('button', { name: uk.common.save }));

    await waitFor(() => expect(setPriceMock).toHaveBeenCalledTimes(1));
    expect(setPriceMock).toHaveBeenCalledWith({
      collection_point_id: 'p1',
      product_grade_id: 'g1',
      base_price: '155',
      max_markup: '30.00',
      max_discount: '20.00',
    });
  });
});
