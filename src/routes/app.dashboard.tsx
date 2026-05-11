import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { formatBRL, monthNames, localDateString, formatDateBR } from "@/lib/format";
import { TrendingUp, TrendingDown, Wallet, AlertCircle, CalendarClock, Sparkles, Landmark, ChevronRight, Receipt, Target, ShieldCheck, ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ChatPanel } from "@/components/chat/ChatPanel";
import SpendingChart from "@/components/dashboard/SpendingChart";
import { KpiCard } from "@/components/dashboard/KpiCard";
import { BreakdownCard } from "@/components/dashboard/BreakdownCard";
import { DashboardCard } from "@/components/dashboard/DashboardCard";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { differenceInMonths, startOfMonth, format, addMonths } from "date-fns";
import { ptBR } from "date-fns/locale";

export const Route = createFileRoute("/app/dashboard")({
  validateSearch: (search: Record<string, unknown>): { month?: number; year?: number } => {
    const now = new Date(2026, 4, 10); // Ref: Maio 2026
    return {
      month: typeof search.month === "number" ? search.month : now.getMonth() + 1,
      year: typeof search.year === "number" ? search.year : now.getFullYear(),
    };
  },
  component: Dashboard,
});

const FREQ_INTERVALS: Record<string, number> = {
  monthly: 1, bimonthly: 2, quarterly: 3, semiannual: 6, annual: 12
};

