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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Plus, CreditCard, Wallet, Trash2, Pencil } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/app/accounts")({
  component: AccountsPage,
});

const types = [
  { value: "cash", label: "Dinheiro" },
  { value: "checking", label: "Conta corrente" },
  { value: "savings", label: "Poupança" },
  { value: "credit_card", label: "Cartão de crédito" },
  { value: "other", label: "Outro" },
];

const emptyForm = { name: "", type: "checking", current_balance: "0", closing_day: "", due_day: "", credit_limit: "" };

function AccountsPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<any>(emptyForm);
  const [confirmDel, setConfirmDel] = useState<any>(null);

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

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto animate-in fade-in duration-300">
      <div className="flex items-center justify-between mb-6 gap-3">
        <h1 className="font-display text-2xl md:text-3xl font-bold">Contas e Cartões</h1>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-2" /> Nova</Button></DialogTrigger>
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
                  <SelectContent>{types.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
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

      <div className="grid sm:grid-cols-2 gap-4">
        {accounts.length === 0 && <div className="text-muted-foreground text-sm sm:col-span-2">Cadastre suas contas e cartões para a IA conseguir vincular os lançamentos corretamente.</div>}
        {accounts.map((a: any) => {
          const isCard = a.type === "credit_card";
          const Icon = isCard ? CreditCard : Wallet;
          return (
            <div key={a.id} className="rounded-2xl border border-border bg-surface-1 p-4 md:p-5 shadow-card">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="h-10 w-10 rounded-lg bg-surface-2 flex items-center justify-center shrink-0"><Icon className="h-5 w-5 text-primary" /></div>
                  <div className="min-w-0">
                    <div className="font-display font-semibold truncate">{a.name}</div>
                    <div className="text-xs text-muted-foreground">{types.find((t) => t.value === a.type)?.label}</div>
                  </div>
                </div>
                <div className="flex items-center shrink-0">
                  <Button variant="ghost" size="icon" onClick={() => openEdit(a)} title="Editar"><Pencil className="h-4 w-4 text-muted-foreground" /></Button>
                  <Button variant="ghost" size="icon" onClick={() => setConfirmDel(a)} title="Excluir"><Trash2 className="h-4 w-4 text-muted-foreground" /></Button>
                </div>
              </div>
              <div className="mt-4">
                {isCard ? (
                  <div className="text-sm text-muted-foreground space-y-1">
                    <div>Fecha dia <span className="text-foreground font-medium">{a.closing_day ?? "—"}</span> · vence dia <span className="text-foreground font-medium">{a.due_day ?? "—"}</span></div>
                    {a.credit_limit && <div>Limite: <span className="font-mono tabular text-foreground">{formatBRL(Number(a.credit_limit))}</span></div>}
                  </div>
                ) : (
                  <div className="font-mono tabular text-2xl font-semibold">{formatBRL(Number(a.current_balance))}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

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
    </div>
  );
}
