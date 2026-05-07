"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { formatBRL, formatDateBR, monthNames, localDateString } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Check, CreditCard, Plus, Trash2, Pencil, ChevronDown, ChevronUp, AlertCircle, Settings2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/app/invoices")({
  component: InvoicesPage,
});

function InvoicesPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  
  // Modals state
  const [payInv, setPayInv] = useState<any>(null);
  const [payAccount, setPayAccount] = useState("");
  const [payDate, setPayDate] = useState(localDateString());
  
  const [itemDialog, setItemDialog] = useState(false);
  const [itemForm, setItemForm] = useState({ description: "", quantity: "1", unit_price: "" });
  
  const [adjDialog, setAdjDialog] = useState(false);
  const [editingAdj, setEditingAdj] = useState<any>(null);
  const [adjForm, setAdjForm] = useState({ invoice_id: "", amount: "" });

  // Queries
  const { data: invoices = [], isLoading: invLoading } = useQuery({
    queryKey: ["invoices", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoices")
        .select("*, accounts!inner(name, type, archived)")
        .eq("accounts.archived", false)
        .order("reference_year", { ascending: false })
        .order("reference_month", { ascending: false });
      if (error) {
        console.error('Erro Supabase (fetch invoices):', error);
        throw error;
      }
      return data;
    },
    enabled: !!user,
  });

  const { data: accounts = [] } = useQuery({
    queryKey: ["accounts", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("accounts").select("*").eq("archived", false);
      if (error) console.error('Erro Supabase (fetch accounts):', error);
      return data ?? [];
    },
    enabled: !!user,
  });

  const { data: initialBalances = [], isLoading: adjLoading } = useQuery({
    queryKey: ["initial_balances", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoice_initial_balances")
        .select("*, invoices(reference_month, reference_year, accounts(name))")
        .order("created_at", { ascending: false });
      if (error) {
        console.error('Erro Supabase (fetch initial balances):', error);
        throw error;
      }
      return data;
    },
    enabled: !!user,
  });

  const cashAccounts = accounts.filter((a: any) => a.type !== "credit_card");

  // Actions
  const triggerRecompute = async (invoiceId: string) => {
    const { error } = await supabase.rpc("recompute_invoice_total", { p_invoice_id: invoiceId });
    if (error) console.error('Erro Supabase (rpc recompute):', error);
    qc.invalidateQueries({ queryKey: ["invoices"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  };

  const confirmPay = async () => {
    if (!user || !payInv || !payAccount) return;
    const totalAmount = Number(payInv.total_amount);

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
    if (txErr) { 
      console.error('Erro Supabase (pay tx insert):', txErr);
      toast.error(txErr.message); 
      return; 
    }

    const { error: invErr } = await supabase.from("invoices").update({ status: "paid", paid_at: new Date().toISOString() }).eq("id", payInv.id);
    if (invErr) { 
      console.error('Erro Supabase (pay invoice update):', invErr);
      toast.error(invErr.message); 
      return; 
    }

    toast.success("Fatura paga ✓");
    setPayInv(null);
    qc.invalidateQueries({ queryKey: ["invoices"] });
    qc.invalidateQueries({ queryKey: ["transactions"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
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
    if (error) { 
      console.error('Erro Supabase (save invoice item):', error);
      toast.error(error.message); 
      return; 
    }
    await triggerRecompute(payInv.id);
    toast.success("Item adicionado");
    setItemDialog(false);
  };

  const openEditAdj = (adj: any) => {
    setEditingAdj(adj);
    setAdjForm({ invoice_id: adj.invoice_id, amount: String(adj.amount) });
    setAdjDialog(true);
  };

  const saveAdjustment = async () => {
    if (!user || !adjForm.invoice_id || !adjForm.amount) return;
    
    const amountNum = Number(adjForm.amount);
    const inv = invoices.find(i => i.id === adjForm.invoice_id);
    
    const payload: any = {
      user_id: user.id,
      invoice_id: adjForm.invoice_id,
      amount: amountNum,
      month_year: inv ? `${inv.reference_month}/${inv.reference_year}` : "manual"
    };

    if (editingAdj) payload.id = editingAdj.id;

    const { error } = await supabase.from("invoice_initial_balances").upsert(payload);
    
    if (error) { 
      console.error('Erro Supabase (save adjustment):', error);
      toast.error(error.message); 
      return; 
    }
    
    await triggerRecompute(adjForm.invoice_id);
    toast.success(editingAdj ? "Ajuste atualizado" : "Ajuste criado");
    setAdjDialog(false);
    setEditingAdj(null);
    qc.invalidateQueries({ queryKey: ["initial_balances"] });
  };

  const deleteAdjustment = async (adj: any) => {
    if (!confirm("Excluir este ajuste de saldo inicial? O total da fatura será recalculado.")) return;
    const { error } = await supabase.from("invoice_initial_balances").delete().eq("id", adj.id);
    if (error) { 
      console.error('Erro Supabase (delete adjustment):', error);
      toast.error(error.message); 
      return; 
    }
    
    await triggerRecompute(adj.invoice_id);
    toast.success("Ajuste excluído");
    qc.invalidateQueries({ queryKey: ["initial_balances"] });
  };

  const openInvoices = invoices.filter((i: any) => i.status !== "paid");
  const paidInvoices = invoices.filter((i: any) => i.status === "paid");

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto animate-in fade-in duration-300 space-y-10">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-2xl md:text-3xl font-bold">Faturas</h1>
          <p className="text-sm text-muted-foreground mt-1">Gerencie seus cartões de crédito e pagamentos.</p>
        </div>
        <Button onClick={() => { setEditingAdj(null); setAdjForm({ invoice_id: "", amount: "" }); setAdjDialog(true); }} variant="outline">
          <Plus className="h-4 w-4 mr-2" /> Novo Ajuste
        </Button>
      </div>

      {/* FATURAS EM ABERTO */}
      <section>
        <h2 className="font-display font-semibold mb-4 text-sm text-muted-foreground uppercase tracking-wide flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-audit-yellow" /> Em aberto ({openInvoices.length})
        </h2>
        {invLoading ? (
          <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : openInvoices.length === 0 ? (
          <div className="rounded-2xl border border-border bg-surface-1 p-10 text-center text-sm text-muted-foreground">
            Nenhuma fatura em aberto 🎉
          </div>
        ) : (
          <div className="space-y-4">
            {openInvoices.map((inv: any) => (
              <InvCard
                key={inv.id}
                inv={inv}
                onPay={() => { setPayInv(inv); setPayAccount(cashAccounts[0]?.id ?? ""); }}
                onAddItem={() => { setPayInv(inv); setItemDialog(true); setItemForm({ description: "", quantity: "1", unit_price: "" }); }}
              />
            ))}
          </div>
        )}
      </section>

      {/* LISTAGEM DE AJUSTES */}
      <section>
        <h2 className="font-display font-semibold mb-4 text-sm text-muted-foreground uppercase tracking-wide flex items-center gap-2">
          <Settings2 className="h-4 w-4" /> Ajustes de Saldo Inicial
        </h2>
        <div className="rounded-2xl border border-border bg-surface-1 overflow-hidden shadow-card">
          {adjLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : initialBalances.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">Nenhum ajuste manual lançado.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-surface-2/50 border-b border-border">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Cartão / Mês</th>
                    <th className="px-4 py-3 font-semibold">Valor do Ajuste</th>
                    <th className="px-4 py-3 font-semibold text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {initialBalances.map((adj: any) => (
                    <tr key={adj.id} className="hover:bg-surface-2/30 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-medium">{adj.invoices?.accounts?.name || "Fatura removida"}</div>
                        <div className="text-xs text-muted-foreground">
                          {adj.invoices ? `${monthNames[adj.invoices.reference_month - 1]}/${adj.invoices.reference_year}` : adj.month_year}
                        </div>
                      </td>
                      <td className="px-4 py-3 font-mono font-semibold">{formatBRL(Number(adj.amount))}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="icon" onClick={() => openEditAdj(adj)} title="Editar">
                            <Pencil className="h-4 w-4 text-muted-foreground" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => deleteAdjustment(adj)} title="Excluir">
                            <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {/* FATURAS PAGAS */}
      {paidInvoices.length > 0 && (
        <section>
          <h2 className="font-display font-semibold mb-4 text-sm text-muted-foreground uppercase tracking-wide">Histórico de Pagas</h2>
          <div className="space-y-4">
            {paidInvoices.slice(0, 6).map((inv: any) => (
              <InvCard key={inv.id} inv={inv} />
            ))}
          </div>
        </section>
      )}

      {/* MODAL PAGAMENTO */}
      <Dialog open={!!payInv && !itemDialog && !adjDialog} onOpenChange={(v) => !v && setPayInv(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Pagar fatura</DialogTitle>
            <DialogDescription>Confirme o pagamento total desta fatura.</DialogDescription>
          </DialogHeader>
          {payInv && (
            <div className="space-y-4">
              <div className="rounded-xl bg-surface-2 p-4 border border-border">
                <div className="text-xs text-muted-foreground">{payInv.accounts?.name}</div>
                <div className="font-mono tabular text-2xl font-bold mt-1">{formatBRL(Number(payInv.total_amount))}</div>
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

      {/* MODAL ITEM EXTRA */}
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

      {/* MODAL AJUSTE / SALDO INICIAL */}
      <Dialog open={adjDialog} onOpenChange={(v) => { setAdjDialog(v); if(!v) setEditingAdj(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingAdj ? "Editar Ajuste" : "Novo Saldo Inicial"}</DialogTitle>
            <DialogDescription>
              O saldo inicial é somado ao total da fatura para ajustes manuais.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {!editingAdj && (
              <div>
                <Label>Fatura de Referência</Label>
                <Select value={adjForm.invoice_id} onValueChange={(v) => setAdjForm({ ...adjForm, invoice_id: v })}>
                  <SelectTrigger className="mt-1.5"><SelectValue placeholder="Selecione a fatura" /></SelectTrigger>
                  <SelectContent>
                    {invoices.map((inv: any) => (
                      <SelectItem key={inv.id} value={inv.id}>
                        {inv.accounts?.name} ({monthNames[inv.reference_month - 1]}/{inv.reference_year})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <Label>Valor do Ajuste (R$)</Label>
              <Input 
                type="number" 
                step="0.01" 
                value={adjForm.amount} 
                onChange={(e) => setAdjForm({ ...adjForm, amount: e.target.value })} 
                className="mt-1.5" 
                placeholder="Ex: 150.00"
              />
            </div>
            <Button onClick={saveAdjustment} className="w-full">
              {editingAdj ? "Salvar Alterações" : "Criar Ajuste"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function InvCard({ inv, onPay, onAddItem }: any) {
  const [expanded, setExpanded] = useState(false);

  const { data: details } = useQuery({
    queryKey: ["invoice-details", inv.id],
    queryFn: async () => {
      const [txR, itemsR, adjR] = await Promise.all([
        supabase.from("transactions").select("*, categories(name, icon)").eq("invoice_id", inv.id).order("occurred_on"),
        supabase.from("invoice_items").select("*").eq("invoice_id", inv.id),
        supabase.from("invoice_initial_balances").select("*").eq("invoice_id", inv.id).maybeSingle(),
      ]);
      if (txR.error) console.error('Erro Supabase (fetch inv txs):', txR.error);
      if (itemsR.error) console.error('Erro Supabase (fetch inv items):', itemsR.error);
      if (adjR.error) console.error('Erro Supabase (fetch inv adj):', adjR.error);
      
      return { transactions: txR.data ?? [], items: itemsR.data ?? [], adjustment: adjR.data };
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
          <div className="mt-2 font-mono tabular text-xl font-bold">{formatBRL(Number(inv.total_amount))}</div>
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
            {onAddItem && <Button size="xs" variant="outline" onClick={onAddItem} className="h-7 text-[10px]"><Plus className="h-3 w-3 mr-1" />Item extra</Button>}
          </div>

          <div className="space-y-1">
            {details?.adjustment && (
              <div className="flex items-center justify-between py-1.5 text-sm border-b border-border/50 border-dashed">
                <span className="text-muted-foreground italic">Saldo inicial / Ajuste</span>
                <span className="font-mono tabular">{formatBRL(Number(details.adjustment.amount))}</span>
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
            {details && details.transactions.length === 0 && details.items.length === 0 && !details.adjustment && (
              <div className="text-center py-4 text-xs text-muted-foreground">Nenhum item nesta fatura.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}