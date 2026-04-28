import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { formatBRL, monthNames } from "@/lib/format";
import { TrendingUp, TrendingDown, Wallet, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/dashboard")({
  component: Dashboard,
});

function Dashboard() {
  const { user } = useAuth();

  const { data } = useQuery({
    queryKey: ["dashboard", user?.id],
    queryFn: async () => {
      const now = new Date();
      const month = now.getMonth() + 1;
      const year = now.getFullYear();
      const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
      const [accR, txR, openInvR, billsR, occR] = await Promise.all([
        supabase.from("accounts").select("*").eq("archived", false),
        supabase.from("transactions").select("*, categories(name, icon, color), accounts(type)").gte("occurred_on", monthStart).order("occurred_on", { ascending: false }),
        supabase.from("invoices").select("*, accounts(name)").eq("status", "open"),
        supabase.from("fixed_bills").select("*").eq("active", true),
        supabase.from("recurring_occurrences").select("*").eq("reference_month", month).eq("reference_year", year),
      ]);
      return {
        accounts: accR.data ?? [],
        transactions: txR.data ?? [],
        openInvoices: openInvR.data ?? [],
        bills: billsR.data ?? [],
        occs: occR.data ?? [],
      };
    },
    enabled: !!user,
  });

  const tx = data?.transactions ?? [];
  const income = tx.filter((t: any) => t.type === "income").reduce((s: number, t: any) => s + Number(t.amount), 0);
  const expense = tx.filter((t: any) => t.type === "expense").reduce((s: number, t: any) => s + Number(t.amount), 0);
  const balance = income - expense;
  const totalCashBalance = (data?.accounts ?? []).filter((a: any) => a.type !== "credit_card").reduce((s: number, a: any) => s + Number(a.current_balance), 0);

  // Despesas separadas por origem
  const cardExpense = tx.filter((t: any) => t.type === "expense" && t.accounts?.type === "credit_card").reduce((s: number, t: any) => s + Number(t.amount), 0);
  const fixedExpense = tx.filter((t: any) => t.type === "expense" && t.fixed_bill_id).reduce((s: number, t: any) => s + Number(t.amount), 0);
  const variableExpense = expense - cardExpense - fixedExpense;

  // Por categoria
  const byCategory: Record<string, { name: string; icon?: string; total: number }> = {};
  tx.filter((t: any) => t.type === "expense").forEach((t: any) => {
    const k = t.category_id ?? "none";
    const name = t.categories?.name ?? "Sem categoria";
    const icon = t.categories?.icon;
    if (!byCategory[k]) byCategory[k] = { name, icon, total: 0 };
    byCategory[k].total += Number(t.amount);
  });
  const catList = Object.values(byCategory).sort((a, b) => b.total - a.total).slice(0, 6);
  const maxCat = catList[0]?.total ?? 1;

  // Pendências do mês — usa ocorrências como fonte de verdade
  const paidOccBills = new Set((data?.occs ?? []).filter((o: any) => o.status === "paid").map((o: any) => o.fixed_bill_id));
  const pending = (data?.bills ?? []).filter((b: any) => !paidOccBills.has(b.id));

  const now = new Date();
  const monthLabel = `${monthNames[now.getMonth()]} de ${now.getFullYear()}`;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground text-sm mt-1">{monthLabel}</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Kpi label="Saldo em conta" value={formatBRL(totalCashBalance)} icon={Wallet} />
        <Kpi label="Receita do mês" value={formatBRL(income)} icon={TrendingUp} accent="income" />
        <Kpi label="Despesa do mês" value={formatBRL(expense)} icon={TrendingDown} accent="expense" />
        <Kpi label="Resultado" value={formatBRL(balance)} accent={balance >= 0 ? "income" : "expense"} />
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {/* Faturas abertas */}
        <Card title="Faturas em aberto">
          {data?.openInvoices.length === 0 && <Empty>Sem faturas em aberto.</Empty>}
          <div className="space-y-2">
            {data?.openInvoices.map((inv: any) => (
              <div key={inv.id} className="flex items-center justify-between p-3 rounded-lg bg-surface-2 border border-border">
                <div>
                  <div className="font-medium">{inv.accounts?.name}</div>
                  <div className="text-xs text-muted-foreground">
                    Fecha {new Date(inv.closing_date).toLocaleDateString("pt-BR")} · vence {new Date(inv.due_date).toLocaleDateString("pt-BR")}
                  </div>
                </div>
                <div className="font-mono tabular font-semibold text-expense">{formatBRL(Number(inv.total_amount))}</div>
              </div>
            ))}
          </div>
        </Card>

        {/* Pendências */}
        <Card title="Contas fixas pendentes">
          {pending.length === 0 && <Empty>Tudo pago neste mês ✓</Empty>}
          <div className="space-y-2">
            {pending.map((b: any) => (
              <div key={b.id} className="flex items-center justify-between p-3 rounded-lg bg-surface-2 border border-border">
                <div className="flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-audit-yellow" />
                  <div>
                    <div className="font-medium">{b.name}</div>
                    <div className="text-xs text-muted-foreground">Vence dia {b.due_day}</div>
                  </div>
                </div>
                <div className="font-mono tabular text-muted-foreground">{formatBRL(Number(b.expected_amount))}</div>
              </div>
            ))}
          </div>
        </Card>

        {/* Por categoria */}
        <Card title="Gastos por categoria" className="md:col-span-2">
          {catList.length === 0 && <Empty>Sem gastos neste mês.</Empty>}
          <div className="space-y-3">
            {catList.map((c) => (
              <div key={c.name}>
                <div className="flex justify-between text-sm mb-1">
                  <span>{c.icon} {c.name}</span>
                  <span className="font-mono tabular">{formatBRL(c.total)}</span>
                </div>
                <div className="h-1.5 rounded-full bg-surface-2 overflow-hidden">
                  <div className="h-full bg-gradient-primary rounded-full" style={{ width: `${(c.total / maxCat) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

function Kpi({ label, value, icon: Icon, accent }: { label: string; value: string; icon?: any; accent?: "income" | "expense" }) {
  return (
    <div className="rounded-2xl border border-border bg-surface-1 p-5 shadow-card">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        {Icon && <Icon className="h-4 w-4" />}
      </div>
      <div className={cn("mt-2 font-mono tabular text-2xl font-semibold", accent === "income" && "text-income", accent === "expense" && "text-expense")}>
        {value}
      </div>
    </div>
  );
}

function Card({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-2xl border border-border bg-surface-1 p-5 shadow-card", className)}>
      <h2 className="font-display font-semibold mb-4">{title}</h2>
      {children}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="text-sm text-muted-foreground py-2">{children}</div>;
}
