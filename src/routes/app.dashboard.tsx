import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { formatBRL, monthNames, localDateString } from "@/lib/format";
import { TrendingUp, TrendingDown, Wallet, AlertCircle, CalendarClock, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ChatPanel } from "@/components/chat/ChatPanel";

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
      
      // FIX: Use localDateString for future limit to avoid -3h shift
      const futureLimitDate = new Date(year, now.getMonth() + 4, 0);
      const futureLimit = localDateString(futureLimitDate);

      const [accR, txR, futureTxR, openInvR, billsR, occR, profileR, invoiceItemsR, initialBalancesR] = await Promise.all([
        supabase.from("accounts").select("*").eq("archived", false),
        supabase.from("transactions").select("*, categories(name, icon, color), accounts(name, type, closing_day, due_day), invoices(id, account_id, reference_month, reference_year)").gte("occurred_on", monthStart).order("occurred_on", { ascending: false }),
        supabase.from("transactions").select("amount, occurred_on, type, installment_plan_id, accounts(type)").gt("occurred_on", localDateString()).lte("occurred_on", futureLimit),
        // Fetch transactions linked to invoices
        supabase.from("invoices").select("*, accounts!inner(name, archived), transactions(amount), invoice_items(amount)").in("status", ["open", "closed"]).eq("accounts.archived", false),
        supabase.from("fixed_bills").select("*").eq("active", true),
        supabase.from("recurring_occurrences").select("*").eq("reference_month", month).eq("reference_year", year),
        supabase.from("profiles").select("*").eq("id", user?.id!).maybeSingle(),
        supabase.from("invoice_items").select("*"),
        supabase.from("invoice_initial_balances").select("*"),
      ]);
      return {
        accounts: accR.data ?? [],
        transactions: txR.data ?? [],
        futureTx: futureTxR.data ?? [],
        openInvoices: openInvR.data ?? [],
        bills: billsR.data ?? [],
        occs: occR.data ?? [],
        profile: profileR.data,
        invoiceItems: invoiceItemsR.data ?? [],
        initialBalances: initialBalancesR.data ?? [],
      };
    },
    enabled: !!user,
  });

  const tx = data?.transactions ?? [];
  const income = tx.filter((t: any) => t.type === "income").reduce((s: number, t: any) => s + Number(t.amount), 0);
  const expense = tx.filter((t: any) => t.type === "expense").reduce((s: number, t: any) => s + Number(t.amount), 0);
  const balance = income - expense;
  const totalCashBalance = (data?.accounts ?? []).filter((a: any) => a.type !== "credit_card").reduce((s: number, a: any) => s + Number(a.current_balance), 0);

  const cardExpense = tx.filter((t: any) => 
    t.type === "expense" && 
    (t.accounts?.type === "credit_card" || t.invoices?.id)
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
  const maxCat = catList[0]?.total ?? 1;

  const paidOccBills = new Set((data?.occs ?? []).filter((o: any) => o.status === "paid").map((o: any) => o.fixed_bill_id));
  const pending = (data?.bills ?? []).filter((b: any) => !paidOccBills.has(b.id));

  // Calculate invoice totals including transactions, items, and initial balances
  const invoiceItemsTotal = (data?.openInvoices ?? []).reduce((sum: number, inv: any) => {
    const txTotal = (inv.transactions || []).reduce((s: number, t: any) => s + Number(t.amount), 0);
    const itemsTotal = (inv.invoice_items || []).reduce((s: number, i: any) => s + Number(i.amount), 0);
    const initialBalance = (data?.initialBalances || []).find((b: any) => b.invoice_id === inv.id)?.initial_balance || 0;
    return sum + txTotal + itemsTotal + initialBalance;
  }, 0);

  // === PROJEÇÃO 3 MESES ===
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
      // FIX: Use reference_month and reference_year from invoice, not due_date
      const invoices = (data.openInvoices as any[])
        .filter((inv) => {
          return inv.reference_month === m && inv.reference_year === y;
        })
        .reduce((s, inv) => {
          const txTotal = (inv.transactions || []).reduce((sum: number, t: any) => sum + Number(t.amount), 0);
          const itemsTotal = (inv.invoice_items || []).reduce((sum: number, i: any) => sum + Number(i.amount), 0);
          const initialBalance = (data?.initialBalances || []).find((b: any) => b.invoice_id === inv.id)?.initial_balance || 0;
          return s + txTotal + itemsTotal + initialBalance;
        }, 0);
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

  const maxProj = Math.max(1, ...projection.map((p) => p.total));

  const now = new Date();
  const monthLabel = `${monthNames[now.getMonth()]} de ${now.getFullYear()}`;

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-6 animate-in fade-in duration-300">
      <div>
        <h1 className="font-display text-2xl md:text-3xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground text-sm mt-1">{monthLabel}</p>
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

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
        <Kpi label="Saldo em conta" value={formatBRL(totalCashBalance)} icon={Wallet} />
        <Kpi label="Receita do mês" value={formatBRL(income)} icon={TrendingUp} accent="income" />
        <Kpi label="Despesa do mês" value={formatBRL(expense)} icon={TrendingDown} accent="expense" />
        <Kpi label="Resultado" value={formatBRL(balance)} accent={balance >= 0 ? "income" : "expense"} />
      </div>

      {/* Despesas por origem */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4">
        <BreakdownCard label="Despesas fixas" value={fixedExpense} total={expense} color="bg-audit-yellow" />
        <BreakdownCard label="Despesas variáveis" value={variableExpense} total={expense} color="bg-primary" />
        <BreakdownCard label="Cartão de crédito" value={cardExpense} total={expense} color="bg-expense" />
      </div>

      {/* PROJEÇÃO 3 MESES */}
      <Card title="Projeção dos próximos meses" icon={CalendarClock}>
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
      </Card>

      <div className="grid md:grid-cols-2 gap-4">
        <Card title="Faturas em aberto">
          {data?.openInvoices.length === 0 && <Empty>Sem faturas em aberto.</Empty>}
          <div className="space-y-2">
            {data?.openInvoices.map((inv: any) => {
              // Use reference_month/year for correct month display
              const due = new Date(inv.due_date + "T12:00:00");
              const days = Math.ceil((due.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
              const urgent = days >= 0 && days <= 5;
              const overdue = days < 0;
              const txTotal = (inv.transactions || []).reduce((s: number, t: any) => s + Number(t.amount), 0);
              const itemsTotal = (inv.invoice_items || []).reduce((s: number, i: any) => s + Number(i.amount), 0);
              const initialBalance = (data?.initialBalances || []).find((b: any) => b.invoice_id === inv.id)?.initial_balance || 0;
              const total = txTotal + itemsTotal + initialBalance;
              return (
                <div key={inv.id} className="flex items-center justify-between p-3 rounded-lg bg-surface-2 border border-border">
                  <div className="min-w-0">
                    <div className="font-medium truncate flex items-center gap-2">
                      {inv.accounts?.name}
                      {overdue && <span className="text-[10px] px-1.5 py-0.5 rounded bg-audit-red/20 text-audit-red">vencida</span>}
                      {urgent && !overdue && <span className="text-[10px] px-1.5 py-0.5 rounded bg-audit-yellow/20 text-audit-yellow">{days}d</span>}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      vence {new Date(inv.due_date + "T12:00:00").toLocaleDateString("pt-BR")}
                    </div>
                  </div>
                  <div className="font-mono tabular font-semibold text-expense whitespace-nowrap">{formatBRL(total)}</div>
                </div>
              );
            })}
          </div>
        </Card>

        <Card title="Recorrentes pendentes">
          {pending.length === 0 && <Empty>Tudo em dia neste mês ✓</Empty>}
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
        </Card>

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
                  <div className="h-full bg-gradient-primary rounded-full transition-all" style={{ width: `${(c.total / maxCat) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {isLoading && <div className="text-center text-sm text-muted-foreground py-4">Carregando…</div>}
    </div>
  );
}

function Kpi({ label, value, icon: Icon, accent }: { label: string; value: string; icon?: any; accent?: "income" | "expense" }) {
  return (
    <div className="rounded-2xl border border-border bg-surface-1 p-4 md:p-5 shadow-card hover:shadow-elegant transition-shadow">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        {Icon && <Icon className="h-4 w-4" />}
      </div>
      <div className={cn("mt-2 font-mono tabular text-xl md:text-2xl font-semibold", accent === "income" && "text-income", accent === "expense" && "text-expense")}>
        {value}
      </div>
    </div>
  );
}

function Card({ title, children, className, icon: Icon }: { title: string; children: React.ReactNode; className?: string; icon?: any }) {
  return (
    <div className={cn("rounded-2xl border border-border bg-surface-1 p-4 md:p-5 shadow-card", className)}>
      <h2 className="font-display font-semibold mb-4 flex items-center gap-2">
        {Icon && <Icon className="h-4 w-4 text-primary" />}
        {title}
      </h2>
      {children}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="text-sm text-muted-foreground py-2">{children}</div>;
}

function BreakdownCard({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const pct = total > 0 ? Math.min(100, (value / total) * 100) : 0;
  return (
    <div className="rounded-2xl border border-border bg-surface-1 p-4 md:p-5 shadow-card hover:shadow-elegant transition-shadow">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="text-xs text-muted-foreground font-mono">{pct.toFixed(0)}%</span>
      </div>
      <div className="mt-2 font-mono tabular text-lg md:text-xl font-semibold">{formatBRL(value)}</div>
      <div className="mt-3 h-1.5 rounded-full bg-surface-2 overflow-hidden">
        <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}