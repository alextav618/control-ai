import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { formatBRL, formatDateBR, localDateString } from "@/lib/format";
import { Trash2, Plus, Pencil, Search, Filter, X, RefreshCw } from "lucide-react";
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
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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

const recomputeInvoiceTotal = async (invoiceId: string) => {
  const { data: txs } = await supabase.from("transactions").select("amount").eq("invoice_id", invoiceId);
  const txTotal = (txs || []).reduce((sum, tx) => sum + Number(tx.amount), 0);
  const { data: items } = await supabase.from("invoice_items").select("amount").eq("invoice_id", invoiceId);
  const itemsTotal = (items || []).reduce((sum, item) => sum + Number(item.amount), 0);
  const { data: initialBalanceData } = await supabase.from("invoice_initial_balances").select("amount").eq("invoice_id", invoiceId).maybeSingle();
  const initialBalance = Number(initialBalanceData?.amount || 0);
  const total = txTotal + itemsTotal + initialBalance;
  await supabase.from("invoices").update({ total_amount: total }).eq("id", invoiceId);
};

function TxPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  
  // Filters
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
    installments: "1",
  });

  const resetForm = () => {
    setForm({ type: "expense", description: "", amount: "", occurred_on: todayLocal(), account_id: "", to_account_id: "", category_id: "", installments: "1" });
    setEditId(null);
  };

  const openEdit = (t: any) => {
    setEditId(t.id);
    setForm({
      type: t.type,
      description: t.description || "",
      amount: String(t.amount),
      occurred_on: t.occurred_on,
      account_id: t.account_id ?? "",
      to_account_id: "",
      category_id: t.category_id ?? "",
      installments: "1",
    });
    setOpen(true);
  };

  useEffect(() => { if (!open) resetForm(); }, [open]);

  const { data: tx = [], isLoading: txLoading, error: txError, refetch } = useQuery({
    queryKey: ["transactions", user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await supabase
        .from("transactions")
        .select(`
          *,
          categories(name, icon, color),
          accounts(name, type, closing_day, due_day, archived),
          invoices(id, account_id, reference_month, reference_year)
        `)
        .order("occurred_on", { ascending: false })
        .limit(500);
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const { data: accounts = [] } = useQuery({
    queryKey: ["accounts", user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await supabase.from("accounts").select("*").eq("archived", false);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user,
  });

  const { data: cats = [] } = useQuery({
    queryKey: ["categories", user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await supabase.from("categories").select("*");
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user,
  });

  const filteredTx = useMemo(() => {
    return tx.filter((t: any) => {
      const desc = (t.description || "").toLowerCase();
      const matchesSearch = desc.includes(search.toLowerCase());
      const matchesCategory = filterCategory === "all" || t.category_id === filterCategory;
      const matchesAccount = filterAccount === "all" || t.account_id === filterAccount;
      const matchesType = filterType === "all" || t.type === filterType;
      return matchesSearch && matchesCategory && matchesAccount && matchesType;
    });
  }, [tx, search, filterCategory, filterAccount, filterType]);

  const clearFilters = () => {
    setSearch("");
    setFilterCategory("all");
    setFilterAccount("all");
    setFilterType("all");
  };

  const remove = async (id: string) => {
    if (!confirm("Excluir este lançamento?")) return;
    const { data: txData } = await supabase.from("transactions").select("invoice_id").eq("id", id).single();
    const invoiceId = txData?.invoice_id;
    const { error } = await supabase.from("transactions").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    if (invoiceId) await recomputeInvoiceTotal(invoiceId);
    toast.success("Removido"); 
    qc.invalidateQueries({ queryKey: ["transactions"] }); 
    qc.invalidateQueries({ queryKey: ["dashboard"] }); 
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
    const { data: created } = await supabase.from("invoices").insert({
      user_id: user.id,
      account_id: account.id,
      reference_month: w.referenceMonth,
      reference_year: w.referenceYear,
      closing_date: w.closingDate,
      due_date: w.dueDate,
      status: "open",
      total_amount: 0,
    }).select().single();
    return created;
  };

  const submit = async () => {
    if (submitting) return;
    if (!user || !form.description || !form.amount || !form.account_id) {
      toast.error("Preencha descrição, valor e conta");
      return;
    }
    const amountNum = Number(form.amount);
    setSubmitting(true);
    try {
      const occurredDate = new Date(form.occurred_on + "T12:00:00"); 
      if (editId) {
        const { error } = await supabase.from("transactions").update({
          type: form.type as any,
          description: form.description,
          amount: amountNum,
          occurred_on: form.occurred_on,
          account_id: form.account_id,
          category_id: form.category_id || null,
        }).eq("id", editId);
        if (error) throw error;
        toast.success("Lançamento atualizado");
        setOpen(false);
        qc.invalidateQueries({ queryKey: ["transactions"] });
        return;
      }
      const account = accounts.find((a: any) => a.id === form.account_id);
      const isCard = account?.type === "credit_card";
      if (form.type === "transfer") {
        const rows = [
          { user_id: user.id, type: "expense" as const, description: `Transferência: ${form.description}`, amount: amountNum, occurred_on: form.occurred_on, account_id: form.account_id, category_id: form.category_id || null, status: "paid" as const, source: "manual" },
          { user_id: user.id, type: "income" as const, description: `Transferência: ${form.description}`, amount: amountNum, occurred_on: form.occurred_on, account_id: form.to_account_id, category_id: form.category_id || null, status: "paid" as const, source: "manual" }
        ];
        const { error } = await supabase.from('transactions').insert(rows);
        if (error) throw error;
        toast.success("Transferência realizada");
      } else {
        const installments = Math.max(1, Number(form.installments) || 1);
        const installmentAmount = +(amountNum / installments).toFixed(2);
        let installmentPlanId: string | null = null;
        if (installments > 1) {
          const { data: plan, error: pErr } = await supabase.from("installment_plans").insert({
            user_id: user.id, description: form.description, total_amount: amountNum, installment_amount: installmentAmount, total_installments: installments, account_id: account.id, category_id: form.category_id || null, start_date: form.occurred_on,
          }).select().single();
          if (pErr) throw pErr;
          installmentPlanId = plan.id;
        }
        const rows: any[] = [];
        for (let i = 0; i < installments; i++) {
          const installmentDate = new Date(occurredDate.getFullYear(), occurredDate.getMonth() + i, occurredDate.getDate());
          const occurred = localDateString(installmentDate); 
          let invoiceId: string | null = null;
          if (isCard) {
            const inv = await ensureInvoice(account, installmentDate);
            invoiceId = inv?.id ?? null;
          }
          rows.push({
            user_id: user.id, type: form.type, description: installments > 1 ? `${form.description} (${i + 1}/${installments})` : form.description, amount: installmentAmount, occurred_on: occurred, account_id: account.id, category_id: form.category_id || null, installment_plan_id: installmentPlanId, installment_number: installments > 1 ? i + 1 : null, invoice_id: invoiceId, status: "paid", source: "manual",
          });
        }
        const { error } = await supabase.from('transactions').insert(rows);
        if (error) throw error;
        const invoiceIds = [...new Set(rows.map(r => r.invoice_id).filter(Boolean))];
        for (const invId of invoiceIds) await recomputeInvoiceTotal(invId);
        toast.success(installments > 1 ? `${installments} parcelas lançadas` : "Lançamento criado");
      }
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["accounts"] });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const hasFilters = search || filterCategory !== "all" || filterAccount !== "all" || filterType !== "all";

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto animate-in fade-in duration-300">
      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <h1 className="font-display text-2xl md:text-3xl font-bold">Lançamentos</h1>
          <Button variant="ghost" size="icon" onClick={() => refetch()} title="Atualizar"><RefreshCw className={cn("h-4 w-4", txLoading && "animate-spin")} /></Button>
        </div>
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
                      <SelectItem value="transfer">Transferência</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Data</Label>
                  <Input type="date" value={form.occurred_on} onChange={(e) => setForm({ ...form, occurred_on: e.target.value })} className="mt-1.5" />
                </div>
              </div>
              <div><Label>Descrição</Label><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Ex: Salário Mensal" className="mt-1.5" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>{editId ? "Valor" : "Valor total"}</Label><Input type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="mt-1.5" /></div>
                {!editId && form.type === "expense" && (
                  <div>
                    <Label>Parcelas</Label>
                    <Input type="number" min={1} max={36} value={form.installments} onChange={(e) => setForm({ ...form, installments: e.target.value })} className="mt-1.5" />
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>{form.type === "transfer" ? "Conta de Origem" : "Conta / Cartão"}</Label>
                  <Select value={form.account_id} onValueChange={(v) => setForm({ ...form, account_id: v })}>
                    <SelectTrigger className="mt-1.5"><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>
                      {accounts.map((a: any) => <SelectItem key={a.id} value={a.id}>{a.name}{a.type === "credit_card" ? " 💳" : ""}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                {form.type === "transfer" ? (
                  <div>
                    <Label>Conta de Destino</Label>
                    <Select value={form.to_account_id} onValueChange={(v) => setForm({ ...form, to_account_id: v })}>
                      <SelectTrigger className="mt-1.5"><SelectValue placeholder="Selecione" /></SelectTrigger>
                      <SelectContent>
                        {accounts.filter(a => a.id !== form.account_id).map((a: any) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                ) : (
                  <div>
                    <Label>Categoria</Label>
                    <Select value={form.category_id} onValueChange={(v) => setForm({ ...form, category_id: v })}>
                      <SelectTrigger className="mt-1.5"><SelectValue placeholder="—" /></SelectTrigger>
                      <SelectContent>
                        {cats.filter((c: any) => c.kind === form.type).map((c: any) => <SelectItem key={c.id} value={c.id}>{c.icon} {c.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
              <Button onClick={submit} disabled={submitting} className="w-full">{submitting ? "Salvando..." : (editId ? "Salvar alterações" : "Lançar")}</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* FILTERS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar descrição..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
          {search && <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2"><X className="h-3 w-3 text-muted-foreground" /></button>}
        </div>
        <Select value={filterType} onValueChange={setFilterType}>
          <SelectTrigger><div className="flex items-center gap-2"><Filter className="h-3.5 w-3.5 text-muted-foreground" /><SelectValue placeholder="Tipo" /></div></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os tipos</SelectItem>
            <SelectItem value="expense">Despesas</SelectItem>
            <SelectItem value="income">Receitas</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterCategory} onValueChange={setFilterCategory}>
          <SelectTrigger><div className="flex items-center gap-2"><Filter className="h-3.5 w-3.5 text-muted-foreground" /><SelectValue placeholder="Categoria" /></div></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas categorias</SelectItem>
            {cats.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.icon} {c.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterAccount} onValueChange={setFilterAccount}>
          <SelectTrigger><div className="flex items-center gap-2"><Filter className="h-3.5 w-3.5 text-muted-foreground" /><SelectValue placeholder="Conta" /></div></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as contas</SelectItem>
            {accounts.map((a: any) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {hasFilters && (
        <div className="mb-4 flex justify-end">
          <Button variant="ghost" size="sm" onClick={clearFilters} className="text-xs h-8"><X className="h-3 w-3 mr-1.5" /> Limpar filtros</Button>
        </div>
      )}

      <div className="rounded-2xl border border-border bg-surface-1 overflow-hidden">
        {txLoading && <div className="p-8 text-center text-muted-foreground">Carregando lançamentos...</div>}
        {txError && <div className="p-8 text-center text-destructive">Erro ao carregar dados. Tente atualizar a página.</div>}
        {!txLoading && !txError && filteredTx.length === 0 && (
          <div className="p-12 text-center text-muted-foreground">
            <div className="text-lg font-medium mb-1">Nenhum lançamento encontrado</div>
            <p className="text-sm">Tente ajustar os filtros ou faça um novo lançamento.</p>
          </div>
        )}
        <div className="divide-y divide-border">
          {filteredTx.map((t: any) => {
            const dot = t.audit_level === "green" ? "bg-audit-green" : t.audit_level === "yellow" ? "bg-audit-yellow" : t.audit_level === "red" ? "bg-audit-red" : "bg-muted";
            return (
              <div key={t.id} className="p-4 flex items-center gap-4 hover:bg-surface-2 transition-colors group">
                <span className={cn("h-2.5 w-2.5 rounded-full shrink-0", dot)} title={t.audit_reason ?? ""} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium truncate">{t.description || "Sem descrição"}</span>
                    {t.installment_number && <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-3 text-muted-foreground font-mono">parcela {t.installment_number}</span>}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5 flex gap-2 flex-wrap items-center">
                    <span>{formatDateBR(t.occurred_on)}</span>
                    <span>·</span>
                    <span className="flex items-center gap-1">{t.accounts?.name || "Sem conta"}</span>
                    {t.categories && (
                      <>
                        <span>·</span>
                        <span className="flex items-center gap-1">{t.categories.icon} {t.categories.name}</span>
                      </>
                    )}
                  </div>
                </div>
                <div className={cn("font-mono tabular font-semibold whitespace-nowrap", t.type === "income" ? "text-income" : "text-expense")}>
                  {t.type === "income" ? "+" : "-"}{formatBRL(Number(t.amount))}
                </div>
                <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button variant="ghost" size="icon" onClick={() => openEdit(t)}><Pencil className="h-4 w-4 text-muted-foreground" /></Button>
                  <Button variant="ghost" size="icon" onClick={() => remove(t.id)}><Trash2 className="h-4 w-4 text-muted-foreground" /></Button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}