import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Menu, X } from 'lucide-react';
import { cn } from '@/shared/lib/cn';
import { useSession } from '@/entities/user';
import { logout } from '@/features/auth';
import { Button } from '@/shared/ui/button';
import { Toaster } from '@/shared/ui/sonner';

/** Routes that render bare, without the app chrome. */
const CHROMELESS = ['/login', '/register'];

const NAV = [
  { to: '/', labelKey: 'nav.dashboard' },
  { to: '/profile', labelKey: 'nav.profile' },
] as const;

/**
 * Desktop-first shell: a persistent top bar and a sidebar that collapses into
 * a slide-over below `md`. The sidebar is one element in both cases — a single
 * <nav> that changes position, rather than two trees to keep in sync.
 */
export function AppLayout() {
  const { t } = useTranslation();
  const location = useLocation();
  const token = useSession((s) => s.token);
  const setToken = useSession((s) => s.setToken);
  const [menuOpen, setMenuOpen] = useState(false);

  const bare = CHROMELESS.includes(location.pathname) || token === null;

  if (bare) {
    return (
      <main className="flex min-h-dvh items-center justify-center p-6">
        <Outlet />
        <Toaster />
      </main>
    );
  }

  const signOut = () => {
    // Clear locally first: the network call is a courtesy the backend logs,
    // and a failing request must never leave the user stuck signed in.
    setToken(null);
    void logout().catch(() => undefined);
  };

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background px-4">
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          aria-label={menuOpen ? t('nav.closeMenu') : t('nav.openMenu')}
          onClick={() => setMenuOpen((open) => !open)}
        >
          {menuOpen ? <X size={18} /> : <Menu size={18} />}
        </Button>
        <span className="font-semibold">web-starter</span>
        <div className="ml-auto">
          <Button variant="ghost" onClick={signOut}>
            {t('auth.signOut')}
          </Button>
        </div>
      </header>

      <div className="flex">
        <nav
          className={cn(
            'w-56 shrink-0 border-r p-3',
            // Below md the sidebar is an overlay driven by `menuOpen`; from md
            // up it is always in flow and the toggle is hidden.
            // `top-14` only — never `inset-y-14`, which also sets `bottom: 3.5rem`
            // and leaves the mobile drawer 56px short of the viewport floor while
            // making the sticky desktop sidebar stop early on a long page.
            'fixed bottom-0 top-14 left-0 z-20 bg-background transition-transform md:sticky md:bottom-auto md:top-14 md:translate-x-0',
            menuOpen ? 'translate-x-0' : '-translate-x-full',
          )}
        >
          <ul className="flex flex-col gap-1">
            {NAV.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.to === '/'}
                  onClick={() => setMenuOpen(false)}
                  className={({ isActive }) =>
                    cn(
                      'block rounded-md px-3 py-2 text-sm',
                      isActive ? 'bg-accent font-medium' : 'hover:bg-accent/50',
                    )
                  }
                >
                  {t(item.labelKey)}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <main className="min-w-0 flex-1 p-6">
          <Outlet />
        </main>
      </div>

      <Toaster />
    </div>
  );
}
