import { Suspense, useState, type ReactElement } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Cherry, Menu, PanelLeftClose, PanelLeftOpen, X } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import { initialsOf, useSession, useMeQuery } from '@/entities/user';
import { logout } from '@/features/auth';
import { useAppTheme } from '@/shared/lib/theme';
import { persister } from '@/shared/api';
import { Button } from '@/shared/ui/button';
import { Toaster } from '@/shared/ui/sonner';
import { ThemeToggle } from '@/shared/ui/theme-toggle';
import { HeaderSlotTarget, HeaderSlotsProvider } from '@/shared/ui/header-slot';
import { useHeaderSlotClaimed } from '@/shared/ui/header-slot-context';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/tooltip';
import { RouteFallback } from './RouteFallback';
import { NAV_GROUPS, routeTitleKey } from './nav';
import { ScopeLabel, ShellScope } from './ShellScope';
import { useSidebarCollapsed } from './sidebar-collapsed';

/** Routes that render bare, without the app chrome. */
const CHROMELESS = ['/login'];

/**
 * A folded sidebar item's name, shown beside it on hover and keyboard focus — the label
 * itself stays in the DOM as `md:sr-only`, so the link keeps its accessible name. Only
 * from `md` up: below it the sidebar is the full-width slide-over with its labels.
 */
function RailHint({
  label,
  show,
  children,
}: {
  label: string;
  show: boolean;
  children: ReactElement;
}) {
  if (!show) return children;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right" className="hidden md:block">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Desktop-first shell in the mock's identity: a dark sidebar (brand + grouped,
 * role-aware nav + signed-in footer) and a top bar (scope + signed-in user).
 * The sidebar collapses into a slide-over below `md`; from `md` up it folds
 * down to its icons on demand (`useSidebarCollapsed`). Folded, each label stays
 * in the DOM as `md:sr-only` — the link keeps its accessible name — and comes
 * back on hover as the item's `title`.
 *
 * The top bar is PAPER (`bg-background/85` + blur), exactly as the mock's
 * `Shell.tsx`, not a white surface: the light theme then has two grounds —
 * dark chrome and paper — with white objects (cards, the scope pill) on the
 * paper, instead of a white bar stacked over paper over white cards.
 *
 * The top bar has two places a screen fills itself (`shared/ui/header-slot`, client
 * 24.10): its point select and its one-line title. The provider wraps the whole shell, so
 * a screen inside `<Outlet />` reaches the bar above it.
 */
export function AppLayout() {
  return (
    <HeaderSlotsProvider>
      <AppShell />
    </HeaderSlotsProvider>
  );
}

