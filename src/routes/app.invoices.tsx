"use client";

import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { formatBRL, formatDateBR, monthNames, localDateString } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Check, CreditCard, AlertCircle, Plus, Trash2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/invoices")({
  component: InvoicesPage,
});

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

function InvoicesPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [payInv, setPayInv] = useState<any>(null);
  const [payAccount, setPayAccount] = useState("");
  const [payDate, setPayDate] = useState(localDateString());
  const [itemDialog, setItemDialog] = useState(false);
  const [editingItem, setEditingItem] = useState<any>(null);
  const [itemForm, setItemForm] = useState({ description: "", quantity: "1", unit_price: "" });
  const [initialBalanceDialog, setInitialBalanceDialog] = useState(false);
  const [initialBalanceForm, setInitialBalanceForm] = useState({ invoice_id: "", initial_balance: "" });

  const { data: invoices = [] } = useQuery({
    queryKey: ["invoices", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoices")
        .select("*, accounts!inner(name, type, archived)")
        .eq("accounts.archived", false)
        .order("reference_year", { ascending: false })
        .order("reference_month", { ascending: false });
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

  const { data: initialBalances = [] } = useQuery({
    queryKey: ["initial_balances", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoice_initial_balances")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const cashAccounts = accounts.filter((a: any) => a.type !== "credit_card");

  const openPay = (inv: any) => {
    setPayInv(inv);
    setPayAccount(cashAccounts[0]?.id ?? "");
    setPayDate(localDateString());
  };

  const confirmPay = async () => {
    if (!user || !payInv) return;
    if (!payAccount) { toast.error("Escolha a conta de pagamento"); return; }

    const initialBalance = initialBalances.find((b: any) => b.invoice_id === payInv.id)?.initial_balance || 0;
    const totalAmount = Number(payInv.total_amount) + initialBalance;

    const { error: txErr } = await supabase.from("transactions").insert({
      user_id: user.id,
      type: "expense",
      amount: totalAmount,
      description: `Pagamento fatura ${payInv.accounts?.name} (${monthNames[payInv.reference_month - 1]}/${payInv.reference_year})`,
      occurred_on: payDate,
      account_id: payAccount,
      status: "paid",
      source: "manual",
    });
    if (txErr) { toast.error(txErr.message); return; }

    const acc = accounts.find((a: any) => a.id === payAccount);
    if (acc) {
      await supabase.from("accounts").update({ current_balance: Number(acc.current_balance) - totalAmount }).eq("id", acc.id);
    }

    const { error: invErr } = await supabase.from("invoices").update({ status: "paid", paid_at: new Date().toISOString() }).eq("id", payInv.id);
    if (invErr) { toast.error(invErr.message); return; }

    toast.success("Fatura paga ✓");
    setPayInv(null);
    qc.invalidateQueries({ queryKey: ["invoices"] });
    qc.invalidateQueries({ queryKey: ["transactions"] });
    qc.invalidateQueries({ queryKey: ["accounts"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  };

  const reopen = async (inv: any) => {
    if (!confirm("Reabrir esta fatura? Os lançamentos não são removidos automaticamente.")) return;
    const { error } = await supabase.from("invoices").update({ status: "open", paid_at: null }).eq("id", inv.id);
    if (error) toast.error(error.message);
    else { toast.success("Fatura reaberta"); qc.invalidateQueries({ queryKey: ["invoices"] }); }
  };

  const openItemDialog = (inv: any) => {
    setPayInv(inv);
    setItemDialog(true);
    setItemForm({ description: "", quantity: "1", unit_price: "" });
  };

  const saveItem = async () => {
    if (!user || !payInv || !itemForm.description || !itemForm.unit_price) return;
    const qty = Number(itemForm.quantity) || 1;
    const unit = Number(itemForm.unit_price) || 0;
    const amount = qty * unit;

    const { error } = await supabase.from("invoice_items").insert({
      user_id: user.id,
      invoice_id: payInv.id,
      description: itemForm.description,
      quantity: qty,
      unit_price: unit,
      amount: amount,
    });

    if (error) { toast.error(error.message); return; }

    await recomputeInvoiceTotal(payInv.id);

    toast.success("Item adicionado");
    setItemDialog(false);
    setPayInv(null);
    qc.invalidateQueries({ queryKey: ["invoices"] });
  };

  const removeItem = async (itemId: string, invId: string) => {
    const { error } = await supabase.from("invoice_items").delete().eq("id", itemId);
    if (error) { toast.error(error.message); return; }

    await recomputeInvoiceTotal(invId);

    toast.success("Item removido");
    qc.invalidateQueries({ queryKey: ["invoices"] });
  };

  const openInitialBalanceDialog = (inv: any) => {
    setInitialBalanceDialog(true);
    setInitialBalanceForm({ invoice_id: inv.id, initial_balance: "" });
  };

  const saveInitialBalance = async () => {
    if (!user || !initialBalanceForm.invoice_id || !initialBalanceForm.initial_balance) return;
        const amount = Number(initialBalanceForm.initial_balance);
    if (isNaN(amount)) {
      toast.error("Informe um valor válido");
      return;
    }

    const { error } = await supabase.from("invoice_initial_balances").upsert({
      user_id: user.id,
      invoice_id: initialBalanceForm.invoice_id,
      initial_balance: amount,
    }, { onConflict: "invoice_id" });

    if (error) { toast.error(error.message); return; }

    await recomputeInvoiceTotal(initialBalanceForm.invoice_id);
        toast.success("Saldo inicial salvo");
    setInitialBalanceDialog(false);
    setInitialBalanceForm({ invoice_id: "", initial_balance: "" });
    qc.invalidateQueries({ queryKey: ["invoices"] });
    qc.invalidateQueries({ queryKey: ["initial_balances"] });
  };

  const removeInitialBalance = async (invoiceId: string) => {
    const { error } = await supabase.from("invoice_initial_balances").delete().eq("invoice_id", invoiceId);
    if (error) { toast.error(error.message); return; }

    await recomputeInvoiceTotal(invoiceId);
    
    toast.success("Saldo inicial removido");
    qc.invalidateQueries({ queryKey: ["invoices"] });
    qc.invalidateQueries({ queryKey: ["initial_balances"] });
  };

  const open = invoices.filter((i: any) => i.status !== "paid");
  const paid = invoices.filter((i: any) => i.status === "paid");

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto animate-in fade-in duration-300">
      <h1 className="font-display text-2xl md:text-3xl font-bold mb-6">Faturas</h1>

      <section className="mb-8">
        <h2 className="font-display font-semibold mb-3 text-sm text-muted-foreground uppercase tracking-wide">Em aberto ({open.length})</h2>
        {open.length === 0 ? (
          <div className="rounded-2xl border border-border bg-surface-1 p-8 text-center text-sm text-muted-foreground">
            Nenhuma fatura em aberto 🎉
          </div>
        ) : (
          <div className="space-y-2">
            {open.map((inv: any) => (
              <InvCard
                key={inv.id}
                inv={inv}
                initialBalances={initialBalances}
                onPay={() => openPay(inv)}
                onAddItem={() => openItemDialog(inv)}
                onSetInitialBalance={() => openInitialBalanceDialog(inv)}
              />
            ))}
          </div>
        )}
      </section>

      {paid.length > 0 && (
        <section>
          <h2 className="font-display font-semibold mb-3 text-sm text-muted-foreground uppercase tracking-wide">Pagas</h2>
          <div className="space-y-2">
            {paid.slice(0, 12).map((inv: any) => (
              <InvCard
                key={inv.id}
                inv={inv}
                initialBalances={initialBalances}
                onReopen={() => reopen(inv)}
              />
            ))}
          </div>
        </section>
      )}

      <Dialog open={!!payInv} onOpenChange={(v) => !v && setPayInv(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Pagar fatura</DialogTitle></DialogHeader>
          {payInv && (
            <div className="space-y-4">
              <div className="rounded-lg bg-surface-2 p-4">
                <div className="text-xs text-muted-foreground">{payInv.accounts?.name}</div>
                <div className="font-mono tabular text-2xl font-bold mt-1">
                  {formatBRL(Number(payInv.total_amount) + (initialBalances.find((b: any) => b.invoice_id === payInv.id)?.initial_balance || 0))}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {monthNames[payInv.reference_month - 1]}/{payInv.reference_year} · vence {formatDateBR(payInv.due_date)}
                </div>
              </div>
              <div>
                <Label>Pagar com</Label>
                <Select value={payAccount} onValueChange={setPayAccount}>
                  <SelectTrigger className="mt-1.5"><SelectValue placeholder="Escolha a conta" /></SelectTrigger>
                  <SelectContent>
                    {cashAccounts.map((a: any) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name} · {formatBRL(Number(a.current_balance))}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Data do pagamento</Label>
                <Input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} className="mt-1.5" />
              </div>
              <Button onClick={confirmPay} className="w-full"><Check className="h-4 w-4 mr-2" />Confirmar pagamento</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={itemDialog} onOpenChange={setItemDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Adicionar item</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Descrição</Label>
              <Input value={itemForm.description} onChange={(e) => setItemForm({ ...itemForm, description: e.target.value })} className="mt-1.5" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Quantidade</Label>
                <Input type="number" min="1" step="1" value={itemForm.quantity} onChange={(e) => setItemForm({ ...itemForm, quantity: e.target.value })} className="mt-1.5" />
              </div>
              <div>
                <Label>Valor unitário</Label>
                <Input type="number" step="0.01" value={itemForm.unit_price} onChange={(e) => setItemForm({ ...itemForm, unit_price: e.target.value })} className="mt-1.5" />
              </div>
            </div>
            <Button onClick={saveItem} className="w-full">Adicionar item</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={initialBalanceDialog} onOpenChange={setInitialBalanceDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Definir saldo inicial</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Defina um valor inicial para esta fatura. Será somado ao total das transações do mês.
            </p>
            <div>
              <Label>Saldo inicial (R$)</Label>
              <Input 
                type="number" 
                step="0.01" 
                value={initialBalanceForm.initial_balance} 
                onChange={(e) => setInitialBalanceForm({ ...initialBalanceForm, initial_balance: e.target.value })}
                placeholder="Ex: 500.00"
                className="mt-1.5" 
              />
            </div>
            <Button onClick={saveInitialBalance} className="w-full">Salvar saldo inicial</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Reusable invoice card component */
function InvCard({ inv, onPay, onAddItem, onSetInitialBalance, initialBalances }: { 
  inv: any; 
  onPay?: () => void; 
  onAddItem?: () => void; 
  onSetInitialBalance?: () => void;
  initialBalances?: any[];
}) {
  // Compute total including initial balance
  const initialBalance = initialBalances?.find((b: any) => b.invoice_id === inv.id)?.initial_balance || 0;
  const total = Number(inv.total_amount) + initialBalance;

  // Determine overdue status
  const due = new Date(inv.due_date + "T12:00:00");
  const today = new Date();
  const days = Math.ceil((today.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));
  const overdue = days < 0;
  const urgent = days >= 0 && days <= 5;

  // Load invoice items for this card
  const [items, setItems] = useState<any[]>([]);
  const [loadingItems, setLoadingItems] = useState(true);
  const qc = useQueryClient();

  useEffect(() => {
    const fetchItems = async () => {
      const { data } = await qc.fetchQuery({
        queryKey: ["invoice_items", inv.id],
        queryFn: async () => {
          const { data: itemsData } = await supabase.from("invoice_items").select("*").eq("invoice_id", inv.id);
          return itemsData || [];
        },
      });
      setItems(data || []);
      setLoadingItems(false);
    };
    fetchItems();
  }, [inv.id, qc]);

  const removeItem = async (itemId: string) => {
    const { error } = await supabase.from("invoice_items").delete().eq("id", itemId);
    if (error) { toast.error(error.message); return; }
    const newItems = items.filter(i => i.id !== itemId);
    setItems(newItems);
    await recomputeInvoiceTotal(inv.id);
    toast.success("Item removido");
    qc.invalidateQueries({ queryKey: ["invoices"] });
  };

  return (
    <div className={cn(
      "rounded-2xl border bg-surface-1 p-4 flex items-start gap-3 shadow-card transition-all",
      overdue ? "border-audit-red/40" : urgent ? "border-audit-yellow/40" : "border-border",
      total >= 0 ? "opacity-70" : ""
    )}>
      <div className="h-10 w-10 rounded-lg bg-surface-2 flex items-center justify-center shrink-0">
        <CreditCard className="h-5 w-5 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-medium truncate">{inv.accounts?.name}</div>
        <div className="text-xs text-muted-foreground mt-0.5">
          {inv.reference_month ? `${monthNames[inv.reference_month - 1]}/${inv.reference_year}` : "—"}
          {overdue && <span className="text-[10px] px-1.5 py-0.5 rounded bg-audit-red/20 text-audit-red">vencida</span>}
          {urgent && <span className="text-[10px] px-1.5 py-0.5 rounded bg-audit-yellow/20 text-audit-yellow">{days}d</span>}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          {inv.amount_kind === "fixed" ? "Fixo" : "Variável"}
        </div>
        <div className="mt-2 font-mono tabular text-2xl font-semibold">{formatBRL(total)}</div>
      </div>
      <div className="font-mono tabular font-semibold text-expense whitespace-nowrap">{formatBRL(total)}</div>
      <div className="flex flex-col gap-1">
        {onPay && <Button size="sm" onClick={onPay}><Check className="h-3.5 w-3.5 mr-1" />Pagar</Button>}
        {onReopen && <Button size="sm" variant="ghost" onClick={onReopen}>Reabrir</Button>}
        {!overdue && onSetInitialBalance && (
          <Button size="sm" variant="outline" onClick={onSetInitialBalance}>
            Saldo inicial
          </Button>
        )}
      </div>
      {items.length > 0 && (
        <div className="mt-3 space-y-1">
          {items.map((it: any) => (
            <div key={it.id} className="flex items-center justify-between bg-surface-2/50 rounded px-2 py-1">
              <div className="text-xs font-medium">{it.quantity}x</div>{it.description}
              <div className="font-mono">{formatBRL(Number(it.amount))}</div>
              {!overdue && (
                <button onClick={() => removeItem(it.id)} className="opacity-50 hover:opacity-100">
                  <Trash2 className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}