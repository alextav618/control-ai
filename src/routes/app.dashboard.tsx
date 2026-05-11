import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { formatBRL, monthNames, localDateString, formatDateBR } from "@/lib/format";
import { TrendingUp, TrendingDown, Wallet, AlertCircle, CalendarClock, Sparkles, Landmark, ChevronRight, Receipt, Target, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ChatPanel } from "@/components/chat/ChatPanel";
import SpendingChart from "@/components/dashboard/SpendingChart";
import { KpiCard } from "@/components/dashboard/KpiCard";
import { BreakdownCard } from "@/components/dashboard/BreakdownCard";
import { DashboardCard } from "@/components/dashboard/DashboardCard";
import { Progress } from "@/components/ui/progress";
import { differenceInMonths, startOfMonth } from "date-fns";

export const Route = createFileRoute("/app/dashboard")({
  component: Dashboard,
});

const FREQ_INTERVALS: Record<string, number> = {
  monthly: 1, bimonthly: 2, quarterly: 3, semiannual: 6, annual: 12
};

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
      
      const futureLimitDate = new Date(year, now.getMonth() + 4, 0);
      const futureLimit = localDateString(futureLimitDate);

      const [accR, txR, futureTxR, openInvR, billsR, occR, profileR, initialBalancesR, assetsR, snapsR, movR, auditR, catsR] = await Promise.all([
        supabase.from("accounts").select("*").eq("archived", false),
        supabase.from("transactions").select("*").gte("occurred_on", monthStart).order("occurred_on", { ascending: false }),
        supabase.from("transactions").select("*").gt("occurred_on", localDateString()).lte("occurred_on", futureLimit),
        supabase.from("invoices").select("*").in("status", ["open", "closed"]),
        supabase.from("fixed_bills").select("*").eq("active", true),
        supabase.from("recurring_occurrences").select("*").eq("reference_month", month).eq("reference_year", year),
        supabase.from("profiles").select("*").eq("id", user?.id!).maybeSingle(),
        supabase.from("invoice_initial_balances").select("*"),
        supabase.from("investment_assets").select("*").eq("archived", false),
        supabase.from("investment_snapshots").select("*").order("snapshot_date", { ascending: false }),
        supabase.from("investment_movements").select("*"),
        supabase.from("audit_log").select("level").gte("created_at", monthStart),
        supabase.from("categories").select("*"),
      ]);

      return {
        accounts: accR.data ?? [],
        transactions: txR.data ?? [],
        futureTx: futureTxR.data ?? [],
        openInvoices: openInvR.data ?? [],
        bills: billsR.data ?? [],
        occs: occR.data ?? [],
        profile: profileR.data,
        initialBalances: initialBalancesR.data ?? [],
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
      if (lastSnap) {
        total += Number(lastSnap.market_value);
      } else {
        const movs = data.movements.filter((m: any) => m.asset_id === a.id);
        const net = movs.reduce((s: number, m: any) => {
          if (m.type === "deposit") return s + Number(m.amount);
          if (m.type === "withdrawal") return s - Number(m.amount);
          if (m.type === "interest" || m.type === "dividend") return s + Number(m.amount);
          if (m.type === "fee" || m.type === "tax") return s - Number(m.amount);
          return s;
        }, 0);
        total += net;
      }
    }
    return total;
  }, [data]);

  const totalCardDebt = (data?.openInvoices ?? []).reduce((sum: number, inv: any) => {
    return sum + Number(inv.total_amount || 0);
  }, 0);

  const netWorth = totalCashBalance + portfolioValue - totalCardDebt;

  const auditSummary = useMemo(() => {
    if (!data?.audit) return { green: 0, yellow: 0, red: 0, total: 0 };
    const counts = { green: 0, yellow: 0, red: 0, total: data.audit.length };
    data.audit.forEach((a: any) => {
      if (a.level === 'green') counts.green++;
      else if (a.level === 'yellow') counts.yellow++;
      else if (a.level === 'red') counts.red++;
    });
    return counts;
  }, [data]);

  const cardExpense = tx.filter((t: any) => 
    t.type === "expense" &&     (t.accounts?.type === "credit_card" || t.invoice_id)
  ).reduce((s: number, t: any) => s + Number(t.amount), 0);
  
  const fixedExpense = tx.filter((t: any) => t.type === "expense" && t.fixed_bill_id).reduce((s: number, t: any) => s + Number(t.amount), 0);
  const variableExpense = expense - cardExpense - fixedExpense;

  const byCategory: Record<string, { name: string; icon?: string; total: number }> = {};
  tx.filter((t: any) => t.type === "expense").forEach((t: any) => {
    const k = t.category_id ?? "none";
    const name = t.categories?.name ?? "Sem categoria";
    const icon = t.categories?.icon;
    if (!byCategory[k]) byCategory[k] = { name, icon, total: 0 };
    byCategory[k].total += Number(t.amount);
  });
  const catList = Object.values(byCategory).sort((a, b) => b.total - a.total).slice(0, 6);

  const budget = Number(data?.profile?.monthly_budget || 0);
  const budgetProgress = budget > 0 ? Math.min(100, (expense / budget) * 100) : 0;

  const paidOccBills = new Set((data?.occs ?? []).filter((o: any) => o.status === "paid").map((o: any) => o.fixed_bill_id));
  const pending = (data?.bills ?? []).filter((b: any) => !paidOccBills.has(b.id));

  const projection = useMemo(() => {
    if (!data) return [];
    const now = new Date();
    const months: { label: string; month: number; year: number; fixedExpenses: number; installments: number; invoices: number; total: number }[] = [];
    
    for (let i = 0; i < 3; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const m = d.getMonth() + 1;
      const y = d.getFullYear();
      const targetMonthStart = startOfMonth(d);

      // Despesas Fixas Inteligentes: Filtra por frequência
      const fixedExpenses = (data.bills as any[]).reduce((s, b) => {
        const start = new Date(b.start_date + "T12:00:00");
        const diff = differenceInMonths(targetMonthStart, startOfMonth(start));
        if (diff < 0) return s;
                const interval = FREQ_INTERVALS[b.frequency || "monthly"] || 1;
        if (diff % interval !== 0) return s; // Não cai nesse mês
        
        if (b.total_installments && (diff / interval) >= b.total_installments) return s; // Já acabou
        
        return s + Number(b.expected_amount || 0);
      }, 0);

      // *** ATUALIZAÇÃO: Exclui parcelas do cartão de crédito ***
      const installments = (data.futureTx as any[])
        .filter((t) => {
          const td = new Date(t.occurred_on + "T12:00:00");
          // Mantém apenas despesas que NÃO são de cartão de crédito
          const isCreditCardPayment = t.accounts?.type === "credit_card";
          return t.type === "expense" && t.installment_plan_id && td.getMonth() + 1 === m && td.getFullYear() === y && !isCreditCardPayment;
        })
        .reduce((s, t) => s + Number(t.amount), 0);

      const invoices = (data.openInvoices as any[])
        .filter((inv) => inv.reference_month === m && inv.reference_year === y)
        .reduce((s, inv) => s + Number(inv.total_amount || 0), 0);
      
      months.push({
        label: `${monthNames[m - 1]}/${String(y).slice(2)}`,
        month: m,
        year: y,
        fixedExpenses,
        installments,
        invoices,
        total: fixedExpenses + installments + invoices,
      });
    }
    return months;
  }, [data]);

  const nowRef = new Date();
  const monthLabel = `${monthNames[nowRef.getMonth()]} de ${nowRef.getFullYear()}`;

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-6 animate-in fade-in duration-300">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-2xl md:text-3xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground text-sm mt-1">{monthLabel}</p>
        </div>
        <div className="rounded-2xl border border-border bg-surface-1 px-4 py-2 shadow-card flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
            <Landmark className="h-4 w-4" />
          </div>
          <div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Patrimônio Líquido</div>
            <div className="font-mono font-bold text-lg tabular">{formatBRL(netWorth)}</div>
          </div>
        </div>
      </div>

      {/* Chat trigger */}
      <button
        onClick={() => setChatOpen(true)}
        className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl border border-border bg-surface-1 hover:bg-surface-2 transition-colors text-left group"
      >
        <span className="h-9 w-9 rounded-xl bg-gradient-primary flex items-center justify-center text-primary-foreground shrink-0">
          <Sparkles className="h-4 w-4" />
        </span>
        <span className="flex-1 text-sm text-muted-foreground group-hover:text-foreground transition-colors">
          Peça ao Assistente
        </span>
        <span className="text-xs text-muted-foreground hidden md:inline">IControl IA</span>
      </button>

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

      {/* Audit Health Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="md:col-span-2 rounded-2xl border border-border bg-surface-1 p-4 md:p-5 shadow-card">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Target className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">Orçamento Mensal</span>
            </div>
            <span className="text-xs text-muted-foreground font-mono">
              {formatBRL(expense)} / {formatBRL(budget)}
            </span>
          </div>
          <Progress value={budgetProgress} className="h-2" />
          <div className="mt-2 flex justify-between text-[10px] text-muted-foreground uppercase tracking-wider">
            <span>{budgetProgress.toFixed(0)}% consumido</span>
            <span>{formatBRL(budget - expense)} restante</span>
          </div>
        </div>
                <Link to="/app/audit" className="rounded-2xl border border-border bg-surface-1 p-4 md:p-5 shadow-card hover:bg-surface-2 transition-colors group">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">Saúde da Auditoria</span>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:translate-x-1 transition-transform" />
          </div>
          <div className="flex items-center gap-1.5 h-2 rounded-full bg-surface-2 overflow-hidden">
            <div className="h-full bg-audit-green" style={{ width: `${auditSummary.total > 0 ? (auditSummary.green / auditSummary.total) * 100 : 0}%` }} />
            <div className="h-full bg-audit-yellow" style={{ width: `${auditSummary.total > 0 ? (auditSummary.yellow / auditSummary.total) * 100 : 0}%` }} />
            <div className="h-full bg-audit-red" style={{ width: `${auditSummary.total > 0 ? (auditSummary.red / auditSummary.total) * 100 : 0}%` }} />
          </div>
          <div className="mt-2 flex justify-between text-[10px] text-muted-foreground uppercase tracking-wider">
            <span className="text-audit-green">{auditSummary.green} ok</span>
            <span className="text-audit-yellow">{auditSummary.yellow} atenção</span>
            <span className="text-audit-red">{auditSummary.red} crítico</span>
          </div>
        </Link>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
        <KpiCard label="Saldo em conta" value={formatBRL(totalCashBalance)} icon={Wallet} />
        <KpiCard label="Receita do mês" value={formatBRL(income)} icon={TrendingUp} accent="income" />
        <KpiCard label="Despesa do mês" value={formatBRL(expense)} icon={TrendingDown} accent="expense" />
        <KpiCard label="Resultado" value={formatBRL(balance)} accent={balance >= 0 ? "income" : "expense"} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Chart Section */}
        <DashboardCard title="Gastos por categoria" className="lg:col-span-2">
          <SpendingChart data={catList.map(c => ({ name: c.name, total: c.total }))} />
        </DashboardCard>

        {/* Breakdown Section */}
        <div className="space-y-4">
          <BreakdownCard label="Despesas fixas" value={fixedExpense} total={expense} color="bg-audit-yellow" />
          <BreakdownCard label="Despesas variáveis" value={variableExpense} total={expense} color="bg-primary" />
          <BreakdownCard label="Cartão de crédito" value={cardExpense} total={expense} color="bg-expense" />
        </div>
      </div>

      {/* PROJEÇÃO 3 MESES */}
      <DashboardCard title="Projeção dos próximos meses" icon={CalendarClock}>
        <p className="text-xs text-muted-foreground mb-4">Soma de despesas fixas ativas, parcelas futuras e faturas em aberto.</p>
        <div className="grid grid-cols-3 gap-3">
          {projection.map((p) => (
            <div key={`${p.year}-${p.month}`} className="rounded-xl border border-border bg-surface-2 p-3 md:p-4 flex flex-col">
              <div className="text-xs text-muted-foreground capitalize flex items-center gap-1">
                {p.label}
                {p.month === nowRef.getMonth() + 1 && p.year === nowRef.getFullYear() && (
                  <span className="text-[10px] text-primary"> <u>★</u> </span>
                )}
              </div>
              <div className="font-mono tabular text-lg md:text-xl font-bold mt-1">{formatBRL(p.total)}</div>
              <div className="mt-3 h-1.5 rounded-full bg-surface-3 overflow-hidden flex">
                <div className="h-full bg-audit-yellow" style={{ width: `${(p.fixedExpenses / Math.max(1, p.total)) * 100}%` }} />
                <div className="h-full bg-expense" style={{ width: `${(p.invoices / Math.max(1, p.total)) * 100}%` }} />
                <div className="h-full bg-primary" style={{ width: `${(p.installments / Math.max(1, p.total)) * 100}%` }} />
              </div>
              <div className="mt-2 space-y-0.5 text-[10px] md:text-xs text-muted-foreground">
                <div className="flex justify-between"><span>● Desp. Fixas</span><span className="font-mono">{formatBRL(p.fixedExpenses)}</span></div>
                <div className="flex justify-between"><span>● Faturas</span><span className="font-mono">{formatBRL(p.invoices)}</span></div>
                <div className="flex justify-between"><span>● Parcelas</span><span className="font-mono">{formatBRL(p.installments)}</span></div>
                {/* Tooltip de transparência */}
                <div className="flex items-center gap-1 mt-1">
                  <span className="text-[10px] text-muted-foreground cursor-help" title="Exibe apenas parcelas fora do cartão de crédito para evitar duplicidade">
                    <AlertCircle className="h-3 w-3" />
                  </span>
                  <span className="text-[10px] text-muted-foreground">Parcelas</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Recent Transactions */}
        <DashboardCard title="Últimos lançamentos" icon={Receipt}>
          <div className="space-y-1">
            {tx.slice(0, 5).map((t: any) => (
              <div key={t.id} className="flex items-center justify-between p-3 rounded-xl hover:bg-surface-2 transition-colors">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="h-8 w-8 rounded-lg bg-surface-3 flex items-center justify-center shrink-0 text-lg">
                    {t.type === 'transfer' ? <TrendingUp className="h-4 w-4 text-primary" /> : (t.categories?.icon || "📦")}
                  </div>
                  <div className="min-w-0">
                    <div className="font-medium text-sm truncate">{t.description}</div>
                    <div className="text-[10px] text-muted-foreground">{formatDateBR(t.occurred_on)} · {t.accounts?.name}</div>
                  </div>
                </div>
                <div className={cn(
                  "font-mono tabular text-sm font-semibold", 
                  t.type === 'transfer' ? "text-muted-foreground" : (t.type === "income" ? "text-income" : "text-expense")
                )}>
                  {t.type === 'transfer' ? "" : (t.type === "income" ? "+" : "-")}{formatBRL(Number(t.amount))}
                </div>
              </div>
            ))}
            {tx.length === 0 && <div className="text-sm text-muted-foreground py-4 text-center">Nenhum lançamento este mês.</div>}
            <Link to="/app/transactions" className="flex items-center justify-center gap-2 py-2 mt-2 text-xs text-primary hover:underline">
              Ver todos <ChevronRight className="h-3 w-3" />
            </Link>
          </div>
        </DashboardCard>

        <div className="space-y-6">
          <DashboardCard title="Faturas em aberto">
            {data?.openInvoices.length === 0 && <div className="text-sm text-muted-foreground py-2">Sem faturas em aberto.</div>}
            <div className="space-y-2">
              {data?.openInvoices.map((inv: any) => {
                const due = new Date(inv.due_date + "T12:00:00");
                const days = Math.ceil((due.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
                const urgent = days >= 0 && days <= 5;
                const overdue = days < 0;
                const acc = data.accounts.find((a: any) => a.id === inv.account_id);
                return (
                  <div key={inv.id} className="flex items-center justify-between p-3 rounded-lg bg-surface-2 border border-border">
                    <div className="min-w-0">
                      <div className="font-medium truncate flex items-center gap-2">
                        {acc?.name || "Cartão"}
                        {overdue && <span className="text-[10px] px-1.5 py-0.5 rounded bg-audit-red/20 text-audit-red">vencida</span>}
                        {urgent && !overdue && <span className="text-[10px] px-1.5 py-0.5 rounded bg-audit-yellow/20 text-audit-yellow">{days}d</span>}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        vence {new Date(inv.due_date + "T12:00:00").toLocaleDateString("pt-BR")}
                      </div>
                    </div>
                    <div className="font-mono tabular font-semibold text-expense whitespace-nowrap">{formatBRL(Number(inv.total_amount || 0))}</div>
                  </div>
                );
              })}
            </div>
          </DashboardCard>

          <DashboardCard title="Despesas Fixas pendentes">
            {pending.length === 0 && <div className="text-sm text-muted-foreground py-2">Tudo em dia neste mês ✓</div>}
            <div className="space-y-2">
              {pending.map((b: any) => {
                const today = new Date();
                const dueDate = new Date(today.getFullYear(), today.getMonth(), Math.min(b.due_day, 28));
                const days = Math.ceil((dueDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
                const urgent = days >= 0 && days <= 3;
                const overdue = days < 0;
                return (
                  <div key={b.id} className="flex items-center justify-between p-3 rounded-lg bg-surface-2 border border-border">
                    <div className="flex items-center gap-2 min-w-0">
                      <AlertCircle className={cn("h-4 w-4 shrink-0", overdue ? "text-audit-red" : urgent ? "text-audit-yellow" : "text-muted-foreground")} />
                      <div className="min-w-0">
                        <div className="font-medium truncate">{b.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {overdue ? `atrasada ${Math.abs(days)}d` : days === 0 ? "vence hoje" : `vence em ${days}d`}
                        </div>
                      </div>
                    </div>
                    <div className="font-mono tabular text-muted-foreground whitespace-nowrap">{b.amount_kind === "variable" ? "—" : formatBRL(Number(b.expected_amount))}</div>
                  </div>
                );
              })}
            </div>
          </DashboardCard>
        </div>
      </div>

      {isLoading && <div className="text-center text-sm text-muted-foreground py-4">Carregando…</div>}
    </div>
  );
}