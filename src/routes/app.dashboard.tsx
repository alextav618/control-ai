import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { formatBRL } from "@/lib/format";
import { BankBalances } from "@/components/ui/BankBalances";

export const Route = createFileRoute("/app/dashboard")({ component: Dashboard });

function Dashboard() {
  // ... existing imports and code ...

  // NEW: fetch bank balances from view
  const { data: bankBalances, isLoading: balancesLoading } = useQuery({
    queryKey: ["bank-balances"],
    queryFn: async () => {
      const { data, error } = await supabase.from("vw_bank_balances").select("*");
      if (error) throw error;
      return data as Array<{
        bank_name: string;
        bank_id: string;
        balance: number;
      }>;
    },
    staleTime: 60 * 1000,
  });

  // ... existing Dashboard code ...

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-6 animate-in fade-in duration-300">
      {/* ... existing header, hero, features ... */}

      {/* NEW: Bank Balances Section */}
      <div>
        <h1 className="font-display text-2xl md:text-3xl font-bold">
          <span className="h-6 w-6 rounded-full bg-gradient-primary flex items-center justify-center text-primary-foreground">🏦</span>
          Saldo dos Bancos
        </h1>
        {balancesLoading ? (
          <div className="text-center py-8 text-sm text-muted-foreground">Carregando saldos…</div>
        ) : (
          <BankBalances balances={bankBalances} />
        )}
      </div>

      {/* ... existing KPIs, breakdown, projection, etc. ... */}
    </div>
  );
}