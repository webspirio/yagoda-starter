import {
  ArrowLeftRight,
  Banknote,
  BarChart3,
  Boxes,
  Calculator,
  CircleDollarSign,
  History,
  type LucideIcon,
  MapPin,
  Package,
  Scale,
  Settings,
  UserCog,
  Users,
  Wallet,
  Weight,
} from 'lucide-react';
import type { UserRole } from '@/entities/user';

interface NavItem {
  labelKey: string;
  icon: LucideIcon;
  /** Live route; absent = screen not built yet (rendered disabled). */
  to?: string;
  /** Gates the item to a role, within an already-visible group. */
  role?: UserRole;
}
interface NavGroup {
  labelKey: string;
  /** Gates the whole group to a role. */
  role?: UserRole;
  items: NavItem[];
}

// Mirrors the mock's grouped navigation. An item without a `to` is a screen not
// wired yet — shown but disabled («Скоро»). None is left today: «Середня ціна по
// мережі» and «Аркуш керівника» became «Усі точки» on «Собівартість дня» (23.10).
export const NAV_GROUPS: NavGroup[] = [
  {
    labelKey: 'nav.group.onPoint',
    items: [
      { labelKey: 'nav.dashboard', icon: BarChart3, to: '/' },
      { labelKey: 'nav.reception', icon: Scale, to: '/reception' },
      { labelKey: 'nav.crates', icon: Boxes, to: '/crates' },
      { labelKey: 'nav.pointCash', icon: Banknote, to: '/point-cash' },
      // Owner only (#221): the operator reads a grade's price at reception.
      { labelKey: 'nav.prices', icon: CircleDollarSign, to: '/prices', role: 'network_owner' },
    ],
  },
  {
    labelKey: 'nav.group.peopleMoney',
    items: [
      { labelKey: 'nav.suppliers', icon: Users, to: '/suppliers' },
      { labelKey: 'nav.debts', icon: Wallet, to: '/debts' },
      { labelKey: 'nav.journal', icon: History, to: '/journal', role: 'network_owner' },
    ],
  },
  {
    labelKey: 'nav.group.management',
    role: 'network_owner',
    items: [
      { labelKey: 'nav.cost', icon: Calculator, to: '/cost-of-day' },
      { labelKey: 'nav.reweigh', icon: Weight, to: '/reweigh' },
      { labelKey: 'nav.transfers', icon: ArrowLeftRight, to: '/transfers', role: 'network_owner' },
      { labelKey: 'nav.points', icon: MapPin, to: '/points' },
      { labelKey: 'nav.users', icon: UserCog, to: '/users' },
      { labelKey: 'nav.refs', icon: Package, to: '/catalog' },
      { labelKey: 'nav.settings', icon: Settings, to: '/settings' },
    ],
  },
];

/** Pages outside the nav that still deserve a title in the phone's top bar. */
const EXTRA_TITLES: Record<string, string> = { '/profile': 'nav.profile' };

/**
 * The nav label of the screen on `pathname` — the phone's top bar names the screen it
 * is on, since the sidebar that would say so is folded away (audit 2026-10-24, F4).
 * `/suppliers/:id` reads «Постачальники»: the nearest nav item that owns the path.
 */
export function routeTitleKey(pathname: string): string | null {
  if (EXTRA_TITLES[pathname]) return EXTRA_TITLES[pathname];
  let best: NavItem | null = null;
  for (const group of NAV_GROUPS) {
    for (const item of group.items) {
      if (!item.to) continue;
      const owns =
        item.to === '/'
          ? pathname === '/'
          : pathname === item.to || pathname.startsWith(`${item.to}/`);
      if (owns && (best === null || item.to.length > (best.to?.length ?? 0))) best = item;
    }
  }
  return best?.labelKey ?? null;
}
