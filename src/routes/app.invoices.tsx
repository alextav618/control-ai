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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Check, CreditCard, Plus, Trash2, Pencil, ChevronDown, ChevronUp, AlertCircle, Settings2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/app/invoices")({
  component: InvoicesPage,
});

const STATUS_LABEL: Record<string, string> = {
  open: "Em aberto",
  closed: "Fechada",
  paid: "Paga",
};

const STATUS_COLOR: Record<string, string> = {
  open: "text-audit-yellow border-audit-yellow/30 bg-audit-yellow/10",
  closed: "text-primary border-primary/30 bg-primary/10",
  paid: "text-income border-income/30 bg-income/10",
};

function InvoicesPage() {
  const { user } = useAuth();
  const qc = useQueryClient();

  // Estados de Modais
  const [payInv, setPayInv] = useState<any>(null);
  const [payAccount, setPayAccount] = useState("");
  const [payDate, setPayDate] = useState(localDateString());

  const [editPayInv, setEditPayInv] = useState<any>(null);
  const [editPayAccount, setEditPayAccount] = useState("");
  const [editPayDate, setEditPayDate] = useState("");
  const [editPayDialog, setEditPayDialog] = useState(false);

  const [itemDialog, setItemDialog] = useState(false);
  const [targetInvoiceForItem, setTargetInvoiceForItem] = useState<any>(null);
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
        .select("*, accounts!inner(name, type, archived, current_balance)")
        .eq("accounts.archived", false)
        .gt("total_amount", 0)
        .order("reference_year", { ascending: true })
        .order("reference_month", { ascending: true });
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

  const { data: initialBalances = [], isLoading: adjLoading } = useQuery({
    queryKey: ["initial_balances", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoice_initial_balances")
        .select("*, invoices(reference_month, reference_year, accounts(name))")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const cashAccounts = accounts.filter((a: any) => a.type !== "credit_card");

  // Ações
  const triggerRecompute = async (invoiceId: string) => {
    await supabase.rpc("recompute_invoice_total", { p_invoice_id: invoiceId });
    qc.invalidateQueries({ queryKey: ["invoices"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    qc.invalidateQueries({ queryKey: ["invoice-details", invoiceId] });
  };

  const confirmPay = async () => {
    if (!user || !payInv || !payAccount) return;
    
    const { error: txErr } = await supabase.from("transactions").insert({
      user_id: user.id,
      type: "transfer",
      amount: Number(payInv.total_amount),
      description: `Pagamento fatura ${payInv.accounts?.name} (${monthNames[payInv.reference_month - 1]}/${payInv.reference_year})`,
      occurred_on: payDate,
      account_id: payAccount,
      to_account_id: payInv.account_id,
      status: "paid",
      source: "manual",
    });

    if (txErr) { toast.error(txErr.message); return; }

    await supabase.from("invoices").update({ 
      status: "paid", 
      paid_at: new Date(payDate + "T12:00:00").toISOString() 
    }).eq("id", payInv.id);

    toast.success("Fatura paga ✓");
    setPayInv(null);
    qc.invalidateQueries({ queryKey: ["invoices"] });
    qc.invalidateQueries({ queryKey: ["transactions"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  };

  const deletePayment = async (inv: any) => {
    if (!confirm(`Desfazer pagamento da fatura ${inv.accounts?.name} (${monthNames[inv.reference_month - 1]}/${inv.reference_year})?`)) return;

    const { data: payTx } = await supabase
      .from("transactions")
      .select("id")
      .eq("to_account_id", inv.account_id)
      .eq("type", "transfer")
      .eq("amount", inv.total_amount)
      .maybeSingle();

    if (payTx) {
      await supabase.from("transactions").delete().eq("id", payTx.id);
    }

    await supabase.from("invoices").update({ status: "open", paid_at: null }).eq("id", inv.id);
    
    toast.success("Pagamento desfeito — fatura reaberta");
    qc.invalidateQueries({ queryKey: ["invoices"] });
    qc.invalidateQueries({ queryKey: ["transactions"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  };

  const openEditPayment = async (inv: any) => {
    const { data: payTx } = await supabase
      .from("transactions")
      .select("id, account_id, occurred_on")
      .eq("to_account_id", inv.account_id)
      .eq("type", "transfer")
      .eq("amount", inv.total_amount)
      .maybeSingle();

    setEditPayInv({ ...inv, payTxId: payTx?.id });
    setEditPayAccount(payTx?.account_id ?? cashAccounts[0]?.id ?? "");
    setEditPayDate(payTx?.occurred_on ?? localDateString());
    setEditPayDialog(true);
  };

  const confirmEditPayment = async () => {
    if (!editPayInv) return;
    if (editPayInv.payTxId) {
      const { error } = await supabase
        .from("transactions")
        .update({ account_id: editPayAccount, occurred_on: editPayDate })
        .eq("id", editPayInv.payTxId);
      if (error) { toast.error(error.message); return; }
    }
    
    await supabase.from("invoices").update({ 
      paid_at: new Date(editPayDate + "T12:00:00").toISOString() 
    }).eq("id", editPayInv.id);

    toast.success("Pagamento atualizado!");
    setEditPayDialog(false);
    setEditPayInv(null);
    qc.invalidateQueries({ queryKey: ["invoices"] });
    qc.invalidateQueries({ queryKey: ["transactions"] });
  };

  const saveItem = async () => {
    if (!user || !targetInvoiceForItem || !itemForm.description || !itemForm.unit_price) return;
    const qty = Number(itemForm.quantity) || 1;
    const unit = Number(itemForm.unit_price) || 0;
    
    const { error } = await supabase.from("invoice_items").insert({
      user_id: user.id,
      invoice_id: targetInvoiceForItem.id,
      description: itemForm.description,
      quantity: qty,
      unit_price: unit,
      amount: qty * unit,
    });

    if (error) { toast.error(error.message); return; }
    await triggerRecompute(targetInvoiceForItem.id);
    toast.success("Item adicionado");
    setItemDialog(false);
    setTargetInvoiceForItem(null);
  };

  const saveAdjustment = async () => {
    if (!user || !adjForm.invoice_id || !adjForm.amount) return;
    const inv = invoices.find((i: any) => i.id === adjForm.invoice_id);
    
    const payload: any = {
      user_id: user.id,
      invoice_id: adjForm.invoice_id,
      amount: Number(adjForm.amount),
      month_year: inv ? `${inv.reference_month}/${inv.reference_year}` : "manual",
    };
    if (editingAdj) payload.id = editingAdj.id;

    const { error } = await supabase.from("invoice_initial_balances").upsert(payload);
    if (error) { toast.error(error.message); return; }
    
    await triggerRecompute(adjForm.invoice_id);
    toast.success(editingAdj ? "Ajuste atualizado" : "Ajuste criado");
    setAdjDialog(false);
    setEditingAdj(null);
    qc.invalidateQueries({ queryKey: ["initial_balances"] });
  };

  const deleteAdjustment = async (adj: any) => {
    if (!confirm("Excluir este ajuste?")) return;
    const { error } = await supabase.from("invoice_initial_balances").delete().eq("id", adj.id);
    if (error) { toast.error(error.message); return; }
    await triggerRecompute(adj.invoice_id);
    toast.success("Ajuste excluído");
    qc.invalidateQueries({ queryKey: ["initial_balances"] });
  };

  const unpaidInvoices = invoices.filter((i: any) => i.status !== "paid");
  const paidInvoices = invoices.filter((i: any) => i.status === "paid").reverse();

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

      {/* SEÇÃO: EM ABERTO */}
      <section>
        <h2 className="font-display font-semibold mb-4 text-sm text-muted-foreground uppercase tracking-wide flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-audit-yellow" /> Em aberto / Fechadas ({unpaidInvoices.length})
        </h2>
        {invLoading ? (
          <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : unpaidInvoices.length === 0 ? (
          <div className="rounded-2xl border border-border bg-surface-1 p-10 text-center text-sm text-muted-foreground">Nenhuma fatura pendente 🎉</div>
        ) : (
          <div className="space-y-4">
            {unpaidInvoices.map((inv: any, index: number) => (
              <InvCard
                key={inv.id}
                inv={inv}
                isNext={index === 0}
                onPay={() => { setPayInv(inv); setPayAccount(cashAccounts[0]?.id ?? ""); }}
                onAddItem={() => { setTargetInvoiceForItem(inv); setItemDialog(true); setItemForm({ description: "", quantity: "1", unit_price: "" }); }}
              />
            ))}
          </div>
        )}
      </section>

      {/* SEÇÃO: AJUSTES */}
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
                    <th className="px-4 py-3 font-semibold">Valor</th>
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
                      <td className="px-4 py-3 text-right flex justify-end gap-1">
                        <Button variant="ghost" size="icon" onClick={() => { setEditingAdj(adj); setAdjForm({ invoice_id: adj.invoice_id, amount: String(adj.amount) }); setAdjDialog(true); }}><Pencil className="h-4 w-4 text-muted-foreground" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => deleteAdjustment(adj)}><Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" /></Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {/* SEÇÃO: PAGAS */}
      {paidInvoices.length > 0 && (
        <section>
          <h2 className="font-display font-semibold mb-4 text-sm text-muted-foreground uppercase tracking-wide">Histórico de Pagas ({paidInvoices.length})</h2>
          <div className="space-y-4">
            {paidInvoices.map((inv: any) => (
              <InvCard
                key={inv.id}
                inv={inv}
                onDeletePayment={() => deletePayment(inv)}
                onEditPayment={() => openEditPayment(inv)}
              />
            ))}
          </div>
        </section>
      )}

      {/* MODAL: PAGAR */}
      <Dialog open={!!payInv} onOpenChange={(v) => !v && setPayInv(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Pagar fatura</DialogTitle></DialogHeader>
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

      {/* MODAL: ITEM EXTRA */}
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

      {/* MODAL: AJUSTE */}
      <Dialog open={adjDialog} onOpenChange={(v) => { setAdjDialog(v); if (!v) setEditingAdj(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingAdj ? "Editar Ajuste" : "Novo Saldo Inicial"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            {!editingAdj && (
              <div>
                <Label>Fatura de Referência</Label>
                <Select value={adjForm.invoice_id} onValueChange={(v) => setAdjForm({ ...adjForm, invoice_id: v })}>
                  <SelectTrigger className="mt-1.5"><SelectValue placeholder="Selecione a fatura" /></SelectTrigger>
                  <SelectContent>
                    {invoices.map((inv: any) => (
                      <SelectItem key={inv.id} value={inv.id}>{inv.accounts?.name} ({monthNames[inv.reference_month - 1]}/{inv.reference_year})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <Label>Valor do Ajuste (R$)</Label>
              <Input type="number" step="0.01" value={adjForm.amount} onChange={(e) => setAdjForm({ ...adjForm, amount: e.target.value })} className="mt-1.5" />
            </div>
            <Button onClick={saveAdjustment} className="w-full">{editingAdj ? "Salvar Alterações" : "Criar Ajuste"}</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* MODAL: EDITAR PAGAMENTO */}
      <Dialog open={editPayDialog} onOpenChange={setEditPayDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Editar pagamento</DialogTitle></DialogHeader>
          {editPayInv && (
            <div className="space-y-4">
              <div className="rounded-xl bg-surface-2 p-4 border border-border">
                <div className="text-xs text-muted-foreground">{editPayInv.accounts?.name} · {monthNames[editPayInv.reference_month - 1]}/{editPayInv.reference_year}</div>
                <div className="font-mono tabular text-2xl font-bold mt-1">{formatBRL(Number(editPayInv.total_amount))}</div>
              </div>
              <div>
                <Label>Pagar com</Label>
                <Select value={editPayAccount} onValueChange={setEditPayAccount}>
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
                <Input type="date" value={editPayDate} onChange={(e) => setEditPayDate(e.target.value)} className="mt-1.5" />
              </div>
              <Button onClick={confirmEditPayment} className="w-full"><Check className="h-4 w-4 mr-2" />Salvar alterações</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function InvCard({ inv, isNext, onPay, onAddItem, onEditPayment, onDeletePayment }: any) {
  const [expanded, setExpanded] = useState(false);

  const { data: details } = useQuery({
    queryKey: ["invoice-details", inv.id],
    queryFn: async () => {
      const [txR, itemsR, adjR] = await Promise.all([
        supabase.from("transactions").select("*, categories(name, icon)").eq("invoice_id", inv.id).order("occurred_on"),
        supabase.from("invoice_items").select("*").eq("invoice_id", inv.id),
        supabase.from("invoice_initial_balances").select("*").eq("invoice_id", inv.id).maybeSingle(),
      ]);
      return { transactions: txR.data ?? [], items: itemsR.data ?? [], adjustment: adjR.data };
    },
    enabled: expanded,
  });

  const isPaid = inv.status === "paid";

  return (
    <div className={cn(
      "rounded-2xl border bg-surface-1 overflow-hidden shadow-card transition-all",
      isNext ? "border-primary/40 shadow-[0_0_0_1px_hsl(var(--primary)/0.2)]" : "border-border"
    )}>
      {isNext && (
        <div className="bg-primary/10 border-b border-primary/20 px-4 py-1.5 flex items-center gap-2">
          <span className="text-[11px] font-semibold text-primary uppercase tracking-wider">⚡ Próxima a pagar</span>
        </div>
      )}

      <div className="p-4 flex items-start gap-4">
        <div className="h-10 w-10 rounded-lg bg-surface-2 flex items-center justify-center shrink-0">
          <CreditCard className="h-5 w-5 text-primary" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="font-display font-bold text-base">{inv.accounts?.name}</div>
          <div className="mt-1 flex items-center gap-2 flex-wrap">
            <span className="text-lg font-bold text-foreground">{monthNames[inv.reference_month - 1]}</span>
            <span className="text-sm text-muted-foreground font-medium">{inv.reference_year}</span>
            <span className={cn("text-[11px] px-2 py-0.5 rounded-full border font-semibold", STATUS_COLOR[inv.status])}>
              {STATUS_LABEL[inv.status]}
            </span>
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            vence {formatDateBR(inv.due_date)}
            {inv.paid_at && <span className="ml-2">· pago em {formatDateBR(inv.paid_at.slice(0, 10))}</span>}
          </div>
          <div className="mt-2 font-mono tabular text-2xl font-bold">{formatBRL(Number(inv.total_amount))}</div>
        </div>

        <div className="flex flex-col gap-2 shrink-0">
          {!isPaid && onPay && <Button size="sm" onClick={onPay}><Check className="h-3.5 w-3.5 mr-1.5" />Pagar</Button>}
          {isPaid && onEditPayment && <Button size="sm" variant="outline" onClick={onEditPayment}><Pencil className="h-3.5 w-3.5" /></Button>}
          {isPaid && onDeletePayment && <Button size="sm" variant="ghost" onClick={onDeletePayment}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>}
          <Button size="sm" variant="ghost" onClick={() => setExpanded(!expanded)}>{expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</Button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border bg-surface-2/30 p-4 space-y-4 animate-in slide-in-from-top-2 duration-200">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Detalhamento</h3>
            {onAddItem && <Button size="sm" variant="outline" onClick={onAddItem} className="h-7 text-[10px]"><Plus className="h-3 w-3 mr-1" />Item extra</Button>}
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
                <div className="flex items-center gap-2 truncate">
                  <span className="text-xs text-muted-foreground">{formatDateBR(t.occurred_on).slice(0, 5)}</span>
                  <span className="truncate">{t.description}</span>
                </div>
                <span className="font-mono tabular">{formatBRL(Number(t.amount))}</span>
              </div>
            ))}
            {details?.items.map((it: any) => (
              <div key={it.id} className="flex items-center justify-between py-1.5 text-sm text-primary">
                <div className="flex items-center gap-2 truncate">
                  <span className="text-[10px] px-1 rounded bg-primary/10">EXTRA</span>
                  <span className="truncate">{it.description} {it.quantity > 1 ? `(x${it.quantity})` : ""}</span>
                </div>
                <span className="font-mono tabular">{formatBRL(Number(it.amount))}</span>
              </div>
            ))}
            {!details && <div className="text-center py-4 text-xs text-muted-foreground">Carregando...</div>}
          </div>
        </div>
      )}
    </div>
  );
}