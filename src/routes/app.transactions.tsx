import { createFileRoute } from '@tanstack/react-router'
import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { formatBRL, formatDateBR } from "@/lib/format";
import { Trash2, Plus, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useBanks } from "@/lib/banks";

export const Route = createFileRoute("/app/transactions")({ component: TxPage });

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function invoiceWindow(purchase: Date, closingDay: number, dueDay: number) {
  const day = purchase.getDate();
  let m = purchase.getMonth() + 1;
  let y = purchase.getFullYear();
  if (day > closingDay) {
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  const safeClosing = Math.min(closingDay, 28);
  const safeDue = Math.min(dueDay, 28);
  const closingDate = new Date(y, m - 1, safeClosing);
  let dueY = y, dueM = m;
  if (dueDay <= closingDay) { dueM += 1; if (dueM > 12) { dueM = 1; dueY += 1; } }
  const dueDate = new Date(dueY, dueM - 1, safeDue);
  return {
    referenceMonth: m,
    referenceYear: y,
    closingDate: `${closingDate.getFullYear()}-${String(closingDate.getMonth() + 1).padStart(2, "0")}-${String(closingDate.getDate()).padStart(2, "0")}`,
    dueDate: `${dueDate.getFullYear()}-${String(dueDate.getMonth() + 1).padStart(2, "0")}-${String(dueDate.getDate()).padStart(2, "0")}`,
  };
}

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
    occurred_on: todayISO(),
    account_id: "",
    category_id: "",
    installments: "1",
    bank_id: "", // NEW: bank selection
  });

  const resetForm = () => {
    setForm({
      type: "expense",
      description: "",
      amount: "",
      occurred_on: todayISO(),
      account_id: "",
      category_id: "",
      installments: "1",
      bank_id: "",
    });
    setEditId(null);
  };
  useEffect(() => { if (!open) resetForm(); }, [open]);

  const { data: tx = [] } = useQuery({
    queryKey: ["transactions", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transactions")
        .select("*, accounts(name, type, closing_day, due_day), categories(name, icon), invoices(reference_month, reference_year, account_id, accounts(name))")
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

  // NEW: fetch banks for the select
  const { data: banks = [], isLoading: banksLoading } = useBanks();

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
      bank_id: t.bank_id ?? "", // preserve bank_id on edit
    });
    setOpen(true);
  };
  const remove = async (id: string) => {
    const { data: tx } = await supabase.from("transactions").select("invoice_id").eq("id", id).single();
    const invoiceId = tx?.invoice_id;
    const { error } = await supabase.from("transactions").delete().eq("id", id);
    if (error) toast.error(error.message);
    else {
      if (invoiceId) await recomputeInvoiceTotal(invoiceId);
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
    if (!user || !form.description || !form.amount || !form.account_id || !form.bank_id) {
      toast.error("Preencha descrição, valor, conta e banco");
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
        bank_id: form.bank_id, // persist bank_id on update
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

    const baseDate = new Date(form.occurred_on + "T12:00:00Z");
    const rows: any[] = [];
    for (let i = 0; i < installments; i++) {
      const d = new Date(Date.UTC(baseDate.getUTCFullYear(), baseDate.getUTCMonth() + i, baseDate.getUTCDate()));
      const occ_i = d.toISOString().slice(0, 10);
      let invoiceId: string | null = null;
      if (isCard) {
        const inv = await ensureInvoice(account, d);
        invoiceId = inv?.id ?? null;
      }
      const occurred = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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
        bank_id: form.bank_id, // NEW: store selected bank_id on each transaction
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
              {/* NEW: Bank selection */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Banco</Label>
                  <SelectValue placeholder="Selecione" />
                  <SelectTrigger className="mt-1.5">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="mt-1.5">
                    {banks.map((b: any) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </div>
                {form.type === "expense" && !editId && Number(form.installments) > 1 && (
                  <p className="text-xs text-muted-foreground bg-surface-2 p-3 rounded-lg">
                    💳 As parcelas serão distribuídas automaticamente nas próximas {form.installments} faturas, respeitando o fechamento dia {selectedAccount?.closing_day}.
                  </p>
                )}
              </div>
              <Button onClick={submit} className="w-full">{editId ? "Salvar alterações" : "Lançar"}</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="rounded-2xl border border-border bg-surface-1 overflow-hidden">
        {tx.length === 0 && <div className="p-8 text-center text-muted-foreground">Nenhum lançamento ainda.</div>}
        <div className="divide-y divide-border">
          {tx.map((t: any) => {
            const dot = t.audit_level === "green" ? "bg-audit-green" : t.audit_level === "yellow" ? "bg-audit-yellow" : t.audit_level === "red" ? "bg-audit-red" : "bg-muted";
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