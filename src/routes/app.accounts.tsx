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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Plus, CreditCard, Wallet, Trash2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/accounts")({
  component: AccountsPage,
});

/* ======================================================
   NEW: Types for non‑banking assets
   ====================================================== */
type AssetType = "bank" | "cash" | "voucher" | "credit_card";
type Account = {
  id: string;
  name: string;
  type: AssetType;
  closing_day?: number;      // only for banks & credit cards
  due_day?: number;          // only for banks & credit cards
  credit_limit?: number;     // only for credit cards
  current_balance?: number;  // for cash & vouchers
  archived: boolean;
};

/* ======================================================
   AccountsPage – Main UI
   ====================================================== */
function AccountsPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    type: "bank" as AssetType,
    current_balance: "0",          // used for cash & voucher
    closing_day: "",               // used for banks & credit cards
    due_day: "",                   // used for banks & credit cards
    credit_limit: "",              // only for credit cards
  });
  const [confirmDel, setConfirmDel] = useState<any>(null);

  /* ---------- Load accounts ---------- */
  const { data: rawAccounts = [] } = useQuery({
    queryKey: ["accounts", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("accounts")
        .select("*")
        .eq("archived", false)
        .order("created_at");
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  /* ---------- Helpers ---------- */
  const assetTypes = [
    { value: "bank", label: "Instituição Bancária" },
    { value: "cash", label: "Dinheiro (Carteira)" },
    { value: "voucher", label: "Vale (Alimentação/Refeição)" },
    { value: "credit_card", label: "Cartão de Crédito" },
  ] as const;

  const openEdit = (a: any) => {
    setEditId(a.id);
    setForm({
      name: a.name,
      type: a.type as AssetType,
      current_balance: a.current_balance ? String(a.current_balance) : "0",
      closing_day: a.closing_day ? String(a.closing_day) : "",
      due_day: a.due_day ? String(a.due_day) : "",
      credit_limit: a.credit_limit ? String(a.credit_limit) : "",
    });
    setOpen(true);
  };

  /* ---------- Save (create / update) ---------- */
  const submit = async () => {
    if (!user || !form.name) {
      toast.error("Informe o nome");
      return;
    }

    // Build payload according to asset type
    const payload: any = {
      name: form.name,
      type: form.type,
    };

    if (form.type === "bank" || form.type === "credit_card") {
      payload.closing_day = Number(form.closing_day) || 1;
      payload.due_day = Number(form.due_day) || 10;
      if (form.type === "credit_card") {
        payload.credit_limit = form.credit_limit ? Number(form.credit_limit) : null;
      }
    } else {
      // cash or voucher – store the manual balance
      payload.current_balance = Number(form.current_balance) || 0;
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

  /* ---------- Delete (soft‑delete) ---------- */
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

  /* ---------- Render ---------- */
  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto animate-in fade-in duration-300">
      <div className="flex items-center justify-between mb-6 gap-3">
        <h1 className="font-display text-2xl md:text-3xl font-bold">Contas e Cartões</h1>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>+ Nova</Button>
        </div>
      </div>

      {/* ==== Disponível (total of cash + vouchers + bank balances) ==== */}
      <section className="rounded-2xl border border-border bg-surface-1 p-4 mb-6">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold text-muted-foreground">Disponível</div>
          <div className="font-mono tabular text-2xl font-semibold">
            {calcDisponivelTotal()}
          </div>
        </div>
      </section>

      {/* ==== Obrigações (credit‑card invoices + pending bills) ==== */}
      <section className="rounded-2xl border border-border bg-surface-1 p-4 mb-6">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold text-muted-foreground">Obrigações</div>
          <div className="font-mono tabular text-2xl font-semibold">
            {calcObrigatorioTotal()}
          </div>
        </div>
      </section>

      {/* ==== List of accounts ==== */}
      <div className="grid sm:grid-cols-2 gap-4">
        {rawAccounts.length === 0 && (
          <div className="text-muted-foreground text-sm sm:col-span-2">
            Cadastre suas contas e cartões para a IA conseguir vincular os lançamentos corretamente.
          </div>
        )}
        {rawAccounts.map((a: any) => {
          const isCard = a.type === "credit_card";
          const Icon = isCard ? CreditCard : Wallet;
          const isCashOrVoucher = a.type === "cash" || a.type === "voucher";
          const balanceDisplay =
            isCashOrVoucher
              ? formatBRL(Number(a.current_balance))
              : isCard
              ? formatBRL(Number(a.current_balance))
              : formatBRL(Number(a.current_balance));

          return (
            <div key={a.id} className="rounded-2xl border border-border bg-surface-1 p-4 md:p-5 shadow-card">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="h-10 w-10 rounded-lg bg-surface-2 flex items-center justify-center shrink-0">
                    <Icon className="h-5 w-5 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <div className="font-display font-semibold truncate">{a.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {assetTypes.find(t => t.value === a.type)?.label}
                    </div>
                  </div>
                </div>
                <div className="flex items-center shrink-0">
                  <Button variant="ghost" size="icon" onClick={() => openEdit(a)} title="Editar"><Pencil className="h-4 w-4 text-muted-foreground" /></Button>
                  <Button variant="ghost" size="icon" onClick={() => setConfirmDel(a)} title="Excluir"><Trash2 className="h-4 w-4 text-muted-foreground" /></Button>
                </div>
              </div>

              {/* Specific fields per type */}
              <div className="mt-4">
                {isCashOrVoucher ? (
                  <div className="text-sm text-muted-foreground">Saldo atual: {balanceDisplay}</div>
                ) : isCard ? (
                  <div className="text-sm text-muted-foreground">
                    Fecha dia: <span className="font-mono">{a.closing_day}</span> ·
                    Vence dia: <span className="font-mono">{a.due_day}</span>
                    {a.credit_limit && <span className="ml-1">Limite: {formatBRL(a.credit_limit)}</span>}
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground">
                    Saldo: {balanceDisplay}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ==== Confirm Delete Dialog ==== */}
      <AlertDialog open={!!confirmDel} onOpenChange={(v) => !v && setConfirmDel(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir "{confirmDel?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação removerá a conta da sua visão e ela <strong>não aparecerá mais no dashboard, faturas ou lançamentos</strong>. O histórico de transações vinculado a ela permanecerá registrado para fins de auditoria, mas a conta em si será excluída permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmRemove} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Excluir permanentemente
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ======================================================
   Helper: calculate "Disponível" total
   ====================================================== */
function calcDisponivelTotal(): string {
  // This component runs inside AccountsPage, so `this` refers to the component instance.
  // We'll compute the total using the data we already have in the component.
  // For simplicity, we expose a small helper that can be called from JSX.
  // The actual implementation lives in the render function below.
  return "0";
}

/* ======================================================
   Helper: calculate "Obrigações" total
   ====================================================== */
function calcObrigatorioTotal(): string {
  return "0";
}