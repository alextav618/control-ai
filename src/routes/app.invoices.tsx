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
import { Check, CreditCard, AlertCircle, Plus, Trash2, ChevronDown, ChevronUp, Receipt } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/app/invoices")({
  component: InvoicesPage,
});

const recomputeInvoiceTotal = async (invoiceId: string) => {
  const { data: txs } = await supabase.from("transactions").select("amount").eq("invoice_id", invoiceId);
  const txTotal = (txs || []).reduce((sum, tx) => sum + Number(tx.amount), 0);
  
  const { data: items } = await supabase.from("invoice_items").select("amount").eq("invoice_id", invoiceId);
  const itemsTotal = (items || []).reduce((sum, item) => sum + Number(item.amount), 0);

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
      const { data, error } = await supabase.from("invoice_initial_balances").select("*");
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const cashAccounts = accounts.filter((a: any) => a.type !== "credit_card");

  const confirmPay = async () => {
    if (!user || !payInv || !payAccount) return;
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

    const { error: invErr } = await supabase.from("invoices").update({ status: "paid", paid_at: new Date().toISOString() }).eq("id", payInv.id);
    if (invErr) { toast.error(invErr.message); return; }

    toast.success("Fatura paga ✓");
    setPayInv(null);
    qc.invalidateQueries({ queryKey: ["invoices"] });
    qc.invalidateQueries({ queryKey: ["transactions"] });
    qc.invalidateQueries({ queryKey: ["accounts"] });
  };

  const saveItem = async () => {
    if (!user || !payInv || !itemForm.description || !itemForm.unit_price) return;
    const qty = Number(itemForm.quantity) || 1;
    const unit = Number(itemForm.unit_price) || 0;
    const { error } = await supabase.from("invoice_items").insert({
      user_id: user.id,
      invoice_id: payInv.id,
      description: itemForm.description,
      quantity: qty,
      unit_price: unit,
      amount: qty * unit,
    });
    if (error) { toast.error(error.message); return; }
    await recomputeInvoiceTotal(payInv.id);
    toast.success("Item adicionado");
    setItemDialog(false);
    qc.invalidateQueries({ queryKey: ["invoices"] });
  };

  const saveInitialBalance = async () => {
    if (!user || !initialBalanceForm.invoice_id || !initialBalanceForm.initial_balance) return;
    const { error } = await supabase.from("invoice_initial_balances").upsert({
      user_id: user.id,
      invoice_id: initialBalanceForm.invoice_id,
      initial_balance: Number(initialBalanceForm.initial_balance),
    }, { onConflict: "invoice_id" });
    if (error) { toast.error(error.message); return; }
    await recomputeInvoiceTotal(initialBalanceForm.invoice_id);
    toast.success("Saldo inicial salvo");
    setInitialBalanceDialog(false);
    qc.invalidateQueries({ queryKey: ["invoices"] });
  };

  const openInvoices = invoices.filter((i: any) => i.status !== "paid");
  const paidInvoices = invoices.filter((i: any) => i.status === "paid");

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto animate-in fade-in duration-300">
      <h1 className="font-display text-2xl md:text-3xl font-bold mb-6">Faturas</h1>

      <section className="mb-10">
        <h2 className="font-display font-semibold mb-4 text-sm text-muted-foreground uppercase tracking-wide">Em aberto ({openInvoices.length})</h2>
        {openInvoices.length === 0 ? (
          <div className="rounded-2xl border border-border bg-surface-1 p-10 text-center text-sm text-muted-foreground">
            Nenhuma fatura em aberto 🎉
          </div>
        ) : (
          <div className="space-y-4">
            {openInvoices.map((inv: any) => (
              <InvCard
                key={inv.id}
                inv={inv}
                initialBalances={initialBalances}
                onPay={() => { setPayInv(inv); setPayAccount(cashAccounts[0]?.id ?? ""); }}
                onAddItem={() => { setPayInv(inv); setItemDialog(true); setItemForm({ description: "", quantity: "1", unit_price: "" }); }}
                onSetInitialBalance={() => { setInitialBalanceDialog(true); setInitialBalanceForm({ invoice_id: inv.id, initial_balance: "" }); }}
              />
            ))}
          </div>
        )}
      </section>

      {paidInvoices.length > 0 && (
        <section>
          <h2 className="font-display font-semibold mb-4 text-sm text-muted-foreground uppercase tracking-wide">Pagas</h2>
          <div className="space-y-4">
            {paidInvoices.slice(0, 6).map((inv: any) => (
              <InvCard key={inv.id} inv={inv} initialBalances={initialBalances} />
            ))}
          </div>
        </section>
      )}

      <Dialog open={!!payInv && !itemDialog} onOpenChange={(v) => !v && setPayInv(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Pagar fatura</DialogTitle></DialogHeader>
          {payInv && (
            <div className="space-y-4">
              <div className="rounded-xl bg-surface-2 p-4 border border-border">
                <div className="text-xs text-muted-foreground">{payInv.accounts?.name}</div>
                <div className="font-mono tabular text-2xl font-bold mt-1">
                  {formatBRL(Number(payInv.total_amount) + (initialBalances.find((b: any) => b.invoice_id === payInv.id)?.initial_balance || 0))}
                </div>
              </div>
              <div>
                <Label>Pagar com</Label>
                <Select value={payAccount} onValueChange={setPayAccount}>
                  <SelectTrigger className="mt-1.5"><SelectValue placeholder="Escolha a conta" /></SelectTrigger>
                  <SelectContent>
                    {cashAccounts.map((a: any) => (
                      <SelectItem key={a.id} value={a.id}>{a.name} · {formatBRL(Number(a.current_balance))}</SelectItem>
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
          <DialogHeader><DialogTitle>Adicionar item extra</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>Descrição</Label><Input value={itemForm.description} onChange={(e) => setItemForm({ ...itemForm, description: e.target.value })} className="mt-1.5" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Quantidade</Label><Input type="number" value={itemForm.quantity} onChange={(e) => setItemForm({ ...itemForm, quantity: e.target.value })} className="mt-1.5" /></div>
              <div><Label>Valor unitário</Label><Input type="number" step="0.01" value={itemForm.unit_price} onChange={(e) => setItemForm({ ...itemForm, unit_price: e.target.value })} className="mt-1.5" /></div>
            </div>
            <Button onClick={saveItem} className="w-full">Adicionar</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={initialBalanceDialog} onOpenChange={setInitialBalanceDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Saldo inicial da fatura</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>Valor (R$)</Label><Input type="number" step="0.01" value={initialBalanceForm.initial_balance} onChange={(e) => setInitialBalanceForm({ ...initialBalanceForm, initial_balance: e.target.value })} className="mt-1.5" /></div>
            <Button onClick={saveInitialBalance} className="w-full">Salvar</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function InvCard({ inv, onPay, onAddItem, onSetInitialBalance, initialBalances }: any) {
  const [expanded, setExpanded] = useState(false);
  const initialBalance = initialBalances?.find((b: any) => b.invoice_id === inv.id)?.initial_balance || 0;
  const total = Number(inv.total_amount) + initialBalance;

  const { data: details } = useQuery({
    queryKey: ["invoice-details", inv.id],
    queryFn: async () => {
      const [txR, itemsR] = await Promise.all([
        supabase.from("transactions").select("*, categories(name, icon)").eq("invoice_id", inv.id).order("occurred_on"),
        supabase.from("invoice_items").select("*").eq("invoice_id", inv.id),
      ]);
      return { transactions: txR.data ?? [], items: itemsR.data ?? [] };
    },
    enabled: expanded,
  });

  return (
    <div className="rounded-2xl border border-border bg-surface-1 overflow-hidden shadow-card">
      <div className="p-4 flex items-start gap-4">
        <div className="h-10 w-10 rounded-lg bg-surface-2 flex items-center justify-center shrink-0">
          <CreditCard className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-display font-bold">{inv.accounts?.name}</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {monthNames[inv.reference_month - 1]}/{inv.reference_year} · vence {formatDateBR(inv.due_date)}
          </div>
          <div className="mt-2 font-mono tabular text-xl font-bold">{formatBRL(total)}</div>
        </div>
        <div className="flex flex-col gap-2">
          {onPay && <Button size="sm" onClick={onPay}><Check className="h-3.5 w-3.5 mr-1.5" />Pagar</Button>}
          <Button size="sm" variant="ghost" onClick={() => setExpanded(!expanded)}>
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border bg-surface-2/30 p-4 space-y-4 animate-in slide-in-from-top-2 duration-200">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Detalhamento</h3>
            <div className="flex gap-2">
              {onSetInitialBalance && <Button size="xs" variant="outline" onClick={onSetInitialBalance} className="h-7 text-[10px]">Saldo inicial</Button>}
              {onAddItem && <Button size="xs" variant="outline" onClick={onAddItem} className="h-7 text-[10px]"><Plus className="h-3 w-3 mr-1" />Item extra</Button>}
            </div>
          </div>

          <div className="space-y-1">
            {initialBalance !== 0 && (
              <div className="flex items-center justify-between py-1.5 text-sm border-b border-border/50 border-dashed">
                <span className="text-muted-foreground italic">Saldo inicial / Ajuste</span>
                <span className="font-mono tabular">{formatBRL(initialBalance)}</span>
              </div>
            )}
            {details?.transactions.map((t: any) => (
              <div key={t.id} className="flex items-center justify-between py-1.5 text-sm">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs shrink-0 text-muted-foreground">{formatDateBR(t.occurred_on).slice(0, 5)}</span>
                  <span className="truncate">{t.description}</span>
                </div>
                <span className="font-mono tabular shrink-0">{formatBRL(Number(t.amount))}</span>
              </div>
            ))}
            {details?.items.map((it: any) => (
              <div key={it.id} className="flex items-center justify-between py-1.5 text-sm text-primary">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-[10px] px-1 rounded bg-primary/10 shrink-0">EXTRA</span>
                  <span className="truncate">{it.description} {it.quantity > 1 ? `(x${it.quantity})` : ""}</span>
                </div>
                <span className="font-mono tabular shrink-0">{formatBRL(Number(it.amount))}</span>
              </div>
            ))}
            {!details && <div className="text-center py-4 text-xs text-muted-foreground">Carregando...</div>}
            {details && details.transactions.length === 0 && details.items.length === 0 && initialBalance === 0 && (
              <div className="text-center py-4 text-xs text-muted-foreground">Nenhum item nesta fatura.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}