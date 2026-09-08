import { it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { expectNoAxeViolations } from '../../test-axe';
import { ShareBar } from './share-bar';

const parts = [
  { value: 3, color: '#c81e4e', label: 'ягода' },
  { value: 1, color: '#2e7bc4', label: 'завдаток' },
];

it('renders one titled segment per part', () => {
  const { container } = render(<ShareBar parts={parts} />);
  const segs = container.querySelectorAll('div[title]');
  expect(segs).toHaveLength(2);
  expect(segs[0]).toHaveAttribute('title', 'ягода');
});

it('has no axe violations', async () => {
  const { container } = render(<ShareBar parts={parts} />);
  await expectNoAxeViolations(container);
});
