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
import { Plus, CreditCard, Wallet, Trash2, Pencil, ArrowRightLeft, Banknote, Ticket } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/accounts")({
  component: AccountsPage,
});

const ACCOUNT_TYPES = [
  { value: "bank_balance", label: "Saldo Bancário", icon: Banknote, category: "banking" },
  { value: "bank_credit", label: "Cartão de Crédito", icon: CreditCard, category: "banking" },
  { value: "cash_wallet", label: "Dinheiro Vivo", icon: Wallet, category: "cash" },
  { value: "voucher", label: "Vale Alimentação/Refeição", icon: Ticket, category: "voucher" },
  { value: "checking", label: "Conta Corrente", icon: Banknote, category: "banking" },
  { value: "savings", label: "Poupança", icon: Banknote, category: "banking" },
  { value: "other", label: "Outro", icon: Wallet, category: "other" },
] as const;

const emptyForm = { 
  name: "", 
  type: "bank_balance" as const, 
  current_balance: "0", 
  closing_day: "", 
  due_day: "", 
  credit_limit: "",
  category: "banking" as const
};

function AccountsPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<any>(emptyForm);
  const [confirmDel, setConfirmDel] = useState<any>(null);
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferForm, setTransferForm] = useState({
    from_account: "",
    to_account: "",
    amount: "",
    description: ""
  });

  useEffect(() => { 
    if (!open) { 
      setEditId(null); 
      setForm(emptyForm); 
    } 
  }, [open]);

  const { data: accounts = [] } = useQuery({
    queryKey: ["accounts", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("accounts")
        .select("*")
        .eq("archived", false)
        .eq("is_active", true)
        .order("created_at");
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
      category: a.category || "banking",
    });
    setOpen(true);
  };

  const submit = async () => {
    if (!user || !form.name) { 
      toast.error("Informe o nome"); 
      return; 
    }
    
    const payload: any = {
      name: form.name,
      type: form.type,
      current_balance: Number(form.current_balance) || 0,
      category: form.category,
    };

    if (form.type === "bank_credit" || form.type === "credit_card") {
      payload.closing_day = Number(form.closing_day) || 1;
      payload.due_day = Number(form.due_day) || 10;
      payload.credit_limit = form.credit_limit ? Number(form.credit_limit) : null;
    } else {
      payload.closing_day = null;
      payload.due_day = null;
      payload.credit_limit = null;
    }

    if (editId) {
      const { error } = await supabase
        .from("accounts")
        .update(payload)
        .eq("id", editId);
      if (error) { 
        toast.error(error.message); 
        return; 
      }
      toast.success("Conta atualizada");
    } else {
      const { error } = await supabase
        .from("accounts")
        .insert({ user_id: user.id, ...payload });
      if (error) { 
        toast.error(error.message); 
        return; 
      }
      toast.success("Conta criada");
    }
    
    setOpen(false);
    qc.invalidateQueries({ queryKey: ["accounts"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    qc.invalidateQueries({ queryKey: ["invoices"] });
    qc.invalidateQueries({ queryKey: ["transactions"] });
  };

  const confirmRemove = async () => {
    if (!confirmDel) return;
    
    const { error } = await supabase
      .from("accounts")
      .update({ is_active: false, archived: true })
      .eq("id", confirmDel.id);
      
    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Conta excluída");
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["invoices"] });
    }
    
    setConfirmDel(null);
  };

  const initiateTransfer = () => {
    setTransferForm({
      from_account: "",
      to_account: "",
      amount: "",
      description: ""
    });
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
      toast.error("Saldo insuficiente");
      return;
    }

    try {
      // Create transfer transaction (not an expense)
      const { error: txError } = await supabase
        .from("transactions")
        .insert({
          user_id: user.id,
          type: "transfer",
          amount: amount,
          description: transferForm.description || `Transferência: ${fromAcc.name} → ${toAcc.name}`,
          occurred_on: new Date().toISOString().slice(0, 10),
          account_id: fromAcc.id,
          category_id: null,
          status: "completed",
          source: "manual",
          metadata: {
            to_account_id: toAcc.id,
            transfer_type: "internal"
          }
        });

      if (txError) throw txError;

      // Update balances
      await supabase
        .from("accounts")
        .update({ 
          current_balance: Number(fromAcc.current_balance) - amount 
        })
        .eq("id", fromAcc.id);

      await supabase
        .from("accounts")
        .update({ 
          current_balance: Number(toAcc.current_balance) + amount 
        })
        .eq("id", toAcc.id);

      toast.success("Transferência realizada com sucesso");
      setTransferOpen(false);
      
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      
    } catch (error: any) {
      toast.error(error.message || "Erro ao realizar transferência");
    }
  };

  // Group accounts by category for better UI organization
  const groupedAccounts = accounts.reduce((groups, account) => {
    const category = account.category || "banking";
    if (!groups[category]) {
      groups[category] = [];
    }
    groups[category].push(account);
    return groups;
  }, {} as Record<string, any[]>);

  const availableBalance = accounts
    .filter(a => a.type !== "bank_credit" && a.type !== "credit_card")
    .reduce((sum, a) => sum + Number(a.current_balance), 0);

  const obligations = accounts
    .filter(a => a.type === "bank_credit" || a.type === "credit_card")
    .reduce((sum, a) => sum + Number(a.credit_limit || 0) - Number(a.current_balance), 0);

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto animate-in fade-in duration-300">
      <div className="flex items-center justify-between mb-6 gap-3">
        <h1 className="font-display text-2xl md:text-3xl font-bold">Contas e Cartões</h1>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={initiateTransfer}>
            <ArrowRightLeft className="h-4 w-4 mr-2" />
            Transferir
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" /> Nova
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{editId ? "Editar conta" : "Nova conta ou cartão"}</DialogTitle>
                <DialogDescription>
                  Cadastre contas bancárias, cartões, dinheiro físico ou vales.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label>Nome</Label>
                  <Input 
                    value={form.name} 
                    onChange={(e) => setForm({ ...form, name: e.target.value })} 
                    placeholder="Ex: Nubank Crédito" 
                    className="mt-1.5" 
                  />
                </div>
                
                <div>
                  <Label>Tipo de Conta</Label>
                  <Select 
                    value={form.type} 
                    onValueChange={(v) => setForm({ ...form, type: v })}
                  >
                    <SelectTrigger className="mt-1.5">
                      <SelectValue placeholder="Selecione o tipo" />
                    </SelectTrigger>
                    <SelectContent>
                      {ACCOUNT_TYPES.map((type) => (
                        <SelectItem key={type.value} value={type.value}>
                          <div className="flex items-center gap-2">
                            <type.icon className="h-4 w-4" />
                            {type.label}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {form.type === "bank_credit" || form.type === "credit_card" ? (
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <Label>Fecha dia</Label>
                      <Input 
                        type="number" 
                        min={1} 
                        max={31} 
                        value={form.closing_day} 
                        onChange={(e) => setForm({ ...form, closing_day: e.target.value })} 
                        className="mt-1.5" 
                      />
                    </div>
                    <div>
                      <Label>Vence dia</Label>
                      <Input 
                        type="number" 
                        min={1} 
                        max={31} 
                        value={form.due_day} 
                        onChange={(e) => setForm({ ...form, due_day: e.target.value })} 
                        className="mt-1.5" 
                      />
                    </div>
                    <div>
                      <Label>Limite</Label>
                      <Input 
                        type="number" 
                        value={form.credit_limit} 
                        onChange={(e) => setForm({ ...form, credit_limit: e.target.value })} 
                        className="mt-1.5" 
                      />
                    </div>
                  </div>
                ) : (
                  <div>
                    <Label>Saldo atual</Label>
                    <Input 
                      type="number" 
                      step="0.01" 
                      value={form.current_balance} 
                      onChange={(e) => setForm({ ...form, current_balance: e.target.value })} 
                      className="mt-1.5" 
                    />
                  </div>
                )}

                <Button onClick={submit} className="w-full">
                  {editId ? "Salvar alterações" : "Criar"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div className="rounded-2xl border border-border bg-surface-1 p-4 md:p-5 shadow-card">
          <div className="text-xs text-muted-foreground mb-1">Disponível</div>
          <div className="font-mono tabular text-2xl md:text-3xl font-bold text-income">
            {formatBRL(availableBalance)}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            (Bancos + Dinheiro + Vales)
          </div>
        </div>
        
        <div className="rounded-2xl border border-border bg-surface-1 p-4 md:p-5 shadow-card">
          <div className="text-xs text-muted-foreground mb-1">Obrigações</div>
          <div className="font-mono tabular text-2xl md:text-3xl font-bold text-expense">
            {formatBRL(obligations)}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            (Limites de crédito disponíveis)
          </div>
        </div>
      </div>

      {/* Accounts by Category */}
      <div className="space-y-6">
        {/* Banking Section */}
        {groupedAccounts.banking && (
          <div>
            <h2 className="font-display font-semibold mb-3 text-sm text-muted-foreground uppercase tracking-wide flex items-center gap-2">
              <Banknote className="h-4 w-4" />
              Instituições Bancárias
            </h2>
            <div className="grid sm:grid-cols-2 gap-4">
              {groupedAccounts.banking.map((a: any) => (
                <AccountCard key={a.id} account={a} onEdit={openEdit} onDelete={setConfirmDel} />
              ))}
            </div>
          </div>
        )}

        {/* Cash Section */}
        {groupedAccounts.cash && (
          <div>
            <h2 className="font-display font-semibold mb-3 text-sm text-muted-foreground uppercase tracking-wide flex items-center gap-2">
              <Wallet className="h-4 w-4" />
              Dinheiro Vivo (Carteira)
            </h2>
            <div className="grid sm:grid-cols-2 gap-4">
              {groupedAccounts.cash.map((a: any) => (
                <AccountCard key={a.id} account={a} onEdit={openEdit} onDelete={setConfirmDel} />
              ))}
            </div>
          </div>
        )}

        {/* Vouchers Section */}
        {groupedAccounts.voucher && (
          <div>
            <h2 className="font-display font-semibold mb-3 text-sm text-muted-foreground uppercase tracking-wide flex items-center gap-2">
              <Ticket className="h-4 w-4" />
              Benefícios (Vales)
            </h2>
            <div className="grid sm:grid-cols-2 gap-4">
              {groupedAccounts.voucher.map((a: any) => (
                <AccountCard key={a.id} account={a} onEdit={openEdit} onDelete={setConfirmDel} />
              ))}
            </div>
          </div>
        )}

        {/* Other Section */}
        {groupedAccounts.other && (
          <div>
            <h2 className="font-display font-semibold mb-3 text-sm text-muted-foreground uppercase tracking-wide flex items-center gap-2">
              <Wallet className="h-4 w-4" />
              Outros
            </h2>
            <div className="grid sm:grid-cols-2 gap-4">
              {groupedAccounts.other.map((a: any) => (
                <AccountCard key={a.id} account={a} onEdit={openEdit} onDelete={setConfirmDel} />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Transfer Dialog */}
      <Dialog open={transferOpen} onOpenChange={setTransferOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Transferência entre contas</DialogTitle>
            <DialogDescription>
              Movimente valores entre suas contas sem gerar despesa.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Origem (Débito)</Label>
              <Select 
                value={transferForm.from_account} 
                onValueChange={(v) => setTransferForm({ ...transferForm, from_account: v })}
              >
                <SelectTrigger className="mt-1.5">
                  <SelectValue placeholder="Selecione a conta de origem" />
                </SelectTrigger>
                <SelectContent>
                  {accounts
                    .filter(a => a.type !== "bank_credit" && a.type !== "credit_card")
                    .map((a: any) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name} - {formatBRL(a.current_balance)}
                      </SelectItem>
                    ))
                  }
                </SelectContent>
              </Select>
            </div>
            
            <div>
              <Label>Destino (Crédito)</Label>
              <Select 
                value={transferForm.to_account} 
                onValueChange={(v) => setTransferForm({ ...transferForm, to_account: v })}
              >
                <SelectTrigger className="mt-1.5">
                  <SelectValue placeholder="Selecione a conta de destino" />
                </SelectTrigger>
                <SelectContent>
                  {accounts
                    .filter(a => a.type !== "bank_credit" && a.type !== "credit_card")
                    .map((a: any) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name} - {formatBRL(a.current_balance)}
                      </SelectItem>
                    ))
                  }
                </SelectContent>
              </Select>
            </div>
            
            <div>
              <Label>Valor</Label>
              <Input 
                type="number" 
                step="0.01" 
                value={transferForm.amount} 
                onChange={(e) => setTransferForm({ ...transferForm, amount: e.target.value })} 
                className="mt-1.5" 
                placeholder="0,00"
              />
            </div>
            
            <div>
              <Label>Descrição (opcional)</Label>
              <Input 
                value={transferForm.description} 
                onChange={(e) => setTransferForm({ ...transferForm, description: e.target.value })} 
                className="mt-1.5" 
                placeholder="Ex: Saque para carteira"
              />
            </div>
            
            <Button onClick={executeTransfer} className="w-full">
              <ArrowRightLeft className="h-4 w-4 mr-2" />
              Confirmar Transferência
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!confirmDel} onOpenChange={(v) => !v && setConfirmDel(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir "{confirmDel?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação removerá a conta da sua visão e ela não aparecerá mais no dashboard, faturas ou lançamentos.
              O histórico de transações vinculado a ela permanece registrado para fins de auditoria.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction 
              onClick={confirmRemove} 
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Excluir permanentemente
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// Account Card Component
function AccountCard({ account, onEdit, onDelete }: { account: any; onEdit: (a: any) => void; onDelete: (a: any) => void }) {
  const TypeIcon = ACCOUNT_TYPES.find(t => t.value === account.type)?.icon || Wallet;
  const isCredit = account.type === "bank_credit" || account.type === "credit_card";
  
  return (
    <div className="rounded-2xl border border-border bg-surface-1 p-4 md:p-5 shadow-card hover:shadow-elegant transition-shadow">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-10 w-10 rounded-lg bg-surface-2 flex items-center justify-center shrink-0">
            <TypeIcon className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <div className="font-display font-semibold truncate">{account.name}</div>
            <div className="text-xs text-muted-foreground">
              {ACCOUNT_TYPES.find(t => t.value === account.type)?.label}
            </div>
          </div>
        </div>
        <div className="flex items-center shrink-0">
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={() => onEdit(account)}
            title="Editar"
          >
            <Pencil className="h-4 w-4 text-muted-foreground" />
          </Button>
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={() => onDelete(account)}
            title="Excluir"
          >
            <Trash2 className="h-4 w-4 text-muted-foreground" />
          </Button>
        </div>
      </div>
      
      <div className="mt-4">
        {isCredit ? (
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Limite disponível</div>
            <div className="font-mono tabular text-lg font-semibold text-expense">
              {formatBRL(Number(account.credit_limit || 0) - Number(account.current_balance))}
            </div>
            <div className="text-xs text-muted-foreground">
              Utilizado: {formatBRL(Number(account.current_balance))}
            </div>
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">Saldo atual</div>
          <div className="font-mono tabular text-2xl font-semibold">
            {formatBRL(Number(account.current_balance))}
          </div>
        )}
        
        {account.type === "bank_credit" && (
          <div className="mt-2 text-xs text-muted-foreground">
            Fecha dia {account.closing_day} · Vence dia {account.due_day}
          </div>
        )}
      </div>
    </div>
  );
}