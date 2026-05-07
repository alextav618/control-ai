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

  // Vinculação manual de dados para o Dashboard
  const tx = useMemo(() => {
    if (!data) return [];
    return data.transactions.map((t: any) => ({
      ...t,
      categories: data.categories.find((c: any) => c.id === t.category_id),
      accounts: data.accounts.find((a: any) => a.id === t.account_id),
    }));
  }, [data]);

  // Filtra transações que NÃO são transferências para os cálculos de Receita/Despesa
  const nonTransferTxs = useMemo(() => tx.filter(t => t.type !== 'transfer'), [tx]);

  const income = nonTransferTxs.filter((t: any) => t.type === "income").reduce((s: number, t: any) => s + Number(t.amount), 0);
  const expense = nonTransferTxs.filter((t: any) => t.type === "expense").reduce((s: number, t: any) => s + Number(t.amount), 0);
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
    // Como não temos join aqui, o total_amount da fatura já deve estar atualizado pelo trigger
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
    t.type === "expense" && 
    (t.accounts?.type === "credit_card" || t.invoice_id)
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
    const months: { label: string; month: number; year: number; recurring: number; installments: number; invoices: number; total: number }[] = [];
    for (let i = 0; i < 3; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const m = d.getMonth() + 1;
      const y = d.getFullYear();
      const recurring = (data.bills as any[]).reduce((s, b) => s + Number(b.expected_amount || 0), 0);
      const installments = (data.futureTx as any[])
        .filter((t) => {
          const td = new Date(t.occurred_on + "T12:00:00");
          return t.type === "expense" && t.installment_plan_id && td.getMonth() + 1 === m && td.getFullYear() === y;
        })
        .reduce((s, t) => s + Number(t.amount), 0);
      const invoices = (data.openInvoices as any[])
        .filter((inv) => inv.reference_month === m && inv.reference_year === y)
        .reduce((s, inv) => s + Number(inv.total_amount || 0), 0);
      
      months.push({
        label: `${monthNames[m - 1]}/${String(y).slice(2)}`,
        month: m,
        year: y,
        recurring,
        installments,
        invoices,
        total: recurring + installments + invoices,
      });
    }
    return months;
  }, [data]);

  const now = new Date();
  const monthLabel = `${monthNames[now.getMonth()]} de ${now.getFullYear()}`;

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
        <p className="text-xs text-muted-foreground mb-4">Soma de recorrentes ativas, parcelas futuras e faturas em aberto.</p>
        <div className="grid grid-cols-3 gap-3">
          {projection.map((p) => (
            <div key={`${p.year}-${p.month}`} className="rounded-xl border border-border bg-surface-2 p-3 md:p-4">
              <div className="text-xs text-muted-foreground capitalize">{p.label}</div>
              <div className="font-mono tabular text-lg md:text-xl font-bold mt-1">{formatBRL(p.total)}</div>
              <div className="mt-3 h-1.5 rounded-full bg-surface-3 overflow-hidden flex">
                <div className="h-full bg-audit-yellow" style={{ width: `${(p.recurring / Math.max(1, p.total)) * 100}%` }} />
                <div className="h-full bg-expense" style={{ width: `${(p.invoices / Math.max(1, p.total)) * 100}%` }} />
                <div className="h-full bg-primary" style={{ width: `${(p.installments / Math.max(1, p.total)) * 100}%` }} />
              </div>
              <div className="mt-2 space-y-0.5 text-[10px] md:text-xs text-muted-foreground">
                <div className="flex justify-between"><span>● Recorrentes</span><span className="font-mono">{formatBRL(p.recurring)}</span></div>
                <div className="flex justify-between"><span>● Faturas</span><span className="font-mono">{formatBRL(p.invoices)}</span></div>
                <div className="flex justify-between"><span>● Parcelas</span><span className="font-mono">{formatBRL(p.installments)}</span></div>
              </div>
            </div>
          ))}
        </div>
      </DashboardCard>

      <div className="grid md:grid-cols-2 gap-6">
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
                    <div className="text-[10px] text-muted-foreground">{formatDateBR(t.occurred_on)} · {t.accounts?.name}</div>
                  </div>
                </div>
                <div className={cn("font-mono tabular text-sm font-semibold", t.type === "income" ? "text-income" : "text-expense")}>
                  {t.type === "income" ? "+" : "-"}{formatBRL(Number(t.amount))}
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

          <DashboardCard title="Recorrentes pendentes">
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
</dyad-file>

