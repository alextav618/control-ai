import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { formatBRL, formatDateBR, localDateString } from "@/lib/format";
import { Trash2, Plus, Pencil, Search, Filter, X, RefreshCw, TrendingUp, TrendingDown, Calculator, ShieldCheck, AlertTriangle, AlertCircle, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
  { value: "credito", label: "Crédito" },
  { value: "saque", label: "Saque" },
  { value: "deposito", label: "Depósito" },
];

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
      const { data, error } = await supabase.from("accounts").select("*").eq("archived", false);
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
    const matchesType = filterType === "all" || t.type === filterType;
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

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto animate-in fade-in duration-300">
      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <h1 className="font-display text-2xl md:text-3xl font-bold">Lançamentos</h1>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-2" />Novo</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Novo lançamento</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Tipo</Label>
                  <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                    <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="expense">Despesa</SelectItem>
                      <SelectItem value="income">Receita</SelectItem>
                      <SelectItem value="transfer">Transferência</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>Data</Label><Input type="date" value={form.occurred_on} onChange={(e) => setForm({ ...form, occurred_on: e.target.value })} className="mt-1.5" /></div>
              </div>
              <div><Label>Descrição</Label><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="mt-1.5" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Valor</Label><Input type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="mt-1.5" /></div>
                {form.type === "expense" && form.payment_method === "credito" && (
                  <div><Label>Parcelas</Label><Input type="number" min={1} value={form.installments} onChange={(e) => setForm({ ...form, installments: e.target.value })} className="mt-1.5" /></div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Conta / Cartão</Label>
                  <Select value={form.account_id} onValueChange={(v) => setForm({ ...form, account_id: v })}>
                    <SelectTrigger className="mt-1.5"><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>
                      {accounts.map((a: any) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Forma de Pagamento</Label>
                  <Select value={form.payment_method} onValueChange={(v) => setForm({ ...form, payment_method: v })}>
                    <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PAYMENT_METHODS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {form.type === "transfer" && (
                <div>
                  <Label>Conta de Destino</Label>
                  <Select value={form.to_account_id} onValueChange={(v) => setForm({ ...form, to_account_id: v })}>
                    <SelectTrigger className="mt-1.5"><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>
                      {accounts.filter(a => a.id !== form.account_id).map((a: any) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <Button onClick={submit} disabled={submitting} className="w-full">{submitting ? "Salvando..." : "Lançar"}</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="rounded-2xl border border-border bg-surface-1 p-4">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Receitas</div>
          <div className="font-mono font-bold text-lg tabular text-income">{formatBRL(summary.income)}</div>
        </div>
        <div className="rounded-2xl border border-border bg-surface-1 p-4">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Despesas</div>
          <div className="font-mono font-bold text-lg tabular text-expense">{formatBRL(summary.expense)}</div>
        </div>
        <div className="rounded-2xl border border-border bg-surface-1 p-4">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Saldo</div>
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