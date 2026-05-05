import { createFileRoute, Outlet, Link, useNavigate, useLocation } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";
import { Button } from "@/components/ui/button";
import { LayoutDashboard, Wallet, Receipt, LogOut, ListChecks, Tags, TrendingUp, Sun, Moon, CreditCard, Sparkles, User, Target, CalendarRange } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app")({
  component: AppLayout,
});

function AppLayout() {
  const { user, loading, signOut } = useAuth();
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth", search: { mode: "login" } });
  }, [loading, user, navigate]);

  if (loading || !user) {
    return <div className="min-h-screen bg-background" />;
  }

  const nav = [
    { to: "/app/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { to: "/app/transactions", label: "Lançamentos", icon: Receipt },
    { to: "/app/accounts", label: "Contas e Cartões", icon: Wallet },
    { to: "/app/invoices", label: "Faturas", icon: CreditCard },
    { to: "/app/installments", label: "Parcelamentos", icon: CalendarRange },
    { to: "/app/bills", label: "Recorrentes", icon: ListChecks },
    { to: "/app/investments", label: "Investimentos", icon: TrendingUp },
    { to: "/app/goals", label: "Metas", icon: Target },
    { to: "/app/categories", label: "Categorias", icon: Tags },
    { to: "/app/insights", label: "Insights", icon: Sparkles },
    { to: "/app/profiles", label: "Perfil", icon: User },
  ];

  return (
    <div className="min-h-screen flex bg-background">
      {/* SIDEBAR */}
      <aside className="hidden md:flex w-60 flex-col border-r border-border bg-sidebar shrink-0">
        <div className="p-5 border-b border-sidebar-border">
          <Link to="/app" className="flex items-center gap-2 font-display font-bold">
            <span className="h-8 w-8 rounded-lg bg-gradient-primary flex items-center justify-center text-primary-foreground">I</span>
            IControl IA
          </Link>
        </div>
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {nav.map((item) => {
            const active = (item as any).exact
              ? location.pathname === item.to
              : location.pathname.startsWith(item.to);
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                )}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="p-3 border-t border-sidebar-border space-y-1">
          <div className="px-3 py-2 text-xs text-sidebar-foreground/60 truncate">
            {user.email}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start text-sidebar-foreground/70"
            onClick={toggle}
          >
            {theme === "dark" ? <Sun className="h-4 w-4 mr-2" /> : <Moon className="h-4 w-4 mr-2" />}
            {theme === "dark" ? "Tema claro" : "Tema escuro"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start text-sidebar-foreground/70"
            onClick={async () => {
              await signOut();
              navigate({ to: "/" });
            }}
          >
            <LogOut className="h-4 w-4 mr-2" />
            Sair
          </Button>
        </div>
      </aside>

      {/* MOBILE TOP NAV */}
      <div className="md:hidden fixed top-0 inset-x-0 z-20 border-b border-border bg-background/95 backdrop-blur">
        <div className="flex items-center justify-between px-4 py-3">
          <Link to="/app" className="flex items-center gap-2 font-display font-bold text-sm">
            <span className="h-7 w-7 rounded-md bg-gradient-primary flex items-center justify-center text-primary-foreground text-sm">I</span>
            IControl IA
          </Link>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={toggle}>
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
            <Button variant="ghost" size="sm" onClick={async () => { await signOut(); navigate({ to: "/" }); }}>
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div className="flex overflow-x-auto px-2 pb-2 gap-1 scrollbar-none">
          {nav.map((item) => {
            const active = (item as any).exact
              ? location.pathname === item.to
              : location.pathname.startsWith(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "px-3 py-1.5 rounded-md text-xs whitespace-nowrap shrink-0",
                  active ? "bg-accent text-foreground font-medium" : "text-muted-foreground"
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      </div>

      <main className="flex-1 flex flex-col pt-[100px] md:pt-0 min-h-screen min-w-0">
        <Outlet />
      </main>
    </div>
  );
}