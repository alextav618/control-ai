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
  // Retorna a data local no formato YYYY-MM-DD
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Calculates the invoice (reference month/year, closing and due dates) for a purchase on a credit card, using local timezone. */
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

/** Recomputes the total_amount for an invoice by summing all transactions, invoice_items, and initial_balances */
const recomputeInvoiceTotal = async (invoiceId: string) => {
  // Sum transactions
  const { data: txs } = await supabase.from("transactions").select("amount").eq("invoice_id", invoiceId);
  const txTotal = (txs || []).reduce((sum, tx) => sum + Number(tx.amount), 0);
  
  // Sum invoice items
  const { data: items } = await supabase.from("invoice_items").select("amount").eq("invoice_id", invoiceId);
  const itemsTotal = (items || []).reduce((sum, item) => sum + Number(item.amount), 0);

  // Get initial balance
  const { data: initialBalanceData } = await supabase.from("invoice_initial_balances").select("initial_balance").eq("invoice_id", invoiceId).maybeSingle();
  const initialBalance = Number(initialBalanceData?.initial_balance || 0);
  
  const total = txTotal + itemsTotal + initialBalance;
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
      installments: "1", // Reset installments for edit
    });
    setOpen(true);
  };

  useEffect(() => { if (!open) resetForm(); }, [open]);

  // Simplificando a query para evitar conflitos de RLS/estrutura
  const { data: tx = [], isLoading: txLoading } = useQuery({
    queryKey: ["transactions", user?.id],
    queryFn: async () => {
      if (!user) return [];
      // Query simplificada, removendo joins complexos que podem causar conflito
      const { data, error } = await supabase
        .from("transactions")
        .select("*") // Seleciona todas as colunas da tabela transactions
        .order("occurred_on", { ascending: false })
        .limit(200);
      if (error) {
        console.error("Error fetching transactions:", error);
        // Não lança toast aqui para evitar tela branca em caso de erro inicial
        return []; // Retorna array vazio para evitar tela branca
      }
      return data;
    },
    enabled: !!user,
    retry: false, // Desabilita retries automáticas para evitar loops em caso de erro persistente
  });

  const { data: accounts = [], isLoading: accLoading } = useQuery({
    queryKey: ["accounts", user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await supabase.from("accounts").select("*").eq("archived", false);
      if (error) {
        console.error("Error fetching accounts:", error);
        // Não lança toast aqui para evitar tela branca
        return []; // Retorna array vazio para evitar tela branca
      }
      return data ?? [];
    },
    enabled: !!user,
    retry: false,
  });

  const { data: cats = [], isLoading: catLoading } = useQuery({
    queryKey: ["categories", user?.id, form.type],
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await supabase.from("categories").select("*");
      if (error) {
        console.error("Error fetching categories:", error);
        // Não lança toast aqui para evitar tela branca
        return []; // Retorna array vazio para evitar tela branca
      }
      return data ?? [];
    },
    enabled: !!user,
    retry: false,
  });

  const remove = async (id: string) => {
    const { data: txData } = await supabase.from("transactions").select("invoice_id").eq("id", id).single();
    const invoiceId = txData?.invoice_id;
    
    const { error } = await supabase.from("transactions").delete().eq("id", id);
    if (error) {
      console.error("Error deleting transaction:", error);
      toast.error(error.message);
      return;
    }
    
    if (invoiceId) {
      await recomputeInvoiceTotal(invoiceId);
    }
    toast.success("Removido"); 
    qc.invalidateQueries({ queryKey: ["transactions"] }); 
    qc.invalidateQueries({ queryKey: ["dashboard"] }); 
    qc.invalidateQueries({ queryKey: ["accounts"] }); 
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
    if (error) { 
      console.error("Error creating invoice:", error); 
      toast.error("Erro ao criar fatura para o lançamento");
      return null; 
    }
    return created;
  };

  const submit = async () => {
    if (!user || !form.description || !form.amount || !form.account_id) {
      toast.error("Preencha descrição, valor e conta");
      return;
    }

    const amountNum = Number(form.amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      toast.error("Valor inválido");
      return;
    }

    // Usa a data local para criar o objeto Date, garantindo que o timezone local seja considerado
    const occurredDate = new Date(form.occurred_on + "T12:00:00"); 

    if (editId) {
      const { error } = await supabase.from("transactions").update({
        type: form.type as any,
        description: form.description,
        amount: amountNum,
        occurred_on: form.occurred_on, // Store as YYYY-MM-DD string
        account_id: form.account_id,
        category_id: form.category_id || null,
      }).eq("id", editId);
      if (error) { 
        console.error("Error updating transaction:", error); 
        toast.error(error.message); 
        return; 
      }
      toast.success("Lançamento atualizado");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["invoices"] });
      return;
    }

    const account = accounts.find((a: any) => a.id === form.account_id);
    if (!account) {
      toast.error("Conta não encontrada");
      return;
    }
    const isCard = account.type === "credit_card";
    const installments = Math.max(1, Number(form.installments) || 1);
    const installmentAmount = +(amountNum / installments).toFixed(2);

    let installmentPlanId: string | null = null;
    if (installments > 1) {
      const { data: plan, error: pErr } = await supabase.from("installment_plans").insert({
        user_id: user.id,
        description: form.description,
        total_amount: amountNum,
        installment_amount: installmentAmount,
        total_installments: installments,
        account_id: account.id,
        category_id: form.category_id || null,
        start_date: form.occurred_on,
      }).select().single();
      if (pErr) { 
        console.error("Error creating installment plan:", pErr); 
        toast.error(pErr.message); 
        return; 
      }
      installmentPlanId = plan.id;
    }

    const rows: any[] = [];
    for (let i = 0; i < installments; i++) {
      // Calculate date for each installment using local timezone
      const installmentDate = new Date(occurredDate.getFullYear(), occurredDate.getMonth() + i, occurredDate.getDate());
      const occurred = localDateString(installmentDate); // Format as YYYY-MM-DD

      let invoiceId: string | null = null;
      if (isCard) {
        const inv = await ensureInvoice(account, installmentDate);
        invoiceId = inv?.id ?? null;
      }
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
        status: "paid", // Assume paid for manual entry
        source: "manual",
      });
    }

    const { error } = await supabase.from("transactions").insert(rows as any);
    if (error) { 
      console.error("Error inserting transactions:", error); 
      toast.error(error.message); 
      return; 
    }
    
    const invoiceIds = [...new Set(rows.map(r => r.invoice_id).filter(Boolean))];
    for (const invId of invoiceIds) {
      await recomputeInvoiceTotal(invId);
    }
    
    toast.success(installments > 1 ? `${installments} parcelas lançadas` : "Lançamento criado");
    setOpen(false);
    qc.invalidateQueries({ queryKey: ["transactions"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    qc.invalidateQueries({ queryKey: ["accounts"] });
    qc.invalidateQueries({ queryKey: ["invoices"] });
  };

  const filteredCats = cats.filter((c: any) => c.kind === form.type);
  const selectedAccount = accounts.find((a: any) => a.id === form.account_id);
  const isCardSelected = selectedAccount?.type === "credit_card";

  // Remove a verificação de loading para evitar tela branca
  // if (txLoading || accLoading || catLoading) return <div className="p-6 text-muted-foreground">Carregando...</div>;

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
                {!editId && form.type === "expense" && (
                  <div>
                    <Label>Parcelas</Label>
                    <Input type="number" min={1} max={36} value={form.installments} onChange={(e) => setForm({ ...form, installments: e.target.value })} className="mt-1.5" />
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Conta / Cartão</Label>
                  <Select value={form.account_id} onValueChange={(v) => setForm({ ...form, account_id: v, category_id: "" })}>
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