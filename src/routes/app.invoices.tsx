import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { formatBRL, formatDateBR, monthNames } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Check, CreditCard, AlertCircle, Plus, Trash2, Pencil, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/invoices")({
  component: InvoicesPage,
});

/** Recomputes the total_amount for an invoice by summing all transactions and invoice_items */
const recomputeInvoiceTotal = async (invoiceId: string) => {
  const { data: txs } = await supabase.from("transactions").select("amount").eq("invoice_id", invoiceId);
  const txTotal = (txs || []).reduce((sum, tx) => sum + Number(tx.amount), 0);
  const { data: items } = await supabase.from("invoice_items").select("amount").eq("invoice_id", invoiceId);
  const itemsTotal = (items || []).reduce((sum, item) => sum + Number(item.amount), 0);
  const total = txTotal + itemsTotal;
  await supabase.from("invoices").update({ total_amount: total }).eq("id", invoiceId);
};

function InvoicesPage() {
  const { user } = useAuth();
  const qc = useQueryClient();

  // State for paying an invoice
  const [payInv, setPayInv] = useState<any>(null);
  const [payAccount, setPayAccount] = useState<string>("");
  const [payDate, setPayDate] = useState<string>(new Date().toISOString().slice(0, 10));

  // State for managing invoice items
  const [itemDialog, setItemDialog] = useState(false);
  const [itemForm, setItemForm] = useState({ description: "", quantity: "1", unit_price: "" });

  // Load invoices
  const { data: invoices = [] } = useQuery({
    queryKey: ["invoices", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoices")
        .select("*, accounts!inner(name, type, archived)")
        .eq("accounts.archived", false)
        .order("due_date", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  // Load accounts (used for payment)
  const { data: accounts = [] } = useQuery({
    queryKey: ["accounts", user?.id],
    queryFn: async () => {
      const { data } = await supabase.from("accounts").select("*").eq("archived", false);
      return data ?? [];
    },
    enabled: !!user,
  });

  const cashAccounts = accounts.filter((a: any) => a.type !== "credit_card");

  // Open payment dialog
  const openPay = (inv: any) => {
    setPayInv(inv);
    setPayAccount(cashAccounts[0]?.id ?? "");
    setPayDate(new Date().toISOString().slice(0, 10));
  };

  // Confirm payment
  const confirmPay = async () => {
    if (!user || !payInv) return;
    if (!payAccount) {
      toast.error("Escolha a conta de pagamento");
      return;
    }

    const { error: txErr } = await supabase.from("transactions").insert({
      user_id: user.id,
      type: "expense",
      amount: Number(payInv.total_amount),
      description: `Pagamento fatura ${payInv.accounts?.name} (${monthNames[payInv.reference_month - 1]}/${payInv.reference_year})`,
      occurred_on: payDate,
      account_id: payAccount,
      status: "paid",
      source: "manual",
    });

    if (txErr) {
      toast.error(txErr.message);
      return;
    }

    // Update account balance (simple subtraction)
    const acc = accounts.find((a: any) => a.id === payAccount);
    if (acc) {
      await supabase
        .from("accounts")
        .update({ current_balance: Number(acc.current_balance) - Number(payInv.total_amount) })
        .eq("id", acc.id);
    }

    const { error: invErr } = await supabase
      .from("invoices")
      .update({ status: "paid", paid_at: new Date().toISOString() })
      .eq("id", payInv.id);

    if (invErr) {
      toast.error(invErr.message);
      return;
    }

    toast.success("Fatura paga ✓");
    setPayInv(null);
    qc.invalidateQueries({ queryKey: ["invoices"] });
    qc.invalidateQueries({ queryKey: ["transactions"] });
    qc.invalidateQueries({ queryKey: ["accounts"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  };

  // Reopen a paid invoice
  const reopen = async (inv: any) => {
    if (!confirm("Reabrir esta fatura? Os lançamentos não são removidos automaticamente.")) return;
    const { error } = await supabase.from("invoices").update({ status: "open", paid_at: null }).eq("id", inv.id);
    if (error) toast.error(error.message);
    else {
      toast.success("Fatura reaberta");
      qc.invalidateQueries({ queryKey: ["invoices"] });
    }
  };

  // Open dialog to add an item to an invoice
  const openItemDialog = (inv: any) => {
    setPayInv(inv);
    setItemDialog(true);
    setItemForm({ description: "", quantity: "1", unit_price: "" });
  };

  // Save new invoice item
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
      amount,
    });

    if (error) {
      toast.error(error.message);
      return;
    }

    await recomputeInvoiceTotal(payInv.id);
    toast.success("Item adicionado");
    setItemDialog(false);
    setPayInv(null);
    qc.invalidateQueries({ queryKey: ["invoices"] });
  };

  // Remove an item from an invoice
  const removeItem = async (itemId: string, invId: string) => {
    const { error } = await supabase.from("invoice_items").delete().eq("id", itemId);
    if (error) {
      toast.error(error.message);
      return;
    }
    await recomputeInvoiceTotal(invId);
    toast.success("Item removido");
    qc.invalidateQueries({ queryKey: ["invoices"] });
  };

  // Separate open and paid invoices for display
  const openInvoices = invoices.filter((i: any) => i.status !== "paid");
  const paidInvoices = invoices.filter((i: any) => i.status === "paid");

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto animate-in fade-in duration-300">
      <div className="flex items-center justify-between mb-2">
        <h1 className="font-display text-2xl md:text-3xl font-bold">Faturas</h1>
        <p className="text-sm text-muted-foreground">
          {monthNames[new Date().getMonth()]} de {new Date().getFullYear()}
        </p>
      </div>

      {/* Open invoices */}
      <section className="rounded-2xl border border-border bg-surface-1 overflow-hidden mb-6">
        {openInvoices.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground text-sm">Nenhuma fatura em aberto.</div>
        ) : (
          <div className="divide-y divide-border">
            {openInvoices.map((inv: any) => (
              <div key={inv.id} className="p-4 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <div className="font-medium">{inv.accounts?.name}</div>
                  <div className="font-mono tabular text-xl">{formatBRL(Number(inv.total_amount))}</div>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Button size="sm" variant="outline" onClick={() => openPay(inv)}>
                    <Check className="h-3.5 w-3.5 mr-1" /> Pagar
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => openItemDialog(inv)}>
                    <Plus className="h-3.5 w-3.5 mr-1" /> Item
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Paid invoices */}
      <section className="rounded-2xl border border-border bg-surface-1 overflow-hidden">
        {paidInvoices.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground text-sm">Nenhuma fatura paga.</div>
        ) : (
          <div className="divide-y divide-border">
            {paidInvoices.map((inv: any) => (
              <div key={inv.id} className="p-4 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <div className="font-medium">{inv.accounts?.name}</div>
                  <div className="font-mono tabular text-xl text-audit-green">{formatBRL(Number(inv.total_amount))}</div>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Button size="sm" variant="ghost" onClick={() => reopen(inv)}>
                    <AlertCircle className="h-3.5 w-3.5 mr-1" /> Reabrir
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Pay dialog */}
      <Dialog open={!!payInv && !!payAccount} onOpenChange={(open) => !open && setPayInv(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Pagar fatura {payInv?.accounts?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Label>Conta de pagamento</Label>
            <Select value={payAccount} onValueChange={setPayAccount}>
              <SelectTrigger className="mt-1.5"><SelectValue placeholder="Selecione a conta" /></SelectTrigger>
              <SelectContent>
                {cashAccounts.map((a: any) => (
                  <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Label>Data</Label>
            <Input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} className="mt-1.5" />

            <Button onClick={confirmPay} className="w-full">
              Confirmar pagamento
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Item dialog */}
      <Dialog open={itemDialog} onOpenChange={setItemDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adicionar item à fatura</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Label>Descrição</Label>
            <Input value={itemForm.description} onChange={(e) => setItemForm({ ...itemForm, description: e.target.value })} className="mt-1.5" />

            <Label>Quantidade</Label>
            <Input type="number" min="1" value={itemForm.quantity} onChange={(e) => setItemForm({ ...itemForm, quantity: e.target.value })} className="mt-1.5" />

            <Label>Preço unitário</Label>
            <Input type="number" step="0.01" value={itemForm.unit_price} onChange={(e) => setItemForm({ ...itemForm, unit_price: e.target.value })} className="mt-1.5" />

            <Button onClick={saveItem} className="w-full">
              Salvar item
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* List items of selected invoice (if any) */}
      {payInv && (
        <section className="mt-6">
          <h2 className="font-display text-lg mb-3">Itens da fatura</h2>
          <div className="rounded-2xl border border-border bg-surface-1 overflow-hidden">
            {/* Fetch items for the selected invoice */}
            <InvoiceItems invoiceId={payInv.id} onRemove={removeItem} />
          </div>
        </section>
      )}
    </div>
  );
}

/* Helper component to list items of a given invoice */
function InvoiceItems({ invoiceId, onRemove }: { invoiceId: string; onRemove: (itemId: string, invId: string) => void }) {
  const { data: items = [] } = useQuery({
    queryKey: ["invoice_items", invoiceId],
    queryFn: async () => {
      const { data, error } = await supabase.from("invoice_items").select("*").eq("invoice_id", invoiceId);
      if (error) throw error;
      return data;
    },
    enabled: !!invoiceId,
  });

  if (items.length === 0) {
    return <div className="p-4 text-center text-muted-foreground text-sm">Nenhum item cadastrado.</div>;
  }

  return (
    <div className="divide-y divide-border">
      {items.map((it: any) => (
        <div key={it.id} className="p-3 flex items-center justify-between">
          <div className="flex flex-col">
            <span className="font-medium">{it.description}</span>
            <span className="text-xs text-muted-foreground">
              {it.quantity} × {formatBRL(Number(it.unit_price))} = {formatBRL(Number(it.amount))}
            </span>
          </div>
          <Button size="icon" variant="ghost" onClick={() => onRemove(it.id, invoiceId)}>
            <X className="h-4 w-4 text-muted-foreground" />
          </Button>
        </div>
      ))}
    </div>
  );
}