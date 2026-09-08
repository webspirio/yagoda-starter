import { it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expectNoAxeViolations } from '../../../test-axe';
import { DashboardPage, type StatItem, type DashboardSection } from './dashboard-page';

const stats: StatItem[] = [
  { label: 'Виторг', value: '12 000 ₴', tone: 'berry' },
  { label: 'Прийнято', value: '340 кг', hint: 'за сьогодні' },
];

const sections: DashboardSection[] = [
  { id: 'trend', title: 'Динаміка', content: <div>вміст-секції</div> },
];

it('renders the title as an h1, the stat band and a section body', () => {
  render(<DashboardPage title="Зведення" stats={stats} sections={sections} />);

  expect(screen.getByRole('heading', { level: 1, name: 'Зведення' })).toBeInTheDocument();
  expect(screen.getByText('Виторг')).toBeInTheDocument();
  expect(screen.getByText('12 000 ₴')).toBeInTheDocument();
  expect(screen.getByText('вміст-секції')).toBeInTheDocument();
});

it('renders an interactive StatItem as a button that fires onClick', async () => {
  const onClick = vi.fn();
  render(
    <DashboardPage
      title="Зведення"
      stats={[{ label: 'Каса', value: '5 000 ₴', onClick }]}
    />,
  );

  const button = screen.getByRole('button', { name: /Каса/ });
  await userEvent.click(button);
  expect(onClick).toHaveBeenCalledTimes(1);
});

it('renders section content passed as an arbitrary node (charts arrive as props)', () => {
  render(
    <DashboardPage
      title="Зведення"
      sections={[{ id: 'chart', title: 'Графік', content: <div>chart-here</div> }]}
    />,
  );

  expect(screen.getByText('chart-here')).toBeInTheDocument();
});

it('has no axe violations', async () => {
  const { container } = render(
    <DashboardPage title="Зведення" stats={stats} sections={sections} />,
  );
  await expectNoAxeViolations(container);
});
