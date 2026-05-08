import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { formatBRL, monthNames, localDateString, formatDateBR } from "@/lib/format";
import { TrendingUp, TrendingDown, Wallet, AlertCircle, CalendarClock, Sparkles, Landmark, ChevronRight, Receipt, Target, ShieldCheck, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ChatPanel } from "@/components/chat/ChatPanel";
import SpendingChart from "@/components/dashboard/SpendingChart";
import { KpiCard } from "@/components/dashboard/KpiCard";
import { BreakdownCard } from "@/components/dashboard/BreakdownCard";
import { DashboardCard } from "@/components/dashboard/DashboardCard";
import { Progress } from "@/components/ui/progress";
import { HealthScore } from "@/components/dashboard/HealthScore";

export const Route = createFileRoute("/app/dashboard")({
  component: Dashboard,
});

function Dashboard() {
  const { user } = useAuth();
  const [chatOpen, setChatOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["dashboard", user?.id],
    queryFn: async () => {
      const now = new Date();
      const month = now.getMonth() + 1;
      const year = now.getFullYear();
      const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
      
      const [accR, txR, openInvR, billsR, profileR, assetsR, snapsR, movR, auditR, catsR] = await Promise.all([
        supabase.from("accounts").select("*").eq("archived", false),
        supabase.from("transactions").select("*").gte("occurred_on", monthStart).order("occurred_on", { ascending: false }),
        supabase.from("invoices").select("*").in("status", ["open", "closed"]),
        supabase.from("fixed_bills").select("*").eq("active", true),
        supabase.from("profiles").select("*").eq("id", user?.id!).maybeSingle(),
        supabase.from("investment_assets").select("*").eq("archived", false),
        supabase.from("investment_snapshots").select("*").order("snapshot_date", { ascending: false }),
        supabase.from("investment_movements").select("*"),
        supabase.from("audit_log").select("*, transactions(description, amount, type)").gte("created_at", monthStart).order("created_at", { ascending: false }).limit(5),
        supabase.from("categories").select("*"),
      ]);

      return {
        accounts: accR.data ?? [],
        transactions: txR.data ?? [],
        openInvoices: openInvR.data ?? [],
        bills: billsR.data ?? [],
        profile: profileR.data,
        assets: assetsR.data ?? [],
        snapshots: snapsR.data ?? [],
        movements: movR.data ?? [],
        audit: auditR.data ?? [],
        categories: catsR.data ?? [],
      };
    },
    enabled: !!user,
  });

  const tx = useMemo(() => {
    if (!data) return [];
    return data.transactions.map((t: any) => ({
      ...t,
      categories: data.categories.find((c: any) => c.id === t.category_id),
      accounts: data.accounts.find((a: any) => a.id === t.account_id),
    }));
  }, [data]);

  const income = tx.filter((t: any) => t.type === "income").reduce((s: number, t: any) => s + Number(t.amount), 0);
  const expense = tx.filter((t: any) => t.type === "expense").reduce((s: number, t: any) => s + Number(t.amount), 0);
  const balance = income - expense;
  
  const cashAccounts = (data?.accounts ?? []).filter((a: any) => a.type !== "credit_card");
  const totalCashBalance = cashAccounts.reduce((s: number, a: any) => s + Number(a.current_balance), 0);

  const portfolioValue = useMemo(() => {
    if (!data) return 0;
    let total = 0;
    for (const a of data.assets) {
      const lastSnap = data.snapshots.find((s: any) => s.asset_id === a.id);
      if (lastSnap) total += Number(lastSnap.market_value);
      else {
        const movs = data.movements.filter((m: any) => m.asset_id === a.id);
        total += movs.reduce((s: number, m: any) => {
          if (m.type === "deposit") return s + Number(m.amount);
          if (m.type === "withdrawal") return s - Number(m.amount);
          return s + Number(m.amount);
        }, 0);
      }
    }
    return total;
  }, [data]);

  const totalCardDebt = (data?.openInvoices ?? []).reduce((sum: number, inv: any) => sum + Number(inv.total_amount || 0), 0);
  const netWorth = totalCashBalance + portfolioValue - totalCardDebt;

  const budget = Number(data?.profile?.monthly_budget || 0);
  const budgetProgress = budget > 0 ? Math.min(100, (expense / budget) * 100) : 0;

  // Cálculo do Health Score
  const healthScore = useMemo(() => {
    if (!data) return 0;
    let score = 100;
    // Penalidade por estourar orçamento
    if (budget > 0 && expense > budget) score -= 30;
    else if (budget > 0 && expense > budget * 0.8) score -= 15;
    
    // Penalidade por auditorias críticas
    const reds = data.audit.filter((a: any) => a.level === 'red').length;
    score -= (reds * 10);
    
    // Bônus por saldo positivo
    if (balance > 0) score += 5;
    
    return Math.max(0, Math.min(100, score));
  }, [data, budget, expense, balance]);

  const healthMeta = {
    label: healthScore >= 80 ? "Finanças Saudáveis" : healthScore >= 50 ? "Atenção Necessária" : "Risco Financeiro",
    description: healthScore >= 80 
      ? "Você está mantendo seus gastos sob controle e seguindo o planejado." 
      : healthScore >= 50 
      ? "Alguns gastos fugiram do padrão. Revise suas categorias dominantes." 
      : "Seu orçamento está seriamente comprometido. Evite novos gastos este mês."
  };

  const catList = useMemo(() => {
    const byCategory: Record<string, { name: string; total: number }> = {};
    tx.filter((t: any) => t.type === "expense").forEach((t: any) => {
      const name = t.categories?.name ?? "Sem categoria";
      if (!byCategory[name]) byCategory[name] = { name, total: 0 };
      byCategory[name].total += Number(t.amount);
    });
    return Object.values(byCategory).sort((a, b) => b.total - a.total).slice(0, 6);
  }, [tx]);

  const now = new Date();
  const monthLabel = `${monthNames[now.getMonth()]} de ${now.getFullYear()}`;

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-6 animate-in fade-in duration-300">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-2xl md:text-3xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground text-sm mt-1">{monthLabel}</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden sm:flex rounded-2xl border border-border bg-surface-1 px-4 py-2 shadow-card items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
              <Landmark className="h-4 w-4" />
            </div>
            <div>
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Patrimônio Líquido</div>
              <div className="font-mono font-bold text-lg tabular">{formatBRL(netWorth)}</div>
            </div>
          </div>
          <button
            onClick={() => setChatOpen(true)}
            className="h-12 w-12 rounded-2xl bg-gradient-primary flex items-center justify-center text-primary-foreground shadow-glow hover:scale-105 transition-transform"
          >
            <Sparkles className="h-5 w-5" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* Health Score & Budget */}
          <div className="grid md:grid-cols-2 gap-4">
            <HealthScore score={healthScore} label={healthMeta.label} description={healthMeta.description} />
            <div className="rounded-2xl border border-border bg-surface-1 p-5 shadow-card">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Target className="h-4 w-4 text-primary" />
                  <span className="text-sm font-medium">Orçamento Mensal</span>
                </div>
                <span className="text-xs text-muted-foreground font-mono">
                  {budgetProgress.toFixed(0)}%
                </span>
              </div>
              <Progress value={budgetProgress} className="h-2" />
              <div className="mt-4 flex justify-between items-end">
                <div>
                  <div className="text-[10px] text-muted-foreground uppercase">Gasto</div>
                  <div className="font-mono font-bold text-lg">{formatBRL(expense)}</div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] text-muted-foreground uppercase">Restante</div>
                  <div className="font-mono font-bold text-lg text-audit-green">{formatBRL(Math.max(0, budget - expense))}</div>
                </div>
              </div>
            </div>
          </div>

          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
            <KpiCard label="Saldo em conta" value={formatBRL(totalCashBalance)} icon={Wallet} />
            <KpiCard label="Receita" value={formatBRL(income)} icon={TrendingUp} accent="income" />
            <KpiCard label="Despesa" value={formatBRL(expense)} icon={TrendingDown} accent="expense" />
            <KpiCard label="Resultado" value={formatBRL(balance)} accent={balance >= 0 ? "income" : "expense"} />
          </div>

          {/* Chart */}
          <DashboardCard title="Gastos por categoria">
            <SpendingChart data={catList} />
          </DashboardCard>
        </div>

        <div className="space-y-6">
          {/* Recent Audit Alerts */}
          <DashboardCard title="Alertas de Auditoria" icon={ShieldCheck}>
            <div className="space-y-3">
              {data?.audit.length === 0 && <div className="text-sm text-muted-foreground py-4 text-center">Nenhum alerta recente.</div>}
              {data?.audit.map((log: any) => (
                <div key={log.id} className="flex items-start gap-3 p-3 rounded-xl bg-surface-2/50 border border-border/50">
                  <div className={cn(
                    "h-2 w-2 rounded-full mt-1.5 shrink-0",
                    log.level === 'green' ? "bg-audit-green" : log.level === 'yellow' ? "bg-audit-yellow" : "bg-audit-red"
                  )} />
                  <div className="min-w-0">
                    <div className="text-xs font-medium line-clamp-2">{log.reasoning}</div>
                    <div className="text-[10px] text-muted-foreground mt-1 flex items-center gap-1">
                      <span className="truncate">{log.transactions?.description}</span>
                      <span>·</span>
                      <span className="font-mono">{formatBRL(log.transactions?.amount)}</span>
                    </div>
                  </div>
                </div>
              ))}
              <Link to="/app/audit" className="flex items-center justify-center gap-2 py-2 mt-2 text-xs text-primary hover:underline">
                Ver auditoria completa <ChevronRight className="h-3 w-3" />
              </Link>
            </div>
          </DashboardCard>

          {/* Recent Transactions */}
          <DashboardCard title="Últimos lançamentos" icon={Receipt}>
            <div className="space-y-1">
              {tx.slice(0, 5).map((t: any) => (
                <div key={t.id} className="flex items-center justify-between p-3 rounded-xl hover:bg-surface-2 transition-colors">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="h-8 w-8 rounded-lg bg-surface-3 flex items-center justify-center shrink-0 text-lg">
                      {t.categories?.icon || "📦"}
                    </div>
                    <div className="min-w-0">
                      <div className="font-medium text-sm truncate">{t.description}</div>
                      <div className="text-[10px] text-muted-foreground">{formatDateBR(t.occurred_on)}</div>
                    </div>
                  </div>
                  <div className={cn("font-mono tabular text-sm font-semibold", t.type === "income" ? "text-income" : "text-expense")}>
                    {t.type === "income" ? "+" : "-"}{formatBRL(Number(t.amount))}
                  </div>
                </div>
              ))}
              <Link to="/app/transactions" className="flex items-center justify-center gap-2 py-2 mt-2 text-xs text-primary hover:underline">
                Ver todos <ChevronRight className="h-3 w-3" />
              </Link>
            </div>
          </DashboardCard>
        </div>
      </div>

      <Dialog open={chatOpen} onOpenChange={setChatOpen}>
        <DialogContent className="max-w-3xl w-[95vw] h-[85vh] p-0 gap-0 flex flex-col overflow-hidden">
          <DialogTitle className="sr-only">Chat IControl IA</DialogTitle>
          <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-surface-1/50">
            <div className="flex items-center gap-2">
              <span className="h-7 w-7 rounded-lg bg-gradient-primary flex items-center justify-center text-primary-foreground">
                <Sparkles className="h-3.5 w-3.5" />
              </span>
              <div>
                <div className="font-display font-semibold text-sm">IControl IA</div>
                <div className="text-[10px] text-muted-foreground">Mande texto, foto ou áudio</div>
              </div>
            </div>
          </div>
          <div className="flex-1 min-h-0">
            <ChatPanel autoFocus={chatOpen} />
          </div>
        </DialogContent>
      </Dialog>

      {isLoading && <div className="text-center text-sm text-muted-foreground py-4">Carregando…</div>}
    </div>
  );
}