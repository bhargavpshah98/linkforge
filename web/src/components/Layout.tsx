import { BarChart3, Code2, Link2, LogOut, Menu, Moon, Plus, Settings, Sun, X } from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { LinkFormDialog } from "./LinkForm";

export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 font-semibold tracking-tight ${className}`}>
      <img src="/favicon.svg" alt="" width={26} height={26} />
      LinkForge
    </span>
  );
}

function useTheme() {
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    const set = document.documentElement.dataset.theme;
    if (set === "light" || set === "dark") return set;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("lf-theme", theme);
    } catch {
      /* ignore */
    }
  }, [theme]);
  return [theme, () => setTheme((t) => (t === "dark" ? "light" : "dark"))] as const;
}

const NAV = [
  { to: "/app", label: "Overview", icon: BarChart3, end: true },
  { to: "/app/links", label: "Links", icon: Link2 },
  { to: "/app/developers", label: "Developers", icon: Code2 },
  { to: "/app/settings", label: "Settings", icon: Settings },
];

export function AppLayout() {
  const { user, logout } = useAuth();
  const [theme, toggleTheme] = useTheme();
  const [creating, setCreating] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => setDrawer(false), [location.pathname]);

  // "c" opens the create dialog from anywhere (unless typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (e.key === "c" && !e.metaKey && !e.ctrlKey && !["INPUT", "TEXTAREA", "SELECT"].includes(tag)) {
        e.preventDefault();
        setCreating(true);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-4 py-4">
        <Logo />
        <button className="rounded-md p-1 text-muted lg:hidden" onClick={() => setDrawer(false)} aria-label="Close menu">
          <X size={18} />
        </button>
      </div>
      <div className="px-3">
        <button className="btn-primary w-full" onClick={() => setCreating(true)}>
          <Plus size={16} /> Create new
          <kbd className="ml-auto hidden rounded bg-white/20 px-1.5 text-[10px] font-medium lg:inline">C</kbd>
        </button>
      </div>
      <nav className="mt-4 flex-1 space-y-0.5 px-3" aria-label="Main">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium ${isActive ? "bg-accent-soft text-accent" : "text-ink-2 hover:bg-surface-2 hover:text-ink"}`
            }
          >
            <Icon size={17} /> {label}
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-line p-3">
        <div className="flex items-center gap-2 px-1">
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent-soft text-sm font-semibold text-accent">{user?.name?.[0]?.toUpperCase() ?? "?"}</div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{user?.name}</div>
            <div className="truncate text-xs text-muted">{user?.email}</div>
          </div>
          <button className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-ink" onClick={toggleTheme} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}>
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <button className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-ink" onClick={logout} aria-label="Log out">
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 border-r border-line bg-surface lg:block">{sidebar}</aside>
      {drawer && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDrawer(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 border-r border-line bg-surface">{sidebar}</aside>
        </div>
      )}
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-line bg-surface/90 px-4 py-3 backdrop-blur lg:hidden">
        <button className="rounded-md p-1 text-ink-2" onClick={() => setDrawer(true)} aria-label="Open menu">
          <Menu size={20} />
        </button>
        <Logo />
        <button className="rounded-md p-1 text-accent" onClick={() => setCreating(true)} aria-label="Create link">
          <Plus size={20} />
        </button>
      </header>
      <main className="px-4 py-6 lg:ml-60 lg:px-8 lg:py-8">
        <div className="mx-auto max-w-6xl">
          <Outlet />
        </div>
      </main>
      <LinkFormDialog open={creating} onClose={() => setCreating(false)} onSaved={(l) => navigate(`/app/links/${l.id}`)} />
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-2">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
