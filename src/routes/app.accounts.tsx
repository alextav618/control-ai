import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { formatBRL } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, CreditCard, Wallet, Trash2, Pencil, Landmark, Banknote, ArrowRightLeft, Receipt, Coins } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/accounts")({
  component: AccountsPage,
});

// Mapeamento de tipos para o banco de dados (mantendo compatibilidade com o enum existente)
const ACCOUNT_TYPES = [
  { value: "checking", label: "Conta Corrente (Pix/Transf/Boleto)", icon: Landmark },
  { value: "savings", label: "Poupança / Investimento", icon: Coins },
  { value: "cash", label: "Dinheiro / Carteira", icon: Banknote },
  { value: "other", label: "Outros", icon: Wallet },
];

const CARD_TYPES = [
  { value: "credit_card", label: "Cartão de Crédito", icon: CreditCard },
  { value: "checking", label: "Cartão de Débito (Vinculado à Conta)", icon: ArrowRightLeft },
];

const emptyForm = { name: "", type: "checking", current_balance: "0", closing_day: "1", due_day: "10", credit_limit: "" };

function AccountsPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState("accounts");
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<any>(emptyForm);
  const [confirmDel, setConfirmDel] = useState<any>(null);

  useEffect(() => { 
    if (!open) { 
      setEditId(null); 
      setForm({ ...emptyForm, type: activeTab === "cards" ? "credit_card" : "checking" }); 
    } 
  }, [open, activeTab]);

  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ["accounts", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("accounts").select("*").eq("archived", false).order("name");
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const filteredAccounts = useMemo(() => {
    return accounts.filter(a => a.type !== "credit_card");
  }, [accounts]);

  const filteredCards = useMemo(() => {
    // No contexto deste app, cartões são especificamente do tipo credit_card ou contas que o usuário quer ver como cartões
    return accounts.filter(a => a.type === "credit_card");
  }, [accounts]);

  const openEdit = (a: any) => {
    setEditId(a.id);
    setForm({
      name: a.name,
      type: a.type,
      current_balance: String(a.current_balance ?? "0"),
      closing_day: a.closing_day ? String(a.closing_day) : "1",
      due_day: a.due_day ? String(a.due_day) : "10",
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
      toast.success("Atualizado com sucesso");
    } else {
      const { error } = await supabase.from("accounts").insert({ user_id: user.id, ...payload });
      if (error) { toast.error(error.message); return; }
      toast.success("Criado com sucesso");
    }
    setOpen(false);
    qc.invalidateQueries({ queryKey: ["accounts"] });
  };

  const confirmRemove = async () => {
    if (!confirmDel) return;
    const { error } = await supabase.from("accounts").update({ archived: true }).eq("id", confirmDel.id);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Excluído com sucesso");
      qc.invalidateQueries({ queryKey: ["accounts"] });
    }
    setConfirmDel(null);
  };

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto animate-in fade-in duration-300">
      <div className="flex items-center justify-between mb-6 gap-3">
        <div>
          <h1 className="font-display text-2xl md:text-3xl font-bold">Contas e Cartões</h1>
          <p className="text-sm text-muted-foreground mt-1">Gerencie suas disponibilidades e limites.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="shadow-glow">
              <Plus className="h-4 w-4 mr-2" /> {activeTab === "cards" ? "Novo Cartão" : "Nova Conta"}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editId ? "Editar" : "Cadastrar"} {activeTab === "cards" ? "Cartão" : "Conta"}</DialogTitle>
              <DialogDescription>Preencha os dados para organizar seus lançamentos.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div>
                <Label>Nome</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ex: Nubank, Itaú, Carteira" className="mt-1.5" />
              </div>
              <div>
                <Label>Tipo</Label>
                <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                  <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(activeTab === "cards" ? CARD_TYPES : ACCOUNT_TYPES).map((t) => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              
              {form.type === "credit_card" ? (
                <div className="space-y-4 animate-in slide-in-from-top-2">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Dia de Fechamento</Label>
                      <Input type="number" min={1} max={31} value={form.closing_day} onChange={(e) => setForm({ ...form, closing_day: e.target.value })} className="mt-1.5" />
                    </div>
                    <div>
                      <Label>Dia de Vencimento</Label>
                      <Input type="number" min={1} max={31} value={form.due_day} onChange={(e) => setForm({ ...form, due_day: e.target.value })} className="mt-1.5" />
                    </div>
                  </div>
                  <div>
                    <Label>Limite de Crédito (R$)</Label>
                    <Input type="number" value={form.credit_limit} onChange={(e) => setForm({ ...form, credit_limit: e.target.value })} placeholder="Opcional" className="mt-1.5" />
                  </div>
                </div>
              ) : (
                <div className="animate-in slide-in-from-top-2">
                  <Label>Saldo Atual (R$)</Label>
                  <Input type="number" step="0.01" value={form.current_balance} onChange={(e) => setForm({ ...form, current_balance: e.target.value })} className="mt-1.5" />
                </div>
              )}
              
              <Button onClick={submit} className="w-full mt-2">{editId ? "Salvar Alterações" : "Cadastrar"}</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="grid w-full grid-cols-2 max-w-md">
          <TabsTrigger value="accounts" className="flex items-center gap-2">
            <Wallet className="h-4 w-4" /> Contas
          </TabsTrigger>
          <TabsTrigger value="cards" className="flex items-center gap-2">
            <CreditCard className="h-4 w-4" /> Cartões
          </TabsTrigger>
        </TabsList>

        <TabsContent value="accounts" className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            {isLoading ? (
              <div className="col-span-2 py-10 text-center text-muted-foreground">Carregando contas...</div>
            ) : filteredAccounts.length === 0 ? (
              <div className="col-span-2 py-10 text-center text-muted-foreground border border-dashed rounded-2xl">
                Nenhuma conta cadastrada.
              </div>
            ) : (
              filteredAccounts.map((a) => (
                <AccountCard key={a.id} account={a} onEdit={() => openEdit(a)} onDelete={() => setConfirmDel(a)} />
              ))
            )}
          </div>
          <div className="rounded-xl bg-surface-2 p-4 border border-border">
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-2">
              <ArrowRightLeft className="h-3 w-3" /> Formas suportadas
            </h3>
            <div className="flex flex-wrap gap-2">
              {["Pix", "Transferência", "Boleto", "Saque", "Depósito"].map(tag => (
                <span key={tag} className="text-[10px] px-2 py-1 rounded-full bg-background border border-border text-muted-foreground">{tag}</span>
              ))}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="cards" className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            {isLoading ? (
              <div className="col-span-2 py-10 text-center text-muted-foreground">Carregando cartões...</div>
            ) : filteredCards.length === 0 ? (
              <div className="col-span-2 py-10 text-center text-muted-foreground border border-dashed rounded-2xl">
                Nenhum cartão de crédito cadastrado.
              </div>
            ) : (
              filteredCards.map((a) => (
                <AccountCard key={a.id} account={a} onEdit={() => openEdit(a)} onDelete={() => setConfirmDel(a)} />
              ))
            )}
          </div>
          <div className="rounded-xl bg-surface-2 p-4 border border-border">
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-2">
              <Receipt className="h-3 w-3" /> Controle de Fatura
            </h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Cartões de crédito possuem controle automático de fatura baseado no dia de fechamento. 
              Lançamentos após o fechamento são jogados automaticamente para a próxima fatura.
            </p>
          </div>
        </TabsContent>
      </Tabs>

      <AlertDialog open={!!confirmDel} onOpenChange={(v) => !v && setConfirmDel(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir "{confirmDel?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação arquivará a conta. O histórico de transações será mantido, mas ela não aparecerá mais para novos lançamentos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmRemove} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Excluir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function AccountCard({ account, onEdit, onDelete }: { account: any; onEdit: () => void; onDelete: () => void }) {
  const isCard = account.type === "credit_card";
  const Icon = isCard ? CreditCard : (ACCOUNT_TYPES.find(t => t.value === account.type)?.icon || Wallet);
  
  return (
    <div className="rounded-2xl border border-border bg-surface-1 p-4 md:p-5 shadow-card hover:shadow-elegant transition-all group">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-10 w-10 rounded-lg bg-surface-2 flex items-center justify-center shrink-0">
            <Icon className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <div className="font-display font-semibold truncate">{account.name}</div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider">
              {isCard ? "Cartão de Crédito" : (ACCOUNT_TYPES.find(t => t.value === account.type)?.label.split(' (')[0] || "Conta")}
            </div>
          </div>
        </div>
        <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
          <Button variant="ghost" size="icon" onClick={onEdit}><Pencil className="h-4 w-4 text-muted-foreground" /></Button>
          <Button variant="ghost" size="icon" onClick={onDelete}><Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" /></Button>
        </div>
      </div>
      
      <div className="mt-4">
        {isCard ? (
          <div className="space-y-3">
            <div className="flex justify-between items-end">
              <div>
                <div className="text-[10px] text-muted-foreground uppercase">Limite</div>
                <div className="font-mono font-bold text-lg tabular">{account.credit_limit ? formatBRL(Number(account.credit_limit)) : "—"}</div>
              </div>
              <div className="text-right">
                <div className="text-[10px] text-muted-foreground uppercase">Fechamento / Vencimento</div>
                <div className="text-sm font-medium">Dia {account.closing_day} / Dia {account.due_day}</div>
              </div>
            </div>
            <div className="h-1.5 rounded-full bg-surface-2 overflow-hidden">
              <div className="h-full bg-primary/30 w-full" />
            </div>
          </div>
        ) : (
          <div>
            <div className="text-[10px] text-muted-foreground uppercase mb-1">Saldo Disponível</div>
            <div className="font-mono tabular text-2xl font-bold">{formatBRL(Number(account.current_balance))}</div>
          </div>
        )}
      </div>
    </div>
  );
}