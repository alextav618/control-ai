import { createFileRoute } from "@tanstack/react-router";
import { Outlet, createRootRoute, HeadContent, Scripts, Link } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider } from "@/lib/auth";
import { ThemeProvider } from "@/lib/theme";
import appCss from "../src/styles.css?url";
import { BankBalances } from "@/components/ui/BankBalances";
import { TransferForm } from "@/components/ui/TransferForm";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

// ... existing imports and code ...

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } },
  }));
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <Outlet />
          <Toaster richColors position="top-right" />
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

// NEW: Add Transfer link to navigation menu
const navItems = [
  { to: "/app/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/app/transactions", label: "Lançamentos", icon: Receipt },
  { to: "/app/accounts", label: "Contas e Cartões", icon: Wallet },
  { to: "/app/invoices", label: "Faturas", icon: CreditCard },
  { to: "/app/bills", label: "Recorrentes", icon: ListChecks },
  { to: "/app/investments", label: "Investimentos", icon: TrendingUp },
  { to: "/app/categories", label: "Categorias", icon: Tags },
  { to: "/app/insights", label: "Insights", icon: Sparkles },
  { to: "/app/transfers", label: "Transferir", icon: Transfer }, // NEW: Transfer link
  { to: "/app/profiles", label: "Perfil", icon: User },
];

// ... rest of the component unchanged ...

return (
  <div className="min-h-screen flex bg-background">
    {/* SIDEBAR */}
    <aside className="hidden md:flex w-60 flex-col border-r border-border bg-sidebar shrink-0">
      <div className="p-5 border-b border-sidebar-border">
        <Link to="/" className="flex items-center gap-2 font-display font-bold">
          <span className="h-8 w-8 rounded-lg bg-gradient-primary flex items-center justify-center text-primary-foreground">I</span>
          IControl IA        </Link>
      </div>
      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {navItems.map((item) => {
          const active = (item as any).exact            ? location.pathname === item.to
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
              )}>
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      {/* ... rest of sidebar unchanged ... */}
    </aside>

    {/* MOBILE TOP NAV */}
    <div className="md:hidden fixed top-0 inset-x-0 z-20 border-b border-border bg-background/95 backdrop-blur">
      {/* ... existing mobile nav items ... */}
      {/* Add Transfer link to mobile nav */}
      <div className="flex items-center gap-1">
        <Link to="/app/transfers">
          <Button variant="ghost" size="sm">
            <Transfer className="h-4 w-4" />
            Transferir
          </Button>
        </Link>
      </div>
    </div>

    <main className="flex-1 flex flex-col pt-[100px] md:pt-0 min-h-screen min-w-0">
      <Outlet />
    </main>
  </div>
);