<dyad-chat-summary>Excluindo transferências do cálculo de Receita/Despesa no Dashboard</dyad-chat-summary>
A lógica de cálculo de Receita e Despesa no Dashboard foi atualizada para excluir as transações do tipo "transferência", garantindo que apenas receitas e despesas reais sejam consideradas.<dyad-write path="src/routes/app.transactions.tsx" description="Ajustando o cálculo de Receita e Despesa na página de Lançamentos para excluir transferências.">
import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { formatBRL, formatDateBR, localDateString } from "@/lib/format";
import { Trash2, Plus, Pencil, Search, Filter, X, RefreshCw, TrendingUp, TrendingDown, Calculator, ShieldCheck, AlertTriangle, AlertCircle, Info, CreditCard, Wallet, Landmark, Coins, Banknote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/transactions")({
  component: TxPage,
});

const PAYMENT_METHODS = [
  { value: "pix", label: "Pix" },
  { value: "transferencia", label: "Transferência" },
  { value: "boleto", label: "Boleto" },
  { value: "debito", label: "Débito" },
  // { value: "credito", label: "Crédito" }, // Removido para evitar redundância com a aba de cartões
  { value: "dinheiro", label: "Dinheiro" },
  { value: "saque", label: "Saque" },
  { value: "deposito", label: "Depósito" },
];

const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  checking: "C. Corrente",
  savings: "Poupança",
  cash: "Dinheiro",
  credit_card: "Cartão",
  other: "Outro",
};

function todayLocal() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function invoiceWindow(purchase: Date, closingDay: number, dueDay: number) {
  const day = purchase.getDate();
  const month = purchase.getMonth();
  const year = purchase.getFullYear();
  let refMonth = month + 1;
  let refYear = year;
  if (day > closingDay) {
    refMonth += 1;
    if (refMonth > 12) { refMonth = 1; refYear += 1; }
  }
  const closingDate = new Date(refYear, refMonth - 1, Math.min(closingDay, 28));
  let dueYear = refYear;
  let dueMonth = refMonth;
  if (dueDay <= closingDay) { dueMonth += 1; if (dueMonth > 12) { dueMonth = 1; dueYear += 1; } }
  const dueDate = new Date(dueYear, dueMonth - 1, Math.min(dueDay, 28));
  return { referenceMonth: refMonth, referenceYear: refYear, closingDate: localDateString(closingDate), dueDate: localDateString(dueDate) };
}

const recomputeInvoiceTotal = async (invoiceId: string) => {
  const { data: txs } = await supabase.from("transactions").select("amount").eq("invoice_id", invoiceId);
  const txTotal = (txs || []).reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
  const { data: items } = await supabase.from("invoice_items").select("amount").eq("invoice_id", invoiceId);
  const itemsTotal = (items || []).reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const { data: initialBalanceData } = await supabase.from("invoice_initial_balances").select("amount").eq("invoice_id", invoiceId).maybeSingle();
  const total = txTotal + itemsTotal + Number(initialBalanceData?.amount || 0);
  await supabase.from("invoices").update({ total_amount: total }).eq("id", invoiceId);
};

function TxPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState("all");
  const [filterAccount, setFilterAccount] = useState("all");
  const [filterType, setFilterType] = useState("all");
  const [activeFormTab, setActiveFormTab] = useState("common");

  const [form, setForm] = useState({
    type: "expense",
    description: "",
    amount: "",
    occurred_on: todayLocal(),
    account_id: "",
    to_account_id: "",
    category_id: "",
    payment_method: "debito",
    installments: "1",
  });

  const resetForm = () => {
    setForm({ type: "expense", description: "", amount: "", occurred_on: todayLocal(), account_id: "", to_account_id: "", category_id: "", payment_method: "debito", installments: "1" });
    setEditId(null);
    setActiveFormTab("common");
  };

  useEffect(() => { if (!open) resetForm(); }, [open]);

  const { data: rawTx = [], isLoading: txLoading } = useQuery({
    queryKey: ["transactions", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("transactions").select("*").order("occurred_on", { ascending: false }).limit(500);
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const { data: accounts = [] } = useQuery({
    queryKey: ["accounts", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("accounts").select("*").eq("archived", false).order("name");
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user,
  });

  const { data: cats = [] } = useQuery({
    queryKey: ["categories", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("categories").select("*");
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user,
  });

  const tx = useMemo(() => rawTx.map((t: any) => ({
    ...t,
    categories: cats.find((c: any) => c.id === t.category_id),
    accounts: accounts.find((a: any) => a.id === t.account_id),
  })), [rawTx, cats, accounts]);

  const filteredTx = useMemo(() => tx.filter((t: any) => {
    const matchesSearch = (t.description || "").toLowerCase().includes(search.toLowerCase());
    const matchesCategory = filterCategory === "all" || t.category_id === filterCategory;
    const matchesAccount = filterAccount === "all" || t.account_id === filterAccount;
    // Filtra transferências para os cálculos de Receita/Despesa
    const matchesType = filterType === "all" || (filterType === "transfer" ? t.type === "transfer" : t.type !== "transfer" && t.type === filterType);
    return matchesSearch && matchesCategory && matchesAccount && matchesType;
  }), [tx, search, filterCategory, filterAccount, filterType]);

  const summary = useMemo(() => {
    const income = filteredTx.filter(t => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0);
    const expense = filteredTx.filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0);
    return { income, expense, balance: income - expense };
  }, [filteredTx]);

  const groupedTx = useMemo(() => {
    const groups: Record<string, any[]> = {};
    filteredTx.forEach(t => {
      if (!groups[t.occurred_on]) groups[t.occurred_on] = [];
      groups[t.occurred_on].push(t);
    });
    return Object.entries(groups).sort((a, b) => b[0].localeCompare(a[0]));
  }, [filteredTx]);

  const ensureInvoice = async (account: any, purchaseDate: Date) => {
    const w = invoiceWindow(purchaseDate, account.closing_day ?? 1, account.due_day ?? 10);
    const { data: existing } = await supabase.from("invoices").select("*").eq("account_id", account.id).eq("reference_month", w.referenceMonth).eq("reference_year", w.referenceYear).maybeSingle();
    if (existing) return existing;
    const { data: created } = await supabase.from("invoices").insert({ user_id: user!.id, account_id: account.id, reference_month: w.referenceMonth, reference_year: w.referenceYear, closing_date: w.closingDate, due_date: w.dueDate, status: "open", total_amount: 0 }).select().single();
    return created;
  };

  const submit = async () => {
    if (submitting || !user || !form.description || !form.amount || !form.account_id) return;
    setSubmitting(true);
    try {
      const amountNum = Number(form.amount);
      const occurredDate = new Date(form.occurred_on + "T12:00:00");
      const account = accounts.find((a: any) => a.id === form.account_id);
      const isCard = account?.type === "credit_card";

      if (form.type === "transfer") {
        const rows = [
          { user_id: user.id, type: "expense" as const, description: `Transferência: ${form.description}`, amount: amountNum, occurred_on: form.occurred_on, account_id: form.account_id, payment_method: "transferencia", status: "paid" as const, source: "manual" },
          { user_id: user.id, type: "income" as const, description: `Transferência: ${form.description}`, amount: amountNum, occurred_on: form.occurred_on, account_id: form.to_account_id, payment_method: "transferencia", status: "paid" as const, source: "manual" }
        ];
        const { error } = await supabase.from('transactions').insert(rows);
        if (error) throw error;
      } else {
        const installments = Math.max(1, Number(form.installments) || 1);
        const installmentAmount = +(amountNum / installments).toFixed(2);
        let planId: string | null = null;
        if (installments > 1) {
          const { data: plan, error: pErr } = await supabase.from("installment_plans").insert({ user_id: user.id, description: form.description, total_amount: amountNum, installment_amount: installmentAmount, total_installments: installments, account_id: account.id, category_id: form.category_id || null, start_date: form.occurred_on }).select().single();
          if (pErr) throw pErr;
          planId = plan.id;
        }
        const rows: any[] = [];
        for (let i = 0; i < installments; i++) {
          const instDate = new Date(occurredDate.getFullYear(), occurredDate.getMonth() + i, occurredDate.getDate());
          const occurred = localDateString(instDate);
          let invoiceId: string | null = null;
          if (isCard && form.payment_method === "credito") {
            const inv = await ensureInvoice(account, instDate);
            invoiceId = inv?.id ?? null;
          }
          rows.push({ user_id: user.id, type: form.type, description: installments > 1 ? `${form.description} (${i + 1}/${installments})` : form.description, amount: installmentAmount, occurred_on: occurred, account_id: account.id, category_id: form.category_id || null, payment_method: form.payment_method, installment_plan_id: planId, installment_number: installments > 1 ? i + 1 : null, invoice_id: invoiceId, status: "paid", source: "manual" });
        }
        const { error } = await supabase.from('transactions').insert(rows);
        if (error) throw error;
        const invIds = [...new Set(rows.map(r => r.invoice_id).filter(Boolean))];
        for (const id of invIds) await recomputeInvoiceTotal(id);
      }
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    } catch (e: any) { toast.error(e.message); }
    finally { setSubmitting(false); }
  };

  const removeTx = async (id: string) => {
    if (!confirm("Excluir este lançamento?")) return;
    const { error } = await supabase.from("transactions").delete().eq("id", id);
    if (error) toast.error(error.message);
    else {
      toast.success("Excluído");
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    }
  };

  const cashAccounts = accounts.filter(a => a.type !== "credit_card");
  const creditCards = accounts.filter(a => a.type === "credit_card");

  const filteredPaymentMethods = useMemo(() => {
    if (form.type === "transfer") {
      return PAYMENT_METHODS.filter(m => ["pix", "transferencia"].includes(m.value));
    }
    if (form.type === "income") {
      return PAYMENT_METHODS.filter(m => ["pix", "transferencia", "deposito", "dinheiro"].includes(m.value)); // Adicionado Dinheiro para Receita
    }
    // Para despesas, inclui todas as opções, incluindo Dinheiro
    return PAYMENT_METHODS.filter(m => m.value !== "deposito"); // Remove depósito das despesas
  }, [form.type]);

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto animate-in fade-in duration-300">
      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <h1 className="font-display text-2xl md:text-3xl font-bold">Lançamentos</h1>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-2" />Novo</Button></DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Novo lançamento</DialogTitle>
              <DialogDescription>Escolha o tipo de lançamento para continuar.</DialogDescription>
            </DialogHeader>
            
            <Tabs value={activeFormTab} onValueChange={(v) => {
              setActiveFormTab(v);
              if (v === "credit") {
                setForm({ ...form, type: "expense", payment_method: "credito", account_id: creditCards[0]?.id || "" });
              } else {
                setForm({ ...form, payment_method: "debito", account_id: cashAccounts[0]?.id || "" });
              }
            }} className="w-full">
              <TabsList className="grid w-full grid-cols-2 mb-4">
                <TabsTrigger value="common" className="flex items-center gap-2">
                  <Wallet className="h-3.5 w-3.5" /> Geral / Pix
                </TabsTrigger>
                <TabsTrigger value="credit" className="flex items-center gap-2">
                  <CreditCard className="h-3.5 w-3.5" /> Cartão de Crédito
                </TabsTrigger>
              </TabsList>

              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  {activeFormTab === "common" ? (
                    <div>
                      <Label>Tipo</Label>
                      <Select value={form.type} onValueChange={(v) => {
                        const newMethod = v === "income" ? "pix" : "debito";
                        setForm({ ...form, type: v, payment_method: newMethod });
                      }}>
                        <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="expense">Despesa</SelectItem>
                          <SelectItem value="income">Receita</SelectItem>
                          <SelectItem value="transfer">Transferência</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  ) : (
                    <div className="flex flex-col justify-center">
                      <Label className="text-muted-foreground">Tipo</Label>
                      <div className="mt-2 text-sm font-medium text-expense">Despesa no Cartão</div>
                    </div>
                  )}
                  <div><Label>Data</Label><Input type="date" value={form.occurred_on} onChange={(e) => setForm({ ...form, occurred_on: e.target.value })} className="mt-1.5" /></div>
                </div>

                <div><Label>Descrição</Label><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Ex: Almoço, Salário, Transferência..." className="mt-1.5" /></div>
                
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Valor</Label><Input type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="0,00" className="mt-1.5" /></div>
                  {activeFormTab === "credit" && (
                    <div><Label>Parcelas</Label><Input type="number" min={1} value={form.installments} onChange={(e) => setForm({ ...form, installments: e.target.value })} className="mt-1.5" /></div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>{activeFormTab === "credit" ? "Cartão" : "Conta"}</Label>
                    <Select value={form.account_id} onValueChange={(v) => setForm({ ...form, account_id: v })}>
                      <SelectTrigger className="mt-1.5"><SelectValue placeholder="Selecione" /></SelectTrigger>
                      <SelectContent>
                        {(activeFormTab === "credit" ? creditCards : cashAccounts).map((a: any) => (
                          <SelectItem key={a.id} value={a.id}>
                            <div className="flex items-center gap-2">
                              <span>{a.icon || (a.type === 'credit_card' ? "💳" : "🏦")}</span>
                              <span className="truncate">{a.name}</span>
                              <span className="text-[10px] text-muted-foreground shrink-0">({ACCOUNT_TYPE_LABELS[a.type]})</span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Categoria</Label>
                    <Select value={form.category_id} onValueChange={(v) => setForm({ ...form, category_id: v })}>
                      <SelectTrigger className="mt-1.5"><SelectValue placeholder="Selecione" /></SelectTrigger>
                      <SelectContent>
                        {cats.filter(c => c.kind === (form.type === "income" ? "income" : "expense")).map((c: any) => (
                          <SelectItem key={c.id} value={c.id}>{c.icon} {c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {activeFormTab === "common" && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Forma de Pagamento</Label>
                      <Select value={form.payment_method} onValueChange={(v) => setForm({ ...form, payment_method: v })}>
                        <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {filteredPaymentMethods.map((m) => (
                            <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {form.type === "transfer" && (
                      <div>
                        <Label>Conta de Destino</Label>
                        <Select value={form.to_account_id} onValueChange={(v) => setForm({ ...form, to_account_id: v })}>
                          <SelectTrigger className="mt-1.5"><SelectValue placeholder="Selecione" /></SelectTrigger>
                          <SelectContent>
                            {cashAccounts.filter(a => a.id !== form.account_id).map((a: any) => (
                              <SelectItem key={a.id} value={a.id}>
                                <div className="flex items-center gap-2">
                                  <span>{a.icon || "🏦"}</span>
                                  <span className="truncate">{a.name}</span>
                                  <span className="text-[10px] text-muted-foreground shrink-0">({ACCOUNT_TYPE_LABELS[a.type]})</span>
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </div>
                )}
              </div>
              
              <Button onClick={submit} disabled={submitting} className="w-full mt-4">{submitting ? "Salvando..." : "Lançar"}</Button>
            </Tabs>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="rounded-2xl border border-border bg-surface-1 p-4">
          <div className="text-xs text-muted-foreground uppercase tracking-wider">Receitas</div>
          <div className="font-mono font-bold text-lg tabular text-income">{formatBRL(summary.income)}</div>
        </div>
        <div className="rounded-2xl border border-border bg-surface-1 p-4">
          <div className="text-xs text-muted-foreground uppercase tracking-wider">Despesas</div>
          <div className="font-mono font-bold text-lg tabular text-expense">{formatBRL(summary.expense)}</div>
        </div>
        <div className="rounded-2xl border border-border bg-surface-1 p-4">
          <div className="text-xs text-muted-foreground uppercase tracking-wider">Saldo</div>
          <div className="font-mono font-bold text-lg tabular">{formatBRL(summary.balance)}</div>
        </div>
      </div>

      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar lançamentos..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={filterType} onValueChange={setFilterType}>
          <SelectTrigger className="w-[140px]"><SelectValue placeholder="Tipo" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="expense">Despesas</SelectItem>
            <SelectItem value="income">Receitas</SelectItem>
            <SelectItem value="transfer">Transferências</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-8">
        {txLoading ? (
          <div className="text-center py-10 text-muted-foreground">Carregando lançamentos...</div>
        ) : groupedTx.length === 0 ? (
          <div className="text-center py-20 border border-dashed rounded-2xl text-muted-foreground">Nenhum lançamento encontrado.</div>
        ) : (
          groupedTx.map(([date, items]) => (
            <div key={date} className="space-y-2">
              <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-widest px-1">{formatDateBR(date)}</h3>
              <div className="rounded-2xl border border-border bg-surface-1 overflow-hidden divide-y divide-border">
                {items.map((t: any) => (
                  <TxRow key={t.id} t={t} onDelete={() => removeTx(t.id)} />
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function TxRow({ t, onDelete }: { t: any; onDelete: () => void }) {
  return (
    <div className="p-4 flex items-center gap-4 hover:bg-surface-2 transition-colors group">
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <div className="h-9 w-9 rounded-lg bg-surface-3 flex items-center justify-center shrink-0 text-lg">
          {t.categories?.icon || "📦"}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium truncate">{t.description}</span>
            {t.audit_level && <AuditIndicator level={t.audit_level} reason={t.audit_reason} />}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5 flex gap-2 items-center flex-wrap">
            <span>{t.accounts?.name}</span>
            <span>·</span>
            <span className="capitalize">{t.payment_method}</span>
            {t.installment_number && (
              <>
                <span>·</span>
                <span className="text-[10px] px-1 rounded bg-muted">Parc. {t.installment_number}</span>
              </>
            )}
          </div>
        </div>
      </div>
      <div className="text-right shrink-0">
        <div className={cn("font-mono tabular font-semibold", t.type === "income" ? "text-income" : "text-expense")}>
          {t.type === "income" ? "+" : "-"}{formatBRL(Number(t.amount))}
        </div>
        <Button variant="ghost" size="icon" onClick={onDelete} className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity">
          <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
        </Button>
      </div>
    </div>
  );
}

function AuditIndicator({ level, reason }: { level: string; reason?: string }) {
  const meta = {
    green: { icon: ShieldCheck, color: "text-audit-green", bg: "bg-audit-green/10", label: "Saudável" },
    yellow: { icon: AlertTriangle, color: "text-audit-yellow", bg: "bg-audit-yellow/10", label: "Atenção" },
    red: { icon: AlertCircle, color: "text-audit-red", bg: "bg-audit-red/10", label: "Crítico" },
  }[level as "green" | "yellow" | "red"] || { icon: Info, color: "text-muted-foreground", bg: "bg-muted/10", label: "Info" };

  const Icon = meta.icon;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className={cn("h-5 w-5 rounded-full flex items-center justify-center transition-transform hover:scale-110", meta.bg, meta.color)}>
          <Icon className="h-3 w-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3">
        <div className="flex items-center gap-2 mb-2">
          <Icon className={cn("h-4 w-4", meta.color)} />
          <span className="text-xs font-bold uppercase tracking-wider">Auditoria IA: {meta.label}</span>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          {reason || "A IA classificou este lançamento automaticamente com base no seu perfil e histórico."}
        </p>
      </PopoverContent>
    </Popover>
  );
}