function AppShell() {
  const { t } = useTranslation();
  const location = useLocation();
  const token = useSession((s) => s.token);
  const setToken = useSession((s) => s.setToken);
  const { data: me } = useMeQuery();
  const [menuOpen, setMenuOpen] = useState(false);
  const [collapsed, toggleCollapsed] = useSidebarCollapsed();
  const titleClaimed = useHeaderSlotClaimed('title');

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
  const isOwner = role === 'network_owner';
  const operatorPointId = role === 'point_operator' ? (me?.collection_point_id ?? null) : null;
  const scope = <ScopeLabel isOwner={isOwner} pointId={operatorPointId} />;
  const titleKey = routeTitleKey(location.pathname);

  // Folded: hidden on screen from `md` up, still read by a screen reader.
  const label = cn('truncate', collapsed && 'md:sr-only');

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
          // The page's focus ring is dark ink; on the dark sidebar it would vanish.
          '[--ring:var(--sidebar-ring)]',
          'md:sticky md:top-0 md:h-dvh md:translate-x-0',
          menuOpen ? 'translate-x-0' : '-translate-x-full',
          collapsed && 'md:w-16',
        )}
      >
        <Link
          to="/"
          className={cn(
            'flex items-center gap-2 px-5 pb-2 pt-5',
            collapsed && 'md:justify-center md:px-0',
          )}
        >
          <Cherry size={22} className="shrink-0 text-brand" />
          <div className={cn('min-w-0', collapsed && 'md:hidden')}>
            <div className="font-display text-lg font-semibold leading-tight">
              {t('shell.brand')}
            </div>
            <div className="truncate text-[11px] text-sidebar-foreground/60">
              {scope} · {t('shell.season')}
            </div>
          </div>
        </Link>

        <div className={cn('flex-1 overflow-y-auto px-3 py-4', collapsed && 'md:px-2')}>
          {groups.map((group) => (
            <div key={group.labelKey} className="mb-5">
              <div
                className={cn(
                  // /60, not /45: 4.65:1 on the sidebar instead of 3.16 (audit 2026-10-24, F11).
                  'px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-sidebar-foreground/60',
                  collapsed && 'md:sr-only',
                )}
              >
                {t(group.labelKey)}
              </div>
              <ul className="flex flex-col gap-0.5">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  if (!item.to) {
                    return (
                      <li key={item.labelKey}>
                        <span
                          className={cn(
                            'flex cursor-default items-center gap-2.5 rounded-md px-3 py-2 text-sm text-sidebar-foreground/35',
                            collapsed && 'md:justify-center md:px-0',
                          )}
                          title={
                            collapsed ? `${t(item.labelKey)} · ${t('shell.soon')}` : t('shell.soon')
                          }
                        >
                          <Icon size={16} className="shrink-0" />
                          <span className={label}>{t(item.labelKey)}</span>
                        </span>
                      </li>
                    );
                  }
                  return (
                    <li key={item.labelKey}>
                      <RailHint label={t(item.labelKey)} show={collapsed}>
                        <NavLink
                          to={item.to}
                          end={item.to === '/'}
                          onClick={() => setMenuOpen(false)}
                          className={({ isActive }) =>
                            cn(
                              'flex items-center gap-2.5 rounded-md border-l-2 px-3 py-2 text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring',
                              collapsed && 'md:justify-center md:px-0',
                              isActive
                                ? 'border-primary bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                                : 'border-transparent text-sidebar-foreground/85 hover:bg-sidebar-accent/60',
                            )
                          }
                        >
                          <Icon size={16} className="shrink-0" />
                          <span className={label}>{t(item.labelKey)}</span>
                        </NavLink>
                      </RailHint>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>

        <RailHint label={t('nav.expandSidebar')} show={collapsed}>
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-expanded={!collapsed}
            className={cn(
              'hidden items-center gap-2.5 border-t border-sidebar-border px-5 py-2.5 text-sm text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground md:flex',
              collapsed && 'md:justify-center md:px-0',
            )}
          >
            {collapsed ? (
              <PanelLeftOpen size={16} className="shrink-0" />
            ) : (
              <PanelLeftClose size={16} className="shrink-0" />
            )}
            <span className={label}>
              {t(collapsed ? 'nav.expandSidebar' : 'nav.collapseSidebar')}
            </span>
          </button>
        </RailHint>

        {me ? (
          <RailHint label={me.display_name} show={collapsed}>
            <NavLink
              to="/profile"
              onClick={() => setMenuOpen(false)}
              className={cn(
                'flex items-center gap-3 border-t border-sidebar-border px-4 py-3 hover:bg-sidebar-accent/50',
                collapsed && 'md:justify-center md:px-0',
              )}
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-sidebar-accent text-xs font-semibold text-sidebar-accent-foreground">
                {initialsOf(me.display_name)}
              </span>
              <span className={cn('min-w-0', collapsed && 'md:sr-only')}>
                <span className="block truncate text-sm font-medium">{me.display_name}</span>
                <span className="block truncate text-[11px] text-sidebar-foreground/60">
                  {t(`profile.roles.${me.role}`)}
                </span>
              </span>
            </NavLink>
          </RailHint>
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
        <header className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b border-border/70 bg-background/85 px-4 backdrop-blur-md">
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            aria-label={menuOpen ? t('nav.closeMenu') : t('nav.openMenu')}
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <X size={18} /> : <Menu size={18} />}
          </Button>

          {/* The phone names the screen it is on (audit 2026-10-24, F4): the sidebar
              that would say so is folded away below `md`. A screen with its own title
              line shows that one from `sm` up instead. */}
          {titleKey ? (
            <span
              className={cn(
                'max-w-[35vw] shrink-0 truncate font-display text-sm font-medium md:hidden',
                titleClaimed && 'sm:hidden',
              )}
            >
              {t(titleKey)}
            </span>
          ) : null}

          {/* The screen's own scope and title line, when it put them here (client,
              24.10); otherwise `ShellScope`'s default — the operator's point chip, and
              nothing for the owner. A select in the bar is the bar's height, whatever
              size its screen asked for. */}
          <div className="flex min-w-0 shrink items-center gap-2 [&_[data-slot=select-field]]:max-w-[40vw] [&_select]:h-8 [&_select]:max-w-[40vw] [&_select]:text-sm">
            <ShellScope pointId={operatorPointId} />
            <HeaderSlotTarget slot="scope" className="flex items-center gap-2 empty:hidden" />
          </div>
          <HeaderSlotTarget
            slot="title"
            // A phone has room for the point select and the account, not a title line.
            className="hidden min-w-0 flex-1 items-center gap-3 empty:hidden sm:flex [&_select]:h-8"
          />

          <div className="ml-auto flex items-center gap-3">
            {me ? (
              <span className="hidden text-right sm:block">
                <span className="block text-sm font-medium leading-tight">{me.display_name}</span>
                <span className="block text-[11px] text-muted-foreground">
                  {t(`profile.roles.${me.role}`)} · {scope}
                </span>
              </span>
            ) : null}
            <ThemeToggle />
            <Button variant="ghost" size="sm" onClick={signOut}>
              {t('auth.signOut')}
            </Button>
          </div>
        </header>

        {/*
          THE APP'S ONE SUSPENSE BOUNDARY, and it is inside the shell on
          purpose. The owner-only routes are React.lazy (see router.tsx), so
          something has to hold the frame while their chunk downloads. Put
          that boundary above this layout — in App.tsx, or around the whole
          <div> below — and the sidebar, the top bar and the active nav item
          all unmount for the duration: the user clicks «Переважування» and
          the application vanishes. Here, only the main column swaps, the
          chrome never re-renders, and the nav item they just clicked stays
          highlighted while its screen arrives.

          ONE boundary, not one per route: a lazy route inherits the nearest
          boundary above it, so every future split lands here for free and
          nobody has to remember to add another.

          The CHROMELESS branch above needs none. Every lazy route is wrapped
          in RequireAuth, which redirects to /login while the token is null —
          and a null token is exactly what puts the layout on that branch —
          so no lazy element is ever rendered there.
        */}
        <main className="min-w-0 flex-1 p-4 sm:p-6">
          <Suspense fallback={<RouteFallback />}>
            <Outlet />
          </Suspense>
        </main>
      </div>

      <Toaster />
    </div>
  );
}
