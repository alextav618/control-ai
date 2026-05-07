import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { formatBRL, monthNames, localDateString, formatDateBR } from "@/lib/format";
import { TrendingUp, TrendingDown, Wallet, AlertCircle, CalendarClock, Sparkles, Landmark, ChevronRight, Receipt } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ChatPanel } from "@/components/chat/ChatPanel";
import SpendingChart from "@/components/dashboard/SpendingChart";
import { KpiCard } from "@/components/dashboard/KpiCard";
import { BreakdownCard } from "@/components/dashboard/BreakdownCard";
import { DashboardCard } from "@/components/dashboard/DashboardCard";

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

      const [accR, txR, futureTxR, openInvR, billsR, occR, profileR, initialBalancesR, assetsR, snapsR, movR] = await Promise.all([
        supabase.from("accounts").select("*").eq("archived", false),
        supabase.from("transactions").select("*, categories(name, icon, color), accounts(name, type, closing_day, due_day), invoices(id, account_id, reference_month, reference_year), accounts!transactions_account_id_fkey(id, type)").gte("occurred_on", monthStart).order("occurred_on", { ascending: false }),
        supabase.from("transactions").select("amount, occurred_on, type, installment_plan_id, accounts(type)").gt("occurred_on", localDateString()).lte("occurred_on", futureLimit),
        supabase.from("invoices").select("*, accounts!inner(name, archived), transactions(amount), invoice_items(amount)").in("status", ["open", "closed"]).eq("accounts.archived", false),
        supabase.from("fixed_bills").select("*").eq("active", true),
        supabase.from("recurring_occurrences").select("*").eq("reference_month", month).eq("reference_year", year),
        supabase.from("profiles").select("*").eq("id", user?.id!).maybeSingle(),
        supabase.from("invoice_initial_balances").select("*"),
        supabase.from("investment_assets").select("*").eq("archived", false),
        supabase.from("investment_snapshots").select("*").order("snapshot_date", { ascending: false }),
        supabase.from("investment_movements").select("*"),
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
      };
    },
    enabled: !!user,
  });

  const tx = data?.transactions ?? [];
  
  // Filtra transações que NÃO são transferências para calcular receita e despesa
  const nonTransferTransactions = tx.filter(t => t.type !== 'transfer');
  
  const income = nonTransferTransactions.filter((t: any) => t.type === "income").reduce((s: number, t: any) => s + Number(t.amount), 0);
  const expense = nonTransferTransactions.filter((t: any) => t.type === "expense").reduce((s: number, t: any) => s + Number(t.amount), 0);
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
    const txTotal = (inv.transactions || []).reduce((s: number, t: any) => s + Number(t.amount), 0);
    const itemsTotal = (inv.invoice_items || []).reduce((s: number, i: any) => s + Number(i.amount), 0);
    const initialBalance = (data?.initialBalances || []).find((b: any) => b.invoice_id === inv.id)?.initial_balance || 0;
    return sum + txTotal + itemsTotal + initialBalance;
  }, 0);

  const netWorth = totalCashBalance + portfolioValue - totalCardDebt;

  const cardExpense = tx.filter((t: any) => 
    t.type === "expense" && 
    (t.accounts?.type === "credit_card" || t.invoices?.id)
  ).reduce((s: number, t: any) => s + Number(t.amount), 0);
  
  const fixedExpense = tx.filter((t: any) => t.type === "expense" && t.fixed_bill_id).reduce((s: number, t: any) => s + Number(t.amount), 0);
  const variableExpense = expense - cardExpense - fixedExpense;

  const byCategory: Record<string, { name: string; icon?: string; total: number }> = {};
  nonTransferTransactions.filter((t: any) => t.type === "expense").forEach((t: any) => {
    const k = t.category_id ?? "none";
    const name = t.categories?.name ?? "Sem categoria";
    const icon = t.categories?.icon;
    if (!byCategory[k]) byCategory[k] = { name, icon, total: 0 };
    byCategory[k].total += Number(t.amount);
  });
  const catList = Object.values(byCategory).sort((a, b) => b.total - a.total).slice(0, 6);

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
        .reduce((s, inv) => {
          const txTotal = (inv.transactions || []).reduce((sum: number, t: any) => sum + Number(t.amount), 0);
          const itemsTotal = (inv.invoice_items || []).reduce((sum: number, i: any) => s + Number(i.amount), 0);
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

        <DashboardCard title="Faturas em aberto">
          {data?.openInvoices.length === 0 && <div className="text-sm text-muted-foreground py-2">Sem faturas em aberto.</div>}
          <div className="space-y-2">
            {data?.openInvoices.map((inv: any) => {
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

      {isLoading && <div className="text-center text-sm text-muted-foreground py-4">Carregando…</div>}
    </div>
  );
}
</dyad-file>

<dyad-chat-summary>Ajustando cálculo de dashboard para excluir transferências</dyad-chat-summary>
Ajustei o cálculo de receita e despesa no dashboard para que transferências entre contas não sejam mais consideradas, refletindo apenas movimentações externas.<dyad-write path="src/routes/app.transactions.tsx" description="Ajustando o cálculo de receita e despesa para excluir transferências entre contas do mesmo usuário.">
import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { formatBRL, formatDateBR, localDateString } from "@/lib/format";
import { Trash2, Plus, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/transactions")({
  component: TxPage,
});

function todayLocal() {
  return localDateString();
}

/** Calculates the invoice (reference month/year, closing and due dates) for a purchase on a credit card. */
function invoiceWindow(purchase: Date, closingDay: number, dueDay: number) {
  const day = purchase.getDate();
  const month = purchase.getMonth(); // 0-11
  const year = purchase.getFullYear();
  
  // If purchase is after closing, it goes to next invoice
  let refMonth = month + 1; // 1-12
  let refYear = year;
  
  if (day > closingDay) {
    refMonth += 1;
    if (refMonth > 12) { refMonth = 1; refYear += 1; }
  }
  
  // Closing date (in local time)
  const closingDate = new Date(refYear, refMonth - 1, Math.min(closingDay, 28));
  
  // Due date: if due_day < closing_day, it's usually next month
  let dueYear = refYear;
  let dueMonth = refMonth;
  if (dueDay <= closingDay) { 
    dueMonth += 1; 
    if (dueMonth > 12) { dueMonth = 1; dueYear += 1; } 
  }
  const dueDate = new Date(dueYear, dueMonth - 1, Math.min(dueDay, 28));
  
  return {
    referenceMonth: refMonth,
    referenceYear: refYear,
    closingDate: localDateString(closingDate),
    dueDate: localDateString(dueDate),
  };
}

/** Recomputes the total_amount for an invoice by summing all transactions and invoice_items */
const recomputeInvoiceTotal = async (invoiceId: string) => {
  const { data: txs } = await supabase.from("transactions").select("amount").eq("invoice_id", invoiceId);
  const txTotal = (txs || []).reduce((sum, tx) => sum + Number(tx.amount), 0);
  
  const { data: items } = await supabase.from("invoice_items").select("amount").eq("invoice_id", invoiceId);
  const itemsTotal = (items || []).reduce((sum, item) => sum + Number(item.amount), 0);
  
  const total = txTotal + itemsTotal;
  await supabase.from("invoices").update({ total_amount: total }).eq("id", invoiceId);
};

function TxPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({
    type: "expense",
    description: "",
    amount: "",
    occurred_on: todayLocal(),
    account_id: "",
    category_id: "",
    installments: "1",
  });

  const resetForm = () => {
    setForm({ type: "expense", description: "", amount: "", occurred_on: todayLocal(), account_id: "", category_id: "", installments: "1" });
    setEditId(null);
  };

  const openEdit = (t: any) => {
    setEditId(t.id);
    setForm({
      type: t.type,
      description: t.description,
      amount: String(t.amount),
      occurred_on: t.occurred_on,
      account_id: t.account_id ?? "",
      category_id: t.category_id ?? "",
      installments: "1",
    });
    setOpen(true);
  };

  useEffect(() => { if (!open) resetForm(); }, [open]);

  const { data: tx = [] } = useQuery({
    queryKey: ["transactions", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transactions")
        .select("*, accounts(name, type, closing_day, due_day), categories(name, icon), invoices(id, account_id, reference_month, reference_year), accounts!transactions_account_id_fkey(id, type)")
        .order("occurred_on", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const { data: accounts = [] } = useQuery({
    queryKey: ["accounts", user?.id],
    queryFn: async () => {
      const { data } = await supabase.from("accounts").select("*").eq("archived", false);
      return data ?? [];
    },
    enabled: !!user,
  });

  const { data: cats = [] } = useQuery({
    queryKey: ["categories", user?.id, form.type],
    queryFn: async () => {
      const { data } = await supabase.from("categories").select("*");
      return data ?? [];
    },
    enabled: !!user,
  });

  const remove = async (id: string) => {
    const { data: tx } = await supabase.from("transactions").select("invoice_id").eq("id", id).single();
    const invoiceId = tx?.invoice_id;
    
    const { error } = await supabase.from("transactions").delete().eq("id", id);
    if (error) toast.error(error.message);
    else { 
      if (invoiceId) {
        await recomputeInvoiceTotal(invoiceId);
      }
      toast.success("Removido"); 
      qc.invalidateQueries({ queryKey: ["transactions"] }); 
      qc.invalidateQueries({ queryKey: ["dashboard"] }); 
    }
  };

  const ensureInvoice = async (account: any, purchaseDate: Date) => {
    if (!user) return null;
    const w = invoiceWindow(purchaseDate, account.closing_day ?? 1, account.due_day ?? 10);
    const { data: existing } = await supabase
      .from("invoices")
      .select("*")
      .eq("account_id", account.id)
      .eq("reference_month", w.referenceMonth)
      .eq("reference_year", w.referenceYear)
      .maybeSingle();
    if (existing) return existing;
    const { data: created, error } = await supabase.from("invoices").insert({
      user_id: user.id,
      account_id: account.id,
      reference_month: w.referenceMonth,
      reference_year: w.referenceYear,
      closing_date: w.closingDate,
      due_date: w.dueDate,
      status: "open",
      total_amount: 0,
    }).select().single();
    if (error) { toast.error(error.message); return null; }
    return created;
  };

  const submit = async () => {
    if (!user || !form.description || !form.amount || !form.account_id) {
      toast.error("Preencha descrição, valor e conta");
      return;
    }

    if (editId) {
      const { error } = await supabase.from("transactions").update({
        type: form.type as any,
        description: form.description,
        amount: Number(form.amount),
        occurred_on: form.occurred_on,
        account_id: form.account_id,
        category_id: form.category_id || null,
      }).eq("id", editId);
      if (error) { toast.error(error.message); return; }
      toast.success("Lançamento atualizado");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["invoices"] });
      return;
    }

    const account = accounts.find((a: any) => a.id === form.account_id);
    if (!account) return;
    const totalAmount = Number(form.amount);
    const installments = Math.max(1, Number(form.installments) || 1);
    const isCard = account.type === "credit_card";
    const installmentAmount = +(totalAmount / installments).toFixed(2);

    let installmentPlanId: string | null = null;
    if (installments > 1) {
      const { data: plan, error: pErr } = await supabase.from("installment_plans").insert({
        user_id: user.id,
        description: form.description,
        total_amount: totalAmount,
        installment_amount: installmentAmount,
        total_installments: installments,
        account_id: account.id,
        category_id: form.category_id || null,
        start_date: form.occurred_on,
      }).select().single();
      if (pErr) { toast.error(pErr.message); return; }
      installmentPlanId = plan.id;
    }

    const baseDate = new Date(form.occurred_on + "T12:00:00");
    const rows: any[] = [];
    for (let i = 0; i < installments; i++) {
      const d = new Date(baseDate.getFullYear(), baseDate.getMonth() + i, baseDate.getDate());
      let invoiceId: string | null = null;
      if (isCard) {
        const inv = await ensureInvoice(account, d);
        invoiceId = inv?.id ?? null;
      }
      const occurred = localDateString(d);
      rows.push({
        user_id: user.id,
        type: form.type,
        amount: installmentAmount,
        description: installments > 1 ? `${form.description} (${i + 1}/${installments})` : form.description,
        occurred_on: occurred,
        account_id: account.id,
        category_id: form.category_id || null,
        fixed_bill_id: null,
        installment_plan_id: installmentPlanId,
        installment_number: installments > 1 ? i + 1 : null,
        invoice_id: invoiceId,
        status: "paid",
        source: "manual",
      });
    }

    const { error } = await supabase.from("transactions").insert(rows as any);
    if (error) { toast.error(error.message); return; }
    
    const invoiceIds = [...new Set(rows.map(r => r.invoice_id).filter(Boolean))];
    for (const invId of invoiceIds) {
      await recomputeInvoiceTotal(invId);
    }
    
    toast.success(installments > 1 ? `${installments} parcelas lançadas` : "Lançamento criado");
    setOpen(false);
    qc.invalidateQueries({ queryKey: ["transactions"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    qc.invalidateQueries({ queryKey: ["accounts"] });
  };

  const filteredCats = cats.filter((c: any) => c.kind === form.type);
  const selectedAccount = accounts.find((a: any) => a.id === form.account_id);
  const isCardSelected = selectedAccount?.type === "credit_card";

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto animate-in fade-in duration-300">
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-display text-2xl md:text-3xl font-bold">Lançamentos</h1>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-2" />Novo</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>{editId ? "Editar lançamento" : "Novo lançamento"}</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Tipo</Label>
                  <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v, category_id: "" })}>
                    <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="expense">Despesa</SelectItem>
                      <SelectItem value="income">Receita</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Data</Label>
                  <Input type="date" value={form.occurred_on} onChange={(e) => setForm({ ...form, occurred_on: e.target.value })} className="mt-1.5" />
                </div>
              </div>
              <div><Label>Descrição</Label><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Ex: Mercado Pão de Açúcar" className="mt-1.5" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>{editId ? "Valor" : "Valor total"}</Label><Input type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="mt-1.5" /></div>
                {form.type === "expense" && !editId && (
                  <div>
                    <Label>Parcelas</Label>
                    <Input type="number" min={1} max={36} value={form.installments} onChange={(e) => setForm({ ...form, installments: e.target.value })} className="mt-1.5" />
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Conta / Cartão</Label>
                  <Select value={form.account_id} onValueChange={(v) => setForm({ ...form, account_id: v })}>
                    <SelectTrigger className="mt-1.5"><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>
                      {accounts.map((a: any) => <SelectItem key={a.id} value={a.id}>{a.name}{a.type === "credit_card" ? " 💳" : ""}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Categoria</Label>
                  <Select value={form.category_id} onValueChange={(v) => setForm({ ...form, category_id: v })}>
                    <SelectTrigger className="mt-1.5"><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>
                      {filteredCats.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.icon} {c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {!editId && isCardSelected && Number(form.installments) > 1 && (
                <p className="text-xs text-muted-foreground bg-surface-2 p-3 rounded-lg">
                  💳 As parcelas serão distribuídas automaticamente nas próximas {form.installments} faturas, respeitando o fechamento dia {selectedAccount.closing_day}.
                </p>
              )}
              <Button onClick={submit} className="w-full">{editId ? "Salvar alterações" : "Lançar"}</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="rounded-2xl border border-border bg-surface-1 overflow-hidden">
        {tx.length === 0 && <div className="p-8 text-center text-muted-foreground">Nenhum lançamento ainda.</div>}
        <div className="divide-y divide-border">
          {tx.map((t: any) => {
            const dot =
              t.audit_level === "green" ? "bg-audit-green" :
              t.audit_level === "yellow" ? "bg-audit-yellow" :
              t.audit_level === "red" ? "bg-audit-red" : "bg-muted";
            return (
              <div key={t.id} className="p-4 flex items-center gap-4 hover:bg-surface-2 transition-colors">
                <span className={cn("h-2.5 w-2.5 rounded-full shrink-0", dot)} title={t.audit_reason ?? ""} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium truncate">{t.description}</span>
                    {t.installment_number && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-surface-3 text-muted-foreground">parcela {t.installment_number}</span>
                    )}
                    {t.invoices && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-primary/15 text-primary">fatura</span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5 flex gap-2 flex-wrap">
                    <span>{formatDateBR(t.occurred_on)}</span>
                    {t.accounts && <span>· {t.accounts.name}</span>}
                    {t.categories && <span>· {t.categories.icon} {t.categories.name}</span>}
                    {t.invoices && t.invoices.accounts && <span>· {t.invoices.accounts.name}</span>}
                  </div>
                  {t.audit_reason && <div className="text-xs text-muted-foreground/80 mt-1 italic">{t.audit_reason}</div>}
                </div>
                <div className={cn("font-mono tabular font-semibold whitespace-nowrap", t.type === "income" ? "text-income" : "text-expense")}>
                  {t.type === "income" ? "+" : "-"}{formatBRL(Number(t.amount))}
                </div>
                <Button variant="ghost" size="icon" onClick={() => openEdit(t)} title="Editar">
                  <Pencil className="h-4 w-4 text-muted-foreground" />
                </Button>
                <Button variant="ghost" size="icon" onClick={() => remove(t.id)} title="Excluir">
                  <Trash2 className="h-4 w-4 text-muted-foreground" />
                </Button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}