import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeftRight,
  Banknote,
  BarChart3,
  Boxes,
  Calculator,
  CalendarCheck2,
  Cherry,
  CircleDollarSign,
  History,
  type LucideIcon,
  MapPin,
  Menu,
  Network,
  Package,
  Printer,
  Scale,
  Users,
  Wallet,
  Weight,
  X,
} from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import { useSession, useMeQuery, type UserRole } from '@/entities/user';
import { logout } from '@/features/auth';
import { useAppTheme } from '@/shared/lib/theme';
import { persister } from '@/shared/api';
import { Button } from '@/shared/ui/button';
import { Toaster } from '@/shared/ui/sonner';

/** Routes that render bare, without the app chrome. */
const CHROMELESS = ['/login'];

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

// Mirrors the mock's grouped navigation. Items without a `to` are screens the
// migration has not wired yet — shown (for parity) but disabled until they land.
const NAV_GROUPS: NavGroup[] = [
  {
    labelKey: 'nav.group.onPoint',
    items: [
      { labelKey: 'nav.reception', icon: Scale },
      { labelKey: 'nav.crates', icon: Boxes },
      { labelKey: 'nav.day', icon: CalendarCheck2 },
      { labelKey: 'nav.pointCash', icon: Banknote },
      { labelKey: 'nav.prices', icon: CircleDollarSign },
    ],
  },
  {
    labelKey: 'nav.group.peopleMoney',
    items: [
      { labelKey: 'nav.suppliers', icon: Users },
      { labelKey: 'nav.debts', icon: Wallet },
      { labelKey: 'nav.journal', icon: History, role: 'network_owner' },
    ],
  },
  {
    labelKey: 'nav.group.management',
    role: 'network_owner',
    items: [
      { labelKey: 'nav.dashboard', icon: BarChart3, to: '/' },
      { labelKey: 'nav.cost', icon: Calculator },
      { labelKey: 'nav.reweigh', icon: Weight },
      { labelKey: 'nav.network', icon: Network },
      { labelKey: 'nav.sheet', icon: Printer },
      { labelKey: 'nav.transfers', icon: ArrowLeftRight },
      { labelKey: 'nav.points', icon: MapPin, to: '/points' },
      { labelKey: 'nav.refs', icon: Package },
    ],
  },
];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || '?';
}

/**
 * Desktop-first shell in the mock's identity: a dark sidebar (brand + grouped,
 * role-aware nav + signed-in footer) and a top bar (scope + signed-in user).
 * The sidebar collapses into a slide-over below `md`.
 */
export function AppLayout() {
  const { t } = useTranslation();
  const location = useLocation();
  const token = useSession((s) => s.token);
  const setToken = useSession((s) => s.setToken);
  const { data: me } = useMeQuery();
  const [menuOpen, setMenuOpen] = useState(false);

  useAppTheme();

  const bare = CHROMELESS.includes(location.pathname) || token === null;
  if (bare) {
    return (
      <main className="flex min-h-dvh items-center justify-center p-6">
        <Outlet />
        <Toaster />
      </main>
    );
  }

  const role = me?.role;
  const groups = NAV_GROUPS.filter((g) => !g.role || g.role === role).map((g) => ({
    ...g,
    items: g.items.filter((i) => !i.role || i.role === role),
  }));
  const scope = role === 'network_owner' ? t('shell.allPoints') : t('shell.yourPoint');

  const signOut = () => {
    const outgoingToken = token;
    setToken(null);
    try {
      persister.removeClient();
    } catch {
      /* best effort */
    }
    void logout(outgoingToken).catch(() => undefined);
  };

  return (
    <div className="min-h-dvh md:flex">
      {/* Sidebar — dark, mock identity */}
      <nav
        className={cn(
          'fixed inset-y-0 left-0 z-30 flex w-64 shrink-0 flex-col bg-sidebar text-sidebar-foreground transition-transform',
          'md:sticky md:top-0 md:h-dvh md:translate-x-0',
          menuOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex items-center gap-2 px-5 pb-2 pt-5">
          <Cherry size={22} className="shrink-0 text-primary" />
          <div className="min-w-0">
            <div className="font-display text-lg font-semibold leading-tight">
              {t('shell.brand')}
            </div>
            <div className="truncate text-[11px] text-sidebar-foreground/60">
              {scope} · {t('shell.season')}
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-4">
          {groups.map((group) => (
            <div key={group.labelKey} className="mb-5">
              <div className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-sidebar-foreground/45">
                {t(group.labelKey)}
              </div>
              <ul className="flex flex-col gap-0.5">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  if (!item.to) {
                    return (
                      <li key={item.labelKey}>
                        <span
                          className="flex cursor-default items-center gap-2.5 rounded-md px-3 py-2 text-sm text-sidebar-foreground/35"
                          title={t('shell.soon')}
                        >
                          <Icon size={16} className="shrink-0" />
                          <span className="truncate">{t(item.labelKey)}</span>
                        </span>
                      </li>
                    );
                  }
                  return (
                    <li key={item.labelKey}>
                      <NavLink
                        to={item.to}
                        end={item.to === '/'}
                        onClick={() => setMenuOpen(false)}
                        className={({ isActive }) =>
                          cn(
                            'flex items-center gap-2.5 rounded-md border-l-2 px-3 py-2 text-sm transition-colors',
                            isActive
                              ? 'border-primary bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                              : 'border-transparent text-sidebar-foreground/85 hover:bg-sidebar-accent/60',
                          )
                        }
                      >
                        <Icon size={16} className="shrink-0" />
                        <span className="truncate">{t(item.labelKey)}</span>
                      </NavLink>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>

        {me ? (
          <NavLink
            to="/profile"
            onClick={() => setMenuOpen(false)}
            className="flex items-center gap-3 border-t border-sidebar-border px-4 py-3 hover:bg-sidebar-accent/50"
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-sidebar-accent text-xs font-semibold text-sidebar-accent-foreground">
              {initials(me.display_name)}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{me.display_name}</span>
              <span className="block truncate text-[11px] text-sidebar-foreground/55">
                {t(`profile.roles.${me.role}`)}
              </span>
            </span>
          </NavLink>
        ) : null}
      </nav>

      {menuOpen ? (
        <button
          type="button"
          aria-label={t('nav.closeMenu')}
          className="fixed inset-0 z-20 bg-black/40 md:hidden"
          onClick={() => setMenuOpen(false)}
        />
      ) : null}

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b border-border bg-surface px-4">
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            aria-label={menuOpen ? t('nav.closeMenu') : t('nav.openMenu')}
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <X size={18} /> : <Menu size={18} />}
          </Button>

          <span className="rounded-md border border-border px-2.5 py-1 text-sm text-muted-foreground">
            {scope}
          </span>

          <div className="ml-auto flex items-center gap-3">
            {me ? (
              <span className="hidden text-right sm:block">
                <span className="block text-sm font-medium leading-tight">{me.display_name}</span>
                <span className="block text-[11px] text-muted-foreground">
                  {t(`profile.roles.${me.role}`)} · {scope}
                </span>
              </span>
            ) : null}
            <Button variant="ghost" size="sm" onClick={signOut}>
              {t('auth.signOut')}
            </Button>
          </div>
        </header>

        <main className="min-w-0 flex-1 p-6">
          <Outlet />
        </main>
      </div>

      <Toaster />
    </div>
  );
}