function Dashboard() {
  const { user } = useAuth();
  const { month, year } = Route.useSearch();
  const navigate = useNavigate();
  const [chatOpen, setChatOpen] = useState(false);

  const viewDate = useMemo(() => new Date(year!, month! - 1, 10), [month, year]);
  const monthStart = format(startOfMonth(viewDate), "yyyy-MM-dd");
  const monthEnd = format(new Date(year!, month!, 0), "yyyy-MM-dd");

  const { data, isLoading } = useQuery({
    queryKey: ["dashboard", user?.id, month, year],
    queryFn: async () => {
      // 1. Dados em tempo real (Saldos e Patrimônio) - Não filtrados por mês
      const [accR, assetsR, snapsR, movR, profileR] = await Promise.all([
        supabase.from("accounts").select("*").eq("archived", false),
        supabase.from("investment_assets").select("*").eq("archived", false),
        supabase.from("investment_snapshots").select("*").order("snapshot_date", { ascending: false }),
        supabase.from("investment_movements").select("*"),
        supabase.from("profiles").select("*").eq("id", user?.id!).maybeSingle(),
      ]);

      // 2. Dados de Competência (Transações e Faturas do mês selecionado)
      const [txR, invR, billsR, auditR, catsR] = await Promise.all([
        supabase.from("transactions").select("*").gte("occurred_on", monthStart).lte("occurred_on", monthEnd),
        supabase.from("invoices").select("*").in("status", ["open", "closed", "paid"]),
        supabase.from("fixed_bills").select("*").eq("active", true),
        supabase.from("audit_log").select("level").gte("created_at", monthStart).lte("created_at", monthEnd),
        supabase.from("categories").select("*"),
      ]);

      return {
        accounts: accR.data ?? [],
        transactions: txR.data ?? [],
        invoices: invR.data ?? [],
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

  // --- REGRA DE OURO: Saldos reais (Independente do seletor) ---
  const totalCashBalance = useMemo(() => 
    (data?.accounts ?? []).filter((a: any) => a.type !== "credit_card")
    .reduce((s, a) => s + Number(a.current_balance || 0), 0)
  , [data?.accounts]);

  const portfolioValue = useMemo(() => {
    if (!data) return 0;
    let total = 0;
    for (const a of data.assets) {
      const lastSnap = data.snapshots.find((s: any) => s.asset_id === a.id);
      if (lastSnap) total += Number(lastSnap.market_value || 0);
      else {
        const net = data.movements.filter((m: any) => m.asset_id === a.id)
          .reduce((s, m) => {
            const amt = Number(m.amount || 0);
            if (m.type === "deposit" || m.type === "interest" || m.type === "dividend") return s + amt;
            return s - amt;
          }, 0);
        total += net;
      }
    }
    return total;
  }, [data]);

  const currentCardDebt = useMemo(() => 
    (data?.invoices ?? []).filter(i => i.status !== "paid")
    .reduce((s, i) => s + Number(i.total_amount || 0), 0)
  , [data?.invoices]);

  const netWorth = totalCashBalance + portfolioValue - currentCardDebt;

  // --- LÓGICA DE COMPETÊNCIA (Filtrada pelo seletor) ---
  const totals = useMemo(() => {
    if (!data) return { income: 0, expense: 0, fixed: 0, variable: 0, cards: 0 };
    
    // Ignorar transferências (se anulam)
    const validTx = data.transactions.filter(t => t.type !== 'transfer');
    
    const income = validTx.filter(t => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0);
    const expense = validTx.filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0);

    // Despesas Fixas: Transações marcadas como fixas no mês
    const fixed = validTx.filter(t => t.type === 'expense' && t.fixed_bill_id).reduce((s, t) => s + Number(t.amount), 0);

    // Despesas Variáveis: Lançamentos não-fixos que não são de fatura (Débito/Dinheiro)
    const variable = validTx.filter(t => t.type === 'expense' && !t.fixed_bill_id && !t.invoice_id).reduce((s, t) => s + Number(t.amount), 0);

    // Cartão de Crédito: Total das faturas que VENCEM no mês selecionado
    const cards = data.invoices.filter(i => {
      const dueDate = new Date(i.due_date + "T12:00:00");
      return dueDate.getMonth() + 1 === month && dueDate.getFullYear() === year;
    }).reduce((s, i) => s + Number(i.total_amount), 0);

    return { income, expense, fixed, variable, cards, balance: income - expense };
  }, [data, month, year]);

  const catList = useMemo(() => {
    if (!data) return [];
    const byCategory: Record<string, { name: string; total: number }> = {};
    data.transactions.filter(t => t.type === "expense" && t.category_id).forEach(t => {
      const cat = data.categories.find(c => c.id === t.category_id);
      const name = cat?.name || "Outros";
      byCategory[name] = byCategory[name] || { name, total: 0 };
      byCategory[name].total += Number(t.amount);
    });
    return Object.values(byCategory).sort((a, b) => b.total - a.total).slice(0, 6);
  }, [data]);

  const auditSummary = useMemo(() => {
  if (!data?.audit?.length) return { total: 0, green: 0, yellow: 0, red: 0 };
  
  const counts = { 
    total: data.audit.length, 
    green: 0, 
    yellow: 0, 
    red: 0 
  };

  data.audit.forEach((a: any) => {
    const level = a.level as keyof typeof counts;
    if (counts[level] !== undefined) {
      counts[level] = (counts[level] as number) + 1;
    }
  });

  return counts;
}, [data]);

  const handleMonthChange = (offset: number) => {
    const next = addMonths(viewDate, offset);
    navigate({
      to: "/app/dashboard",
      search: { month: next.getMonth() + 1, year: next.getFullYear() }
    });
  };

  if (isLoading) return <div className="p-10 text-center text-muted-foreground">Sincronizando competência...</div>;

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-6 animate-in fade-in duration-300">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center bg-surface-1 border border-border rounded-xl p-1 shadow-card">
            <Button variant="ghost" size="icon" onClick={() => handleMonthChange(-1)} className="h-9 w-9"><ChevronLeft className="h-5 w-5" /></Button>
            <div className="px-4 min-w-[140px] text-center">
              <div className="text-xs text-muted-foreground uppercase font-bold tracking-tighter">{year}</div>
              <div className="font-display font-bold text-sm capitalize">{format(viewDate, "MMMM", { locale: ptBR })}</div>
            </div>
            <Button variant="ghost" size="icon" onClick={() => handleMonthChange(1)} className="h-9 w-9"><ChevronLeft className="h-5 w-5 rotate-180" /></Button>
          </div>
          <div className="hidden sm:block">
            <h1 className="font-display text-xl font-bold">Dashboard</h1>
            <p className="text-[10px] text-muted-foreground uppercase tracking-widest">Resumo da Competência</p>
          </div>
        </div>
        
        <div className="rounded-2xl border border-border bg-surface-1 px-4 py-2 shadow-card flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary"><Landmark className="h-4 w-4" /></div>
          <div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Patrimônio Líquido</div>
            <div className="font-mono font-bold text-lg tabular">{formatBRL(netWorth)}</div>
          </div>
        </div>
      </div>

      <button onClick={() => setChatOpen(true)} className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl border border-border bg-surface-1 hover:bg-surface-2 transition-colors text-left group">
        <span className="h-9 w-9 rounded-xl bg-gradient-primary flex items-center justify-center text-primary-foreground shrink-0"><Sparkles className="h-4 w-4" /></span>
        <span className="flex-1 text-sm text-muted-foreground group-hover:text-foreground transition-colors">Diga o que aconteceu ou peça uma análise...</span>
        <span className="text-xs text-muted-foreground hidden md:inline">IControl IA</span>
      </button>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="md:col-span-2 rounded-2xl border border-border bg-surface-1 p-4 md:p-5 shadow-card">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2"><Target className="h-4 w-4 text-primary" /><span className="text-sm font-medium">Orçamento do Mês</span></div>
            <span className="text-xs text-muted-foreground font-mono">{formatBRL(totals.expense)} / {formatBRL(Number(data?.profile?.monthly_budget || 0))}</span>
          </div>
          <Progress value={data?.profile?.monthly_budget ? Math.min(100, (totals.expense / Number(data.profile.monthly_budget)) * 100) : 0} className="h-2" />
        </div>
        
        <Link to="/app/audit" className="rounded-2xl border border-border bg-surface-1 p-4 md:p-5 shadow-card hover:bg-surface-2 transition-colors group">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-primary" /><span className="text-sm font-medium">Auditoria {monthNames[month! - 1]}</span></div>
            <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:translate-x-1 transition-transform" />
          </div>
          <div className="flex items-center gap-1.5 h-2 rounded-full bg-surface-2 overflow-hidden">
            <div className="h-full bg-audit-green" style={{ width: `${auditSummary.total > 0 ? (auditSummary.green/auditSummary.total)*100 : 0}%` }} />
            <div className="h-full bg-audit-yellow" style={{ width: `${auditSummary.total > 0 ? (auditSummary.yellow/auditSummary.total)*100 : 0}%` }} />
            <div className="h-full bg-audit-red" style={{ width: `${auditSummary.total > 0 ? (auditSummary.red/auditSummary.total)*100 : 0}%` }} />
          </div>
        </Link>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
        <KpiCard label="Saldo Disponível" value={formatBRL(totalCashBalance)} icon={Wallet} />
        <KpiCard label="Receitas do Mês" value={formatBRL(totals.income)} accent="income" />
        <KpiCard label="Despesas do Mês" value={formatBRL(totals.expense)} accent="expense" />
        <KpiCard label="Resultado Líquido" value={formatBRL(totals.balance)} accent={totals.balance >= 0 ? "income" : "expense"} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <DashboardCard title="Gastos por Categoria" className="lg:col-span-2">
          <SpendingChart data={catList} />
        </DashboardCard>

        <div className="space-y-4">
          <BreakdownCard label="Despesas Fixas" value={totals.fixed} total={totals.expense} color="bg-audit-yellow" />
          <BreakdownCard label="Despesas Variáveis" value={totals.variable} total={totals.expense} color="bg-primary" />
          <BreakdownCard label="Faturas do Mês" value={totals.cards} total={totals.expense} color="bg-expense" />
        </div>
      </div>

      <Dialog open={chatOpen} onOpenChange={setChatOpen}>
        <DialogContent className="max-w-3xl w-[95vw] h-[85vh] p-0 gap-0 flex flex-col overflow-hidden">
          <DialogTitle className="sr-only">Chat IControl IA</DialogTitle>
          <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-surface-1/50">
            <div className="flex items-center gap-2">
              <span className="h-7 w-7 rounded-lg bg-gradient-primary flex items-center justify-center text-primary-foreground"><Sparkles className="h-3.5 w-3.5" /></span>
              <div><div className="font-display font-semibold text-sm">IControl IA</div><div className="text-[10px] text-muted-foreground">Mande texto, foto ou áudio</div></div>
            </div>
          </div>
          <div className="flex-1 min-h-0"><ChatPanel autoFocus={chatOpen} /></div>
        </DialogContent>
      </Dialog>
    </div>
  );
}