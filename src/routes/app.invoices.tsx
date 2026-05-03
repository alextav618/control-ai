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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Check, CreditCard, AlertCircle, Plus, Trash2, Pencil } from "lucide-react";
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
  const [payInv, setPayInv] = useState<any>(null);
  const [payAccount, setPayAccount] = useState("");
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10));
  const [itemDialog, setItemDialog] = useState(false);
  const [editingItem, setEditingItem] = useState<any>(null);
  const [itemForm, setItemForm] = useState({ description: "", quantity: "1", unit_price: "" });

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

  const { data: accounts = [] } = useQuery({
    queryKey: ["accounts", user?.id],
    queryFn: async () => {
      const { data } = await supabase.from("accounts").select("*").eq("archived", false);
      return data ?? [];
    },
    enabled: !!user,
  });

  const cashAccounts = accounts.filter((a: any) => a.type !== "credit_card");

  const openPay = (inv: any) => {
    setPayInv(inv);
    setPayAccount(cashAccounts[0]?.id ?? "");
    setPayDate(new Date().toISOString().slice(0, 10));
  };

  const confirmPay = async () => {
    if (!user || !payInv<dyad-write path="src/routes/app.invoices.tsx" description="Fix TS2769 by adding explicit generic type for transaction insert">
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
import { Check, CreditCard, AlertCircle, Plus, Trash2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// Define the shape of a transaction row for insert operations
type TransactionInsert = {
  user_id: string;
  type: string;
  amount: number;
  description: string;
  occurred_on: string;
  account_id: string;
  status: string;
  source: string;
};

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
  const [payInv, setPayInv] = useState<any>(null);
  const [payAccount, setPayAccount] = useState("");
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10));
  const [itemDialog, setItemDialog] = useState(false);
  const [editingItem, setEditingItem] = useState<any>(null);
  const [itemForm, setItemForm] = useState({ description: "", quantity: "1", unit_price: "" });

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

  const { data: accounts = [] } = useQuery({
    queryKey: ["accounts", user?.id],
    queryFn: async () => {
      const { data } = await supabase.from("accounts").select("*").eq("archived", false);
      return data ?? [];
    },
    enabled: !!user,
  });

  const cashAccounts = accounts.filter((a: any) => a.type !== "credit_card");

  const openPay = (inv: any) => {
    setPayInv(inv);
    setPayAccount(cashAccounts[0]?.id ?? "");
    setPayDate(new Date().toISOString().slice(0, 10));
  };

  const confirmPay = async () => {
    if (!user || !payInv) return;
    if (!payAccount) { toast.error("Escolha a conta de pagamento"); return; }

    const { error: txErr } = await supabase
      .from<TransactionInsert>("transactions")
      .insert({
        user_id: user.id,
        type: "expense",
        amount: Number(payInv.total_amount),
        description: `Pagamento fatura ${payInv.accounts?.name} (${monthNames[payInv.reference_month - 1]}/${payInv.reference_year})`,
        occurred_on: payDate,
        account_id: payAccount,
        status: "paid",
        source: "manual",
      });

    if (txErr) { toast.error(txErr.message); return; }

    const acc = accounts.find((a: any) => a.id === payAccount);
    if (acc) {
      await supabase.from("accounts").update({ current_balance: Number(acc.current_balance) - Number(payInv.total_amount) }).eq("id", acc.id);
    }

    const { error: invErr } = await supabase.from("invoices").update({ status: "paid", paid_at: new Date().toISOString() }).eq("id", payInv.id);
    if (invErr) { toast.error(invErr.message); return; }

    toast.success("Fatura paga ✓");
    setPayInv(null);
    qc.invalidateQueries({ queryKey: ["invoices"] });
    qc.invalidateQueries({ queryKey: ["transactions"] });
    qc.invalidateQueries({ queryKey: ["accounts"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  };

  const reopen = async (inv: any) => {
    if (!confirm("Reabrir esta fatura? Os lançamentos não são removidos automaticamente.")) return;
    const { error } = await supabase.from("invoices").update({ status: "open", paid_at: null }).eq("id", inv.id);
    if (error) toast.error(error.message);
    else { toast.success("Fatura reaberta"); qc.invalidateQueries({ queryKey: ["invoices"] }); }
  };

  const openItemDialog = (inv: any) => {
    setPayInv(inv);
    setItemDialog(true);
    setItemForm({ description: "", quantity: "1", unit_price: "" });
  };

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
      amount: amount,
    });

    if (error) { toast.error(error.message); return; }

    await recomputeInvoiceTotal(payInv.id);

    toast.success("Item adicionado");
    setItemDialog(false);
    setPayInv(null);
    qc.invalidateQueries({ queryKey: ["invoices"] });
  };

  const removeItem = async (itemId: string, invId: string) => {
    const { error } = await supabase.from("invoice_items").delete().eq("id", itemId);
    if (error) { toast.error(error.message); return; }

    await recomputeInvoiceTotal(invId);

    toast.success("Item removido");
    qc.invalidateQueries({ queryKey: ["invoices"] });
  };

  const open = invoices.filter((i: any) => i.status !== "paid");
  const paid = invoices.filter((i: any) => i.status === "paid");

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto animate-in fade-in duration-300">
      <div className="flex items-center justify-between mb-2">
        <h1 className="font-display text-2xl md:text-3xl font-bold">Recorrentes</h1>
        <p className="text-sm text-muted-foreground mb-6">{monthNames[new Date().getMonth()]} de {new Date().getFullYear()}</p>
      </div>

      <div className="rounded-2xl border border-border bg-surface-1 overflow-hidden">
        {open.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground text-sm">Nada cadastrado. A IA também pode criar pelo chat.</div>
        ) : (
          <div className="divide-y divide-border">
            {open.map((b: any) => {
              const occ = occByBill.get(b.id);
              const paid = occ?.status === "paid";
              const isVar = b.amount_kind === "variable";
              const displayAmount = paid ? Number(occ.amount) : Number(b.expected_amount);
              return (
                <div key={b.id} className="p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className={cn(
                      "rounded-2xl px-4 py-2.5",
                      paid
                        ? "bg-audit-green"
                        : "bg-audit-yellow"
                    )}>
                      <span className={cn("h-2 w-2 rounded-full shrink-0", paid ? "bg-audit-green" : "bg-audit-yellow")} />
                      <span className="truncate">{b.description}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={cn("font-mono tabular font-semibold", paid ? "text-income" : "text-expense")}>
                        {isVar && !paid ? "—" : formatBRL(displayAmount)}
                      </span>
                      {!paid && (
                        <Button size="sm" variant="outline" onClick={() => {
                          setPayOpen(b.id);
                          setPayAmount(isVar ? "" : String(b.expected_amount));
                        }}>
                          <Check className="h-3.5 w-3.5 mr-1" /> Lançar
                        </Button>
                      )}
                      <Button size="icon" variant="ghost" onClick={() => remove(b.id)}><Trash2 className="h-3 w-3 text-muted-foreground" /></Button>
                    </div>
                  </div>
                  {payOpen === b.id && (
                    <div className="mt-3 flex items-center gap-2 p-3 rounded-lg bg-surface-2 border border-border text-sm">
                      <Label className="text-xs">Valor pago neste mês</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={payAmount}
                        onChange={(e) => setPayAmount(e.target.value)}
                        autoFocus
                        className="max-w-[160px]"
                      />
                      <Button size="sm" onClick={() => markPaid(b, Number(payAmount))}>Confirmar</Button>
                      <Button size="sm" variant="ghost" onClick={() => { setPayOpen(null); setPayAmount(""); }}>Cancelar</Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="border-t border-border bg-surface-1/80 backdrop-blur px-4 md:px-6 py-4">
        <div className="max-w-3xl mx-auto">
          {(imageData || audioBlob) && (
            <div className="mb-3 flex items-center gap-2">
              {imageData && (
                <div className="relative">
                  <img src={imageData.preview} alt="prévia" className="h-16 w-16 object-cover rounded-lg border border-border" />
                  <button onClick={() => setImageData(null)} className="absolute -top-1.5 -right-1.5 bg-background border border-border rounded-full p-0.5">
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )}
              {audioBlob && (
                <div className="flex items-center gap-2 px-3 py-2 bg-surface-2 rounded-lg border border-border text-sm">
                  <Mic className="h-4 w-4 text-primary" />
                  Áudio gravado ({Math.round(audioBlob.size / 1024)} KB)
                  <button onClick={() => setAudioBlob(null)}><X className="h-3 w-3" /></button>
                </div>
              )}
            </div>
          )}
          <div className="flex items-end gap-2">
            <label className="cursor-pointer p-2.5 rounded-lg transition-colors hover:bg-surface-2 text-muted-foreground">
              <ImageIcon className="h-5 w-5" />
              <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && handlePickImage(e.target.files[0])} />
            </label>
            <Button onClick={send} disabled={sending || (!text.trim() && !imageData && !audioBlob)} size="icon" className="h-11 w-11">
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="text-center py-10">
      <div className="inline-flex h-14 w-14 rounded-2xl bg-gradient-primary items-center justify-center text-primary-foreground font-display font-bold text-xl shadow-glow mb-4">
        I      </div>
      <h2 className="font-display text-2xl font-semibold mb-4">Bom te ver.</h2>
      <p className="text-muted-foreground mt-2 max-w-md mx-auto text-sm">
        Mande texto, foto ou áudio. A IControl IA estrutura tudo.
      </p>
    </div>
  );
}

function MessageBubble({ msg }: { msg: Msg }) {
  const isUser = msg.role === "user";
  const actions = msg.metadata?.actions ?? [];
  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div className={cn("max-w-[85%] md:max-w-[70%] space-y-2")}>
        <div
          className={cn(
            "rounded-2xl px-4 py-2.5",
            isUser
              ? "bg-primary text-primary-foreground rounded-br-sm"
              : "bg-surface-2 text-foreground border border-border rounded-bl-sm"
          )}
        >
          {msg.attachment_url && msg.attachment_type === "image" && (
            <img src={msg.attachment_url} alt="anexo" className="rounded-lg mb-2 max-h-64" />
          )}
          {msg.attachment_url && msg.attachment_type === "audio" && (
            <audio controls src={msg.attachment_url} className="mb-2 w-full" />
          )}
          <div className="whitespace-pre-wrap text-sm">{msg.content}</div>
        </div>
        {!isUser && actions.length > 0 && actions.map((a: any, i: number) => (
          <ActionCard key={i} action={a} />
        ))}
      </div>
    </div>
  );
}

function ActionCard({ action }: { action: any }) {
  if (action.type === "transaction") {
    const t = action.transaction;
    const level = t.audit_level;
    const dot =
      level === "green" ? "bg-audit-green" :
      level === "yellow" ? "bg-audit-yellow" :
      level === "red" ? "bg-audit-red" : "bg-muted-foreground";
    return (
      <div className="rounded-xl bg-surface-1 border border-border px-4 py-3 text-sm">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <span className={cn("h-2 w-2 rounded-full shrink-0", dot)} />
            <span className="truncate">{t.description}</span>
          </div>
          <span className={cn("font-mono tabular font-semibold shrink-0", t.type === "income" ? "text-income" : "text-expense")}>
            {t.type === "income" ? "+" : "-"}{formatBRL(Number(t.amount))}
          </span>
        </div>
        {t.audit_reason && <p className="text-xs text-muted-foreground mt-1.5">{t.audit_reason}</p>}
      </div>
    );
  }
  if (action.type === "account") return <Tag>Conta criada: {action.account.name}</Tag>;
  if (action.type === "fixed_bill") return <Tag>Conta fixa: {action.bill.name}</Tag>;
  if (action.type === "category") return <Tag>Categoria: {action.category.name}</Tag>;
  if (action.type === "error") return <div className="text-xs text-destructive">⚠ {action.message}</div>;
  return null;
}

function Tag({ children }: { children: React.ReactNode }) {
  return <div className="inline-block text-xs px-2.5 py-1 rounded-md bg-surface-2 border border-border text-muted-foreground">{children}</div>;
}