"use client";

import { useState, useMemo, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { formatBRL, formatDateBR, monthNames, localDateString } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Check, CreditCard, Plus, Trash2, Pencil, ChevronDown, ChevronUp, AlertCircle, Settings2, Loader2, Archive, Clock, RotateCcw, ArrowRight, ShieldAlert, RefreshCw } from "lucide-react";
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

const TODAY_REF = "2026-05-10";

function InvoicesPage() {
  const { user } = useAuth();
  const qc = useQueryClient();

  // Modais
  const [payInv, setPayInv] = useState<any>(null);
  const [payAccount, setPayAccount] = useState("");
  const [payDate, setPayDate] = useState(localDateString());

  const [revertInv, setRevertInv] = useState<any>(null);
  const [payTxToRevert, setPayTxToRevert] = useState<any>(null);
  const [isReverting, setIsReverting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  // Itens Extras
  const [itemDialog, setItemDialog] = useState(false);
  const [editingItem, setEditingItem] = useState<any>(null);
  const [targetInvoiceForItem, setTargetInvoiceForItem] = useState<any>(null);
  const [itemForm, setItemForm] = useState({ description: "", quantity: "1", unit_price: "" });

  // Ajustes
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
        .order("due_date", { ascending: true });
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

  const { data: initialBalances = [] } = useQuery({
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

  const cashAccounts = useMemo(() => accounts.filter((a: any) => a.type !== "credit_card"), [accounts]);

  // Lógica de Organização de Faturas (CORREÇÃO: restOfUnpaid definida aqui)
  const { nextInvoice, restOfUnpaid, paidInvoices } = useMemo(() => {
    const unpaid = (invoices || []).filter((i: any) => i.status !== "paid");
    const paid = (invoices || [])
      .filter((i: any) => i.status === "paid")
      .sort((a, b) => {
        if (a.reference_year !== b.reference_year) return b.reference_year - a.reference_year;
        return b.reference_month - a.reference_month;
      });

    let next: any = null;
    let rest: any[] = [];
    if (unpaid.length > 0) {
      next = unpaid[0];
      rest = unpaid.slice(1);
    }

    return { nextInvoice: next, restOfUnpaid: rest, paidInvoices: paid };
  }, [invoices]);

  /**
   * SCRIPT DE REPARO: Remove transações de pagamento sem faturas pagas correspondentes.
   */
  const handleSyncBalances = async () => {
    setIsSyncing(true);
    toast.loading("Iniciando reparo de saldos...", { id: "repair" });
    try {
      const { data: transactions } = await supabase
        .from("transactions")
        .select("id, amount, account_id, to_account_id, description, accounts!transactions_account_id_fkey(name)")
        .eq("type", "transfer")
        .ilike("description", "Pagamento fatura%")
        .not("to_account_id", "is", null);

      if (!transactions || transactions.length === 0) {
        toast.success("Nenhum lançamento órfão detectado.", { id: "repair" });
        return;
      }

      let processedCount = 0;
      for (const tx of transactions) {
        const { data: inv } = await supabase
          .from("invoices")
          .select("id")
          .eq("account_id", tx.to_account_id)
          .eq("status", "paid")
          .eq("total_amount", tx.amount)
          .maybeSingle();

        if (!inv) {
          console.log(`[Repair] Processando órfão: ${tx.description} (R$ ${tx.amount})`);
          
          const { data: acc } = await supabase.from("accounts").select("current_balance, name").eq("id", tx.account_id).single();
          if (acc) {
            const newBal = Number(acc.current_balance) + Number(tx.amount);
            const { error: upErr } = await supabase.from("accounts").update({ current_balance: newBal }).eq("id", tx.account_id);
            
            if (!upErr) {
              await supabase.from("transactions").delete().eq("id", tx.id);
              console.info(`[Repair] SUCESSO: +${formatBRL(tx.amount)} para ${acc.name}`);
              processedCount++;
            }
          }
        }
      }

      toast.success(`Reparo concluído. ${processedCount} transações processadas.`, { id: "repair" });
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["invoices"] });
    } catch (e: any) {
      toast.error(`Falha no reparo: ${e.message}`, { id: "repair" });
    } finally {
      setIsSyncing(false);
    }
  };

  const handleOpenRevert = async (inv: any) => {
  setRevertInv(inv);

  const { data: payTx } = await supabase
    .from("transactions")
    .select("id, amount, account_id, occurred_on")
    .eq("invoice_id", inv.id)
    .eq("type", "transfer")
    .maybeSingle();

  console.log("payTx:", payTx);
  setPayTxToRevert(payTx);
};

  /**
   * REVERSÃO EXPLÍCITA: Estorno manual de saldo e exclusão de transação.
   */
  const confirmRevert = async () => {
    if (!revertInv) return;
    setIsReverting(true);
    try {
      const targetAccountId = payTxToRevert?.account_id;
      const amount = Number(revertInv.total_amount);

      // 1. ESTORNO EXPLÍCITO DE SALDO
      if (targetAccountId) {
        const { data: acc, error: fetchErr } = await supabase.from("accounts").select("current_balance, name").eq("id", targetAccountId).single();
        if (fetchErr) throw new Error("Não foi possível verificar o saldo da conta.");

        const newBalance = Number(acc.current_balance) + amount;
        const { error: upErr } = await supabase.from("accounts").update({ current_balance: newBalance }).eq("id", targetAccountId);
        
        if (upErr) throw new Error(`Falha ao atualizar saldo: ${upErr.message}`);
        console.log(`Reversão concluída: +${formatBRL(amount)} para a conta ${acc.name}`);
      }

      // 2. EXCLUSÃO DA TRANSAÇÃO
      if (payTxToRevert?.id) {
        await supabase.from("transactions").delete().eq("id", payTxToRevert.id);
      }
      
      // 3. ATUALIZA STATUS DA FATURA
      const { error: invErr } = await supabase.from("invoices").update({ status: "open", paid_at: null }).eq("id", revertInv.id);
      if (invErr) throw invErr;
      
      toast.success("Fatura revertida e saldo estornado com sucesso!");
      
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["invoices"] }),
        qc.invalidateQueries({ queryKey: ["accounts"] }),
        qc.invalidateQueries({ queryKey: ["transactions"] }),
        qc.invalidateQueries({ queryKey: ["dashboard"] })
      ]);

    } catch (e: any) {
      console.error("[Revert Error]", e);
      toast.error(`Erro na operação: ${e.message}`);
    } finally {
      setIsReverting(false);
      setRevertInv(null);
      setPayTxToRevert(null);
    }
  };

  const confirmPay = async () => {
  if (!user || !payInv || !payAccount) return;
  const amount = Number(payInv.total_amount);

  const { data: acc, error: accErr } = await supabase
    .from("accounts")
    .select("current_balance")
    .eq("id", payAccount)
    .single();
  if (accErr) { toast.error("Erro ao buscar saldo."); return; }

  await supabase
    .from("accounts")
    .update({ current_balance: Number(acc.current_balance) - amount })
    .eq("id", payAccount);

  const { error: txErr } = await supabase.from("transactions").insert({
    user_id: user.id,
    type: "transfer",
    amount,
    description: `Pagamento fatura ${payInv.accounts?.name} (${monthNames[payInv.reference_month - 1]}/${payInv.reference_year})`,
    occurred_on: payDate,
    account_id: payAccount,
    to_account_id: payInv.account_id,
    invoice_id: payInv.id, // ← vincula direto à fatura
    status: "paid",
    source: "manual",
  });
  if (txErr) { toast.error(txErr.message); return; }

  await supabase.from("invoices")
    .update({ status: "paid", paid_at: new Date(payDate + "T12:00:00").toISOString() })
    .eq("id", payInv.id);

  toast.success("Fatura paga!");
  setPayInv(null);
  qc.invalidateQueries({ queryKey: ["invoices"] });
  qc.invalidateQueries({ queryKey: ["transactions"] });
  qc.invalidateQueries({ queryKey: ["accounts"] });
  qc.invalidateQueries({ queryKey: ["dashboard"] });
};

  const triggerRecompute = async (invoiceId: string) => {
    await supabase.rpc("recompute_invoice_total", { p_invoice_id: invoiceId });
    qc.invalidateQueries({ queryKey: ["invoices"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    qc.invalidateQueries({ queryKey: ["invoice-details", invoiceId] });
  };

  const saveItem = async () => {
    if (!user || !targetInvoiceForItem || !itemForm.description || !itemForm.unit_price) return;
    const qty = Number(itemForm.quantity) || 1;
    const unit = Number(itemForm.unit_price) || 0;
    const amount = qty * unit;
    if (editingItem) {
      await supabase.from("invoice_items").update({ description: itemForm.description, quantity: qty, unit_price: unit, amount }).eq("id", editingItem.id);
      toast.success("Item atualizado");
    } else {
      await supabase.from("invoice_items").insert({ user_id: user.id, invoice_id: targetInvoiceForItem.id, description: itemForm.description, quantity: qty, unit_price: unit, amount });
      toast.success("Item adicionado");
    }
    await triggerRecompute(targetInvoiceForItem.id);
    setItemDialog(false);
    setEditingItem(null);
  };

  const deleteItem = async (item: any) => {
    if (!confirm(`Excluir item "${item.description}"?`)) return;
    await supabase.from("invoice_items").delete().eq("id", item.id);
    await triggerRecompute(item.invoice_id);
    toast.success("Item removido");
  };

  const saveAdjustment = async () => {
    if (!user || !adjForm.invoice_id || !adjForm.amount) return;
    const inv = invoices.find((i: any) => i.id === adjForm.invoice_id);
    await supabase.from("invoice_initial_balances").upsert({ user_id: user.id, invoice_id: adjForm.invoice_id, amount: Number(adjForm.amount), month_year: inv ? `${inv.reference_month}/${inv.reference_year}` : "manual", id: editingAdj?.id });
    await triggerRecompute(adjForm.invoice_id);
    toast.success("Ajuste salvo");
    setAdjDialog(false);
    setEditingAdj(null);
    qc.invalidateQueries({ queryKey: ["initial_balances"] });
  };

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto animate-in fade-in duration-300 space-y-8">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-2xl md:text-3xl font-bold">Faturas</h1>
          <p className="text-sm text-muted-foreground mt-1">Gerencie seus cartões de crédito e pagamentos.</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={handleSyncBalances} disabled={isSyncing} variant="secondary" size="sm" className="h-10">
            <RefreshCw className={cn("h-4 w-4 mr-2", isSyncing && "animate-spin")} /> Sincronizar Saldos
          </Button>
          <Button onClick={() => { setEditingAdj(null); setAdjForm({ invoice_id: "", amount: "" }); setAdjDialog(true); }} variant="outline" size="sm" className="h-10">
            <Plus className="h-4 w-4 mr-2" /> Novo Ajuste
          </Button>
        </div>
      </div>

      <Tabs defaultValue="pending" className="w-full">
        <TabsList className="grid w-full grid-cols-2 max-w-md mb-8">
          <TabsTrigger value="pending" className="flex items-center gap-2">
            <Clock className="h-4 w-4" /> Pendentes
          </TabsTrigger>
          <TabsTrigger value="archive" className="flex items-center gap-2">
            <Archive className="h-4 w-4" /> Pagas (Arquivo)
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pending" className="space-y-10">
          <section>
            <h2 className="font-display font-semibold mb-4 text-xs text-muted-foreground uppercase tracking-widest flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-primary" /> Próxima Fatura a Vencer
            </h2>
            {invLoading ? (
              <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            ) : !nextInvoice ? (
              <div className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">Nenhuma fatura pendente 🎉</div>
            ) : (
              <InvCard
                inv={nextInvoice}
                isNext={true}
                onPay={() => { setPayInv(nextInvoice); setPayAccount(cashAccounts[0]?.id ?? ""); }}
                onAddItem={() => { setTargetInvoiceForItem(nextInvoice); setEditingItem(null); setItemDialog(true); setItemForm({ description: "", quantity: "1", unit_price: "" }); }}
                onEditItem={(item: any) => { setEditingItem(item); setTargetInvoiceForItem(nextInvoice); setItemForm({ description: item.description, quantity: String(item.quantity), unit_price: String(item.unit_price) }); setItemDialog(true); }}
                onDeleteItem={deleteItem}
              />
            )}
          </section>

          {(restOfUnpaid || []).length > 0 && (
            <section>
              <h2 className="font-display font-semibold mb-4 text-xs text-muted-foreground uppercase tracking-widest">Outras Faturas Pendentes</h2>
              <div className="space-y-4">
                {restOfUnpaid.map((inv: any) => (
                  <InvCard
                    key={inv.id}
                    inv={inv}
                    onPay={() => { setPayInv(inv); setPayAccount(cashAccounts[0]?.id ?? ""); }}
                    onAddItem={() => { setTargetInvoiceForItem(inv); setEditingItem(null); setItemDialog(true); setItemForm({ description: "", quantity: "1", unit_price: "" }); }}
                    onEditItem={(item: any) => { setEditingItem(item); setTargetInvoiceForItem(inv); setItemForm({ description: item.description, quantity: String(item.quantity), unit_price: String(item.unit_price) }); setItemDialog(true); }}
                    onDeleteItem={deleteItem}
                  />
                ))}
              </div>
            </section>
          )}

          <section className="pt-6 border-t border-border/50">
            <h2 className="font-display font-semibold mb-4 text-xs text-muted-foreground uppercase tracking-widest flex items-center gap-2">
              <Settings2 className="h-4 w-4" /> Ajustes de Saldo Inicial
            </h2>
            <div className="rounded-2xl border border-border bg-surface-1 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="bg-surface-2/50 border-b border-border">
                    <tr>
                      <th className="px-4 py-3">Cartão / Mês</th>
                      <th className="px-4 py-3">Valor</th>
                      <th className="px-4 py-3 text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {(initialBalances || []).map((adj: any) => (
                      <tr key={adj.id}>
                        <td className="px-4 py-3">
                          <div className="font-medium">{adj.invoices?.accounts?.name}</div>
                          <div className="text-xs text-muted-foreground">{monthNames[adj.invoices.reference_month - 1]}/{adj.invoices.reference_year}</div>
                        </td>
                        <td className="px-4 py-3 font-mono font-semibold">{formatBRL(Number(adj.amount))}</td>
                        <td className="px-4 py-3 text-right">
                          <Button variant="ghost" size="icon" onClick={() => { setEditingAdj(adj); setAdjForm({ invoice_id: adj.invoice_id, amount: String(adj.amount) }); setAdjDialog(true); }}><Pencil className="h-4 w-4" /></Button>
                          <Button variant="ghost" size="icon" onClick={() => { if (confirm("Excluir?")) { supabase.from("invoice_initial_balances").delete().eq("id", adj.id).then(() => { triggerRecompute(adj.invoice_id); qc.invalidateQueries({ queryKey: ["initial_balances"] }); }); } }}><Trash2 className="h-4 w-4 hover:text-destructive" /></Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </TabsContent>

        <TabsContent value="archive" className="space-y-4">
          {(paidInvoices || []).length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">Nenhuma fatura paga.</div>
          ) : (
            paidInvoices.map((inv: any) => (
              <InvCard
                key={inv.id}
                inv={inv}
                onRevert={() => handleOpenRevert(inv)}
                onEditItem={(item: any) => { setEditingItem(item); setTargetInvoiceForItem(inv); setItemForm({ description: item.description, quantity: String(item.quantity), unit_price: String(item.unit_price) }); setItemDialog(true); }}
                onDeleteItem={deleteItem}
              />
            ))
          )}
        </TabsContent>
      </Tabs>

      {/* MODAL: REVERTER PAGAMENTO */}
      <Dialog open={!!revertInv} onOpenChange={(v) => !v && setRevertInv(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-audit-red">
              <ShieldAlert className="h-5 w-5" /> Confirmar Estorno Explícito
            </DialogTitle>
            <DialogDescription>
              A fatura de <strong>{revertInv?.accounts?.name}</strong> será movida de volta para pendentes e o saldo bancário será corrigido.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="rounded-xl bg-surface-2 p-4 border border-border shadow-inner">
              <div className="text-[10px] text-muted-foreground uppercase tracking-widest mb-1">Valor a ser Devolvido</div>
              <div className="font-mono font-bold text-2xl text-audit-green">+{formatBRL(revertInv?.total_amount)}</div>
              {payTxToRevert ? (
                <div className="mt-2 text-xs flex items-center gap-1.5 text-muted-foreground">
                  <ArrowRight className="h-3 w-3" /> Conta de Estorno: <span className="font-semibold text-foreground">{payTxToRevert.accounts?.name}</span>
                </div>
              ) : (
                <div className="mt-2 text-xs text-audit-yellow flex items-center gap-1.5 bg-audit-yellow/10 p-2 rounded border border-audit-yellow/20">
                  <AlertCircle className="h-3 w-3 shrink-0" /> Aviso: Lançamento órfão. O estorno será realizado na conta que foi utilizada no pagamento original.
                </div>
              )}
            </div>
            
            <p className="text-xs text-muted-foreground leading-relaxed italic">
              * Nota: Esta operação é atômica e manual. O lançamento de saída será deletado e o saldo será incrementado via código para garantir a precisão.
            </p>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="ghost" onClick={() => setRevertInv(null)}>Cancelar</Button>
            <Button variant="destructive" onClick={confirmRevert} disabled={isReverting} className="shadow-glow-red">
              {isReverting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RotateCcw className="h-4 w-4 mr-2" />}
              Confirmar e Estornar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
      <Dialog open={itemDialog} onOpenChange={(v) => { setItemDialog(v); if(!v) {setEditingItem(null); setTargetInvoiceForItem(null);} }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingItem ? "Editar item" : "Adicionar item"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div><Label>Descrição</Label><Input value={itemForm.description} onChange={(e) => setItemForm({ ...itemForm, description: e.target.value })} className="mt-1.5" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Quantidade</Label><Input type="number" value={itemForm.quantity} onChange={(e) => setItemForm({ ...itemForm, quantity: e.target.value })} className="mt-1.5" /></div>
              <div><Label>Valor unitário</Label><Input type="number" step="0.01" value={itemForm.unit_price} onChange={(e) => setItemForm({ ...itemForm, unit_price: e.target.value })} className="mt-1.5" /></div>
            </div>
            <Button onClick={saveItem} className="w-full">{editingItem ? "Salvar" : "Adicionar"}</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* MODAL: AJUSTE */}
      <Dialog open={adjDialog} onOpenChange={(v) => { setAdjDialog(v); if (!v) setEditingAdj(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Ajuste de Saldo Inicial</DialogTitle></DialogHeader>
          <div className="space-y-4">
            {!editingAdj && (
              <div>
                <Label>Fatura</Label>
                <Select value={adjForm.invoice_id} onValueChange={(v) => setAdjForm({ ...adjForm, invoice_id: v })}>
                  <SelectTrigger className="mt-1.5"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                  <SelectContent>
                    {invoices.map((inv: any) => (
                      <SelectItem key={inv.id} value={inv.id}>{inv.accounts?.name} ({monthNames[inv.reference_month - 1]}/{inv.reference_year})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div><Label>Valor (R$)</Label><Input type="number" step="0.01" value={adjForm.amount} onChange={(e) => setAdjForm({ ...adjForm, amount: e.target.value })} className="mt-1.5" /></div>
            <Button onClick={saveAdjustment} className="w-full">Salvar Ajuste</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function InvCard({ inv, isNext, onPay, onAddItem, onRevert, onEditItem, onDeleteItem }: any) {
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
  const due = new Date(inv.due_date + "T12:00:00");
  const refDate = new Date(TODAY_REF + "T12:00:00");
  const daysDiff = Math.ceil((due.getTime() - refDate.getTime()) / (1000 * 60 * 60 * 24));
  const isOverdue = daysDiff < 0;

  return (
    <div className={cn(
      "rounded-2xl border bg-surface-1 overflow-hidden shadow-card transition-all",
      isNext ? "border-primary/40 shadow-[0_0_0_1px_hsl(var(--primary)/0.2)]" : "border-border"
    )}>
      {isNext && (
        <div className="bg-primary/10 border-b border-primary/20 px-4 py-1.5 flex items-center justify-between">
          <span className="text-[11px] font-semibold text-primary uppercase tracking-widest flex items-center gap-2">
            <Clock className="h-3 w-3" /> Próximo Vencimento
          </span>
          {isOverdue && <span className="text-[10px] px-2 py-0.5 rounded-full bg-audit-red/20 text-audit-red font-bold">VENCIDA</span>}
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
          {!isPaid ? (
            <Button size="sm" onClick={onPay} className="shadow-glow"><Check className="h-3.5 w-3.5 mr-1.5" />Pagar</Button>
          ) : (
            <Button size="sm" variant="outline" onClick={onRevert} className="text-muted-foreground hover:text-foreground"><RotateCcw className="h-3.5 w-3.5 mr-1.5" />Reverter</Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setExpanded(!expanded)}>{expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</Button>
        </div>
      </div>
      {expanded && (
        <div className="border-t border-border bg-surface-2/30 p-4 space-y-4 animate-in slide-in-from-top-2 duration-200">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Detalhamento</h3>
            {onAddItem && !isPaid && <Button size="sm" variant="outline" onClick={onAddItem} className="h-7 text-[10px]"><Plus className="h-3 w-3 mr-1" />Item extra</Button>}
          </div>
          <div className="space-y-1">
            {details?.adjustment && (
              <div className="flex items-center justify-between py-1.5 text-sm border-b border-border/50 border-dashed">
                <span className="text-muted-foreground italic">Saldo inicial / Ajuste</span>
                <span className="font-mono tabular">{formatBRL(Number(details.adjustment.amount))}</span>
              </div>
            )}
            {(details?.transactions || []).map((t: any) => (
              <div key={t.id} className="flex items-center justify-between py-1.5 text-sm">
                <div className="flex items-center gap-2 truncate">
                  <span className="text-xs text-muted-foreground">{formatDateBR(t.occurred_on).slice(0, 5)}</span>
                  <span className="truncate">{t.description}</span>
                </div>
                <span className="font-mono tabular">{formatBRL(Number(t.amount))}</span>
              </div>
            ))}
            {(details?.items || []).map((it: any) => (
              <div key={it.id} className="group flex items-center justify-between py-1.5 text-sm text-primary">
                <div className="flex items-center gap-2 truncate">
                  <span className="text-[10px] px-1 rounded bg-primary/10">EXTRA</span>
                  <span className="truncate">{it.description} {it.quantity > 1 ? `(x${it.quantity})` : ""}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono tabular">{formatBRL(Number(it.amount))}</span>
                  {!isPaid && (
                    <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-primary hover:bg-primary/10" onClick={() => onEditItem(it)}><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:bg-destructive/10" onClick={() => onDeleteItem(it)}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                  )}
                </div>
              </div>
            ))}
            {!details && <div className="text-center py-4 text-xs text-muted-foreground">Carregando...</div>}
          </div>
        </div>
      )}
    </div>
  );
}