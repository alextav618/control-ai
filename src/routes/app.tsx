"use client";

import {
  LayoutDashboard,
  Receipt,
  Wallet,
  CreditCard,
  ListChecks,
  TrendingUp,
  Tags,
  Sparkles,
  ArrowRight,
  User,
} from "lucide-react";

import { BankBalances } from "@/components/ui/BankBalances";
import { TransferForm } from "@/components/ui/TransferForm";
import { useQuery } from "@tanstack/react-query";

const navItems = [
  { to: "/app/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/app/transactions", label: "Lançamentos", icon: Receipt },
  { to: "/app/accounts", label: "Contas e Cartões", icon: Wallet },
  { to: "/app/invoices", label: "Faturas", icon: CreditCard },
  { to: "/app/bills", label: "Recorrentes", icon: ListChecks },
  { to: "/app/investments", label: "Investimentos", icon: TrendingUp },
  { to: "/app/categories", label: "Categorias", icon: Tags },
  { to: "/app/insights", label: "Insights", icon: Sparkles },
  { to: "/app/transfers", label: "Transferir", icon: ArrowRight }, // using ArrowRight as a generic transfer icon
  { to: "/app/profiles", label: "Perfil", icon: User },
];

export default function AppShell() {
  // Example query for bank balances (adjust as needed)
  const { data: bankBalances, isLoading } = useQuery({
    queryKey: ["bank-balances"],
    queryFn: async () => {
      const { data, error } = await supabase.from("vw_bank_balances").select("*");
      if (error) throw error;
      return data;
    },
    staleTime: 60 * 1000,
  });

  return (
    <div className="min-h-screen flex bg-background">
      {/* Sidebar */}
      <aside className="w-64 border-r border-border bg-surface-1 p-4 hidden md:block">
        <nav className="space-y-2">
          {navItems.map((item) => (
            <a
              key={item.to}
              href={item.to}
              className="flex items-center gap-2 p-2 rounded hover:bg-surface-2 transition-colors"
            >
              <item.icon className="h-4 w-4" />
              <span className="font-medium">{item.label}</span>
            </a>
          ))}
        </nav>
      </aside>

      {/* Main content area */}
      <main className="flex-1 overflow-auto p-4">
        {/* Example placeholder content */}
        <h1 className="font-display text-2xl mb-4">Bem‑vindo ao IControl IA</h1>

        {/* Bank balances section (optional) */}
        {isLoading ? (
          <p className="text-muted-foreground">Carregando saldos…</p>
        ) : (
          bankBalances && <BankBalances balances={bankBalances} />
        )}

        {/* Transfer form placeholder */}
        <TransferForm />
      </main>
    </div>
  );
}