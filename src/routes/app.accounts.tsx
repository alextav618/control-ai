import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { formatBRL } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Plus, CreditCard, Wallet, PiggyBank, Coins, Trash2, Pencil, ArrowRightLeft, Banknote } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/accounts")({
  component: AccountsPage,
});

const accountTypes = [
  { value: "checking", label: "Conta Corrente", icon: Banknote },
  { value: "savings", label: "Poupança", icon: PiggyBank },
  { value: "credit_card", label: "Cartão de Crédito", icon: CreditCard },
  { value: "cash", label: "Dinheiro (Carteira)", icon: Coins },
  { value: "voucher", label: "Vale Alimentação/Refeição", icon: Wallet },
  { value: "other", label: "Outro", icon: Wallet },
];

const emptyForm = { name: "", type: "checking", current_balance: "0", closing_day: "", due_day: "", credit_limit: "" };

function AccountsPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<any>(emptyForm);
  const [confirmDel, setConfirmDel] = useState<any>(null);
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferForm, setTransferForm] = useState({ from_account: "", to_account: "", amount: "" });

  useEffect(() => { if (!open) { setEditId(null); setForm(emptyForm); } }, [open]);

  const { data: accounts = [] } = useQuery({
    queryKey: ["accounts", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("accounts").select("*").eq("archived", false).order("created_at");
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const openEdit = (a: any) => {
    setEditId(a.id);
    setForm({
      name: a.name,
      type: a.type,
      current_balance: String(a.current_balance ?? "0"),
      closing_day: a.closing_day ? String(a.closing_day) : "",
      due_day: a.due_day ? String(a.due_day) : "",
      credit_limit: a.credit_limit ? String(a.credit_limit) : "",
    });
    setOpen(true);
  };

  const submit = async () => {
    if (!user || !form.name) { toast.error("Informe o nome"); return; }
    const payload: any = {
      name: form.name,
      type: form.type,
      current_balance: Number(form.current_balance) || 0,
    };
    if (form.type === "credit_card") {
      payload.closing_day = Number(form.closing_day) || 1;
      payload.due_day = Number(form.due_day) || 10;
      payload.credit_limit = form.credit_limit ? Number(form.credit_limit) : null;
    } else {
      payload.closing_day = null;
      payload.due_day = null;
      payload.credit_limit = null;
    }

    if (editId) {
      const { error } = await supabase.from("accounts").update(payload).eq("id", editId);
      if (error) { toast.error(error.message); return; }
      toast.success("Conta atualizada");
    } else {
      const { error } = await supabase.from("accounts").insert({ user_id: user.id, ...payload });
      if (error) { toast.error(error.message); return; }
      toast.success("Conta criada");
    }
    setOpen(false);
    qc.invalidateQueries({ queryKey: ["accounts"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    qc.invalidateQueries({ queryKey: ["invoices"] });
  };

  const confirmRemove = async () => {
    if (!confirmDel) return;
    const { error } = await supabase.from("accounts").update({ archived: true }).eq("id", confirmDel.id);
    if (error) toast.error(error.message);
    else {
      toast.success("Conta excluída");
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["invoices"] });
    }
    setConfirmDel(null);
  };

  const initiateTransfer = () => {
    setTransferForm({ from_account: "", to_account: "", amount: "" });
    setTransferOpen(true);
  };

  const executeTransfer = async () => {
    if (!user || !transferForm.from_account || !transferForm.to_account || !transferForm.amount) {
      toast.error("Preencha todos os campos");
      return;
    }

    const fromAcc = accounts.find(a => a.id === transferForm.from_account);
    const toAcc = accounts.find(a => a.id === transferForm.to_account);
    const amount = Number(transferForm.amount);

    if (!fromAcc || !toAcc) {
      toast.error("Contas inválidas");
      return;
    }

    if (fromAcc.current_balance < amount) {
      toast.error("Saldo insuficiente na conta de origem");
      return;
    }

    // Create transfer transaction
    const { error: txError } = await supabase.from("transactions").insert({
      user_id: user.id,
      type: "transfer",
      amount: amount,
      description: `Transferência: ${fromAcc.name} → ${toAcc.name}`,
      occurred_on: new Date().toISOString().slice(0, 10),
      account_id: fromAcc.id,
      transfer_from_account_id: fromAcc.id,
      transfer_to_account_id: toAcc.id,
      status: "paid",
      source: "manual",
    });

    if (txError) {
      toast.error("Erro ao criar transferência");
      return;
    }

    // Update account balances
    await supabase.from("accounts").update({ current_balance: Number(fromAcc.current_balance) - amount }).eq("id", fromAcc.id);
    await supabase.from("accounts").update({ current_balance: Number(toAcc.current_balance) + amount }).eq("id", toAcc.id);

    toast.success("Transferência realizada com sucesso");
    setTransferOpen(false);
    qc.invalidateQueries({ queryKey: ["accounts"] });
    qc.invalidateQueries({ queryKey: ["transactions"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  };

  // Group accounts by category for UI
  const bankAccounts = accounts.filter(a => a.type === "checking" || a.type === "savings");
  const creditCards = accounts.filter(a => a.type === "credit_card");
  const cashAccounts = accounts.filter(a => a.type === "cash");
  const voucherAccounts = accounts.filter(a => a.type === "voucher");
  const otherAccounts = accounts.filter(a => a.type === "other");

  const totalAvailable = accounts
    .filter(a => a.type !== "credit_card")
    .reduce((sum, a) => sum + Number(a.current_balance), 0);

  const totalObligations = accounts
    .filter(a => a.type === "credit_card")
    .reduce((sum, a) => sum + Number(a.current_balance), 0);

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto animate-in fade-in duration-300">
      <div className="flex items-center justify-between mb-6 gap-3">
        <h1 className="font-display text-2xl md:text-3xl font-bold">Contas e Cartões</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={initiateTransfer}><ArrowRightLeft className="h-4 w-4 mr-2" />Transferir</Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-2" />Nova</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{editId ? "Editar conta" : "Nova conta ou cartão"}</DialogTitle>
                <DialogDescription>{editId ? "Atualize os dados da conta." : "Cadastre uma conta ou cartão para vincular aos lançamentos."}</DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div><Label>Nome</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ex: Nubank Crédito" className="mt-1.5" /></div>
                <div><Label>Tipo</Label>
                  <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                    <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {accountTypes.map((t) => (
                        <SelectItem key={t.value} value={t.value}>
                          <div className="flex items-center gap-2">
                            <t.icon className="h-4 w-4" />
                            {t.label}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {form.type === "credit_card" ? (
                  <div className="grid grid-cols-3 gap-3">
                    <div><Label>Fecha dia</Label><Input type="number" min={1} max={31} value={form.closing_day} onChange={(e) => setForm({ ...form, closing_day: e.target.value })} className="mt-1.5" /></div>
                    <div><Label>Vence dia</Label><Input type="number" min={1} max={31} value={form.due_day} onChange={(e) => setForm({ ...form, due_day: e.target.value })} className="mt-1.5" /></div>
                    <div><Label>Limite</Label><Input type="number" value={form.credit_limit} onChange={(e) => setForm({ ...form, credit_limit: e.target.value })} className="mt-1.5" /></div>
                  </div>
                ) : (
                  <div><Label>Saldo atual</Label><Input type="number" step="0.01" value={form.current_balance} onChange={(e) => setForm({ ...form, current_balance: e.target.value })} className="mt-1.5" /></div>
                )}
                <Button onClick={submit} className="w-full">{editId ? "Salvar alterações" : "Criar"}</Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-6">
        <div className="rounded-2xl border border-border bg-surface-1 p-4 md:p-5 shadow-card">
          <div className="text-xs text-muted-foreground flex items-center gap-1">
            <Banknote className="h-3 w-3" />
            Disponível
          </div>
          <div className="font-mono tabular text-xl md:text-2xl font-semibold text-income mt-1">{formatBRL(totalAvailable)}</div>
        </div>
        <div className="rounded-2xl border border-border bg-surface-1 p-4 md:p-5 shadow-card">
          <div className="text-xs text-muted-foreground flex items-center gap-1">
            <CreditCard className="h-3 w-3" />
            Obrigações
          </div>
          <div className="font-mono tabular text-xl md:text-2xl font-semibold text-expense mt-1">{formatBRL(totalObligations)}</div>
        </div>
        <div className="rounded-2xl border border-border bg-surface-1 p-4 md:p-5 shadow-card">
          <div className="text-xs text-muted-foreground flex items-center gap-1">
            <Coins className="h-3 w-3" />
            Dinheiro Vivo
          </div>
          <div className="font-mono tabular text-xl md:text-2xl font-semibold mt-1">{formatBRL(cashAccounts.reduce((s, a) => s + Number(a.current_balance), 0))}</div>
        </div>
        <div className="rounded-2xl border border-border bg-surface-1 p-4 md:p-5 shadow-card">
          <div className="text-xs text-muted-foreground flex items-center gap-1">
            <Wallet className="h-3 w-3" />
            Vales
          </div>
          <div className="font-mono tabular text-xl md:text-2xl font-semibold mt-1">{formatBRL(voucherAccounts.reduce((s, a) => s + Number(a.current_balance), 0))}</div>
        </div>
      </div>

      {/* Account Groups */}
      {bankAccounts.length > 0 && (
        <div className="mb-6">
          <h2 className="font-display font-semibold mb-3 text-sm text-muted-foreground uppercase tracking-wide flex items-center gap-2">
            <Banknote className="h-4 w-4" />
            Instituições Bancárias
          </h2>
          <div className="grid sm:grid-cols-2 gap-4">
            {bankAccounts.map((a) => <AccountCard key={a.id} account={a} onEdit={() => openEdit(a)} onDelete={() => setConfirmDel(a)} />)}
          </div>
        </div>
      )}

      {creditCards.length > 0 && (
        <div className="mb-6">
          <h2 className="font-display font-semibold mb-3 text-sm text-muted-foreground uppercase tracking-wide flex items-center gap-2">
            <CreditCard className="h-4 w-4" />
            Cartões de Crédito
          </h2>
          <div className="grid sm:grid-cols-2 gap-4">
            {creditCards.map((a) => <AccountCard key={a.id} account={a} onEdit={() => openEdit(a)} onDelete={() => setConfirmDel(a)} />)}
          </div>
        </div>
      )}

      {cashAccounts.length > 0 && (
        <div className="mb-6">
          <h2 className="font-display font-semibold mb-3 text-sm text-muted-foreground uppercase tracking-wide flex items-center gap-2">
            <Coins className="h-4 w-4" />
            Dinheiro Vivo (Carteira)
          </h2>
          <div className="grid sm:grid-cols-2 gap-4">
            {cashAccounts.map((a) => <AccountCard key={a.id} account={a} onEdit={() => openEdit(a)} onDelete={() => setConfirmDel(a)} />)}
          </div>
        </div>
      )}

      {voucherAccounts.length > 0 && (
        <div className="mb-6">
          <h2 className="font-display font-semibold mb-3 text-sm text-muted-foreground uppercase tracking-wide flex items-center gap-2">
            <Wallet className="h-4 w-4" />
            Benefícios (Vale)
          </h2>
          <div className="grid sm:grid-cols-2 gap-4">
            {voucherAccounts.map((a) => <AccountCard key={a.id} account={a} onEdit={() => openEdit(a)} onDelete={() => setConfirmDel(a)} />)}
          </div>
        </div>
      )}

      {otherAccounts.length > 0 && (
        <div className="mb-6">
          <h2 className="font-display font-semibold mb-3 text-sm text-muted-foreground uppercase tracking-wide">Outros</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            {otherAccounts.map((a) => <AccountCard key={a.id} account={a} onEdit={() => openEdit(a)} onDelete={() => setConfirmDel(a)} />)}
          </div>
        </div>
      )}

      {accounts.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <p>Nenhuma conta cadastrada.</p>
          <p className="text-sm mt-2">Cadastre suas contas para começar a gerenciar suas finanças.</p>
        </div>
      )}

      <AlertDialog open={!!confirmDel} onOpenChange={(v) => !v && setConfirmDel(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir "{confirmDel?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação removerá a conta da sua visão e ela <strong>não aparecerá mais no dashboard, faturas ou lançamentos</strong>.
              O histórico de transações vinculado a ela permanece registrado para fins de auditoria, mas a conta em si será excluída permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmRemove} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Excluir permanentemente</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={transferOpen} onOpenChange={setTransferOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Transferência entre contas</DialogTitle>
            <DialogDescription>Mova saldo entre suas contas. Transferências não são consideradas despesas.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>De (origem)</Label>
              <Select value={transferForm.from_account} onValueChange={(v) => setTransferForm({ ...transferForm, from_account: v })}>
                <SelectTrigger className="mt-1.5"><SelectValue placeholder="Selecione a conta de origem" /></SelectTrigger>
                <SelectContent>
                  {accounts.filter(a => a.type !== "credit_card").map((a) => (
                    <SelectItem key={a.id} value={a.id}>{a.name} - {formatBRL(Number(a.current_balance))}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Para (destino)</Label>
              <Select value={transferForm.to_account} onValueChange={(v) => setTransferForm({ ...transferForm, to_account: v })}>
                <SelectTrigger className="mt-1.5"><SelectValue placeholder="Selecione a conta de destino" /></SelectTrigger>
                <SelectContent>
                  {accounts.filter(a => a.type !== "credit_card" && a.id !== transferForm.from_account).map((a) => (
                    <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Valor</Label>
              <Input type="number" step="0.01" value={transferForm.amount} onChange={(e) => setTransferForm({ ...transferForm, amount: e.target.value })} className="mt-1.5" />
            </div>
            <Button onClick={executeTransfer} className="w-full">Confirmar Transferência</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AccountCard({ account, onEdit, onDelete }: { account: any; onEdit: () => void; onDelete: () => void }) {
  const TypeIcon = accountTypes.find(t => t.value === account.type)?.icon || Wallet;
  const isCreditCard = account.type === "credit_card";
  
  return (
    <div className="rounded-2xl border border-border bg-surface-1 p-4 md:p-5 shadow-card hover:shadow-elegant transition-shadow">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-10 w-10 rounded-lg bg-surface-2 flex items-center justify-center shrink-0">
            <TypeIcon className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <div className="font-display font-semibold truncate">{account.name}</div>
            <div className="text-xs text-muted-foreground">
              {accountTypes.find(t => t.value === account.type)?.label}
              {isCreditCard && account.credit_limit && ` · Limite: ${formatBRL(Number(account.credit_limit))}`}
            </div>
          </div>
        </div>
        <div className="flex items-center shrink-0">
          <Button variant="ghost" size="icon" onClick={onEdit} title="Editar"><Pencil className="h-4 w-4 text-muted-foreground" /></Button>
          <Button variant="ghost" size="icon" onClick={onDelete} title="Excluir"><Trash2 className="h-4 w-4 text-muted-foreground" /></Button>
        </div>
      </div>
      <div className="mt-4">
        {isCreditCard ? (
          <div className="text-sm space-y-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Fecha dia</span>
              <span className="font-medium">{account.closing_day}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Vence dia</span>
              <span className="font-medium">{account.due_day}</span>
            </div>
            <div className="flex justify-between pt-2 border-t border-border">
              <span className="text-muted-foreground">Saldo atual</span>
              <span className={cn("font-mono tabular font-semibold", Number(account.current_balance) > 0 ? "text-expense" : "text-muted-foreground")}>
                {formatBRL(Number(account.current_balance))}
              </span>
            </div>
          </div>
        ) : (
          <div className="font-mono tabular text-2xl font-semibold">
            {formatBRL(Number(account.current_balance))}
          </div>
        )}
      </div>
    </div>
  );
}