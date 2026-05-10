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
import {
  Check,
  CreditCard,
  Plus,
  Trash2,
  Pencil,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  Settings2,
  Loader2,
} from "lucide-react";

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

  const [payInv, setPayInv] = useState<any>(null);
  const [payAccount, setPayAccount] = useState("");
  const [payDate, setPayDate] = useState(localDateString());

  const [editPayInv, setEditPayInv] = useState<any>(null);
  const [editPayAccount, setEditPayAccount] = useState("");
  const [editPayDate, setEditPayDate] = useState(localDateString());

  const [itemDialog, setItemDialog] = useState(false);

  const [itemForm, setItemForm] = useState({
    description: "",
    quantity: "1",
    unit_price: "",
  });

  const [adjDialog, setAdjDialog] = useState(false);
  const [editingAdj, setEditingAdj] = useState<any>(null);

  const [adjForm, setAdjForm] = useState({
    invoice_id: "",
    amount: "",
  });

  const { data: invoices = [], isLoading: invLoading } = useQuery({
    queryKey: ["invoices", user?.id],

    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoices")
        .select("*, accounts!inner(name, type, archived)")
        .eq("accounts.archived", false)
        .order("reference_year", { ascending: true })
        .order("reference_month", { ascending: true });

      if (error) throw error;

      return data ?? [];
    },

    enabled: !!user,
  });

  const { data: accounts = [] } = useQuery({
    queryKey: ["accounts", user?.id],

    queryFn: async () => {
      const { data, error } = await supabase
        .from("accounts")
        .select("*")
        .eq("archived", false);

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

      return data ?? [];
    },

    enabled: !!user,
  });

  const cashAccounts = accounts.filter((a: any) => a.type !== "credit_card");

  const triggerRecompute = async (invoiceId: string) => {
    const { error } = await supabase.rpc("recompute_invoice_total", {
      p_invoice_id: invoiceId,
    });

    if (error) {
      console.error(error);
    }

    qc.invalidateQueries({ queryKey: ["invoices"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  };

  const confirmPay = async () => {
    if (!user || !payInv || !payAccount) return;

    const totalAmount = Number(payInv.total_amount);

    const { error: txErr } = await supabase.from("transactions").insert({
      user_id: user.id,
      type: "transfer",
      amount: totalAmount,
      description: `Pagamento fatura ${payInv.accounts?.name}`,
      occurred_on: payDate,
      account_id: payAccount,
      to_account_id: payInv.account_id,
      status: "paid",
      source: "manual",
    });

    if (txErr) {
      toast.error(txErr.message);
      return;
    }

    const { error: invErr } = await supabase
      .from("invoices")
      .update({
        status: "paid",
        paid_at: new Date().toISOString(),
      })
      .eq("id", payInv.id);

    if (invErr) {
      toast.error(invErr.message);
      return;
    }

    toast.success("Fatura paga ✓");

    setPayInv(null);

    qc.invalidateQueries({ queryKey: ["invoices"] });
    qc.invalidateQueries({ queryKey: ["transactions"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  };

  const openEditPayment = (inv: any) => {
    setEditPayInv(inv);

    setEditPayAccount(cashAccounts[0]?.id ?? "");

    setEditPayDate(
      inv.paid_at
        ? inv.paid_at.slice(0, 10)
        : localDateString()
    );
  };

  const confirmEditPayment = async () => {
    if (!user || !editPayInv || !editPayAccount) return;

    const { data: paymentTx } = await supabase
      .from("transactions")
      .select("id")
      .eq("to_account_id", editPayInv.account_id)
      .eq("type", "transfer")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (paymentTx) {
      await supabase
        .from("transactions")
        .delete()
        .eq("id", paymentTx.id);
    }

    const { error: txErr } = await supabase
      .from("transactions")
      .insert({
        user_id: user.id,
        type: "transfer",
        amount: Number(editPayInv.total_amount),
        description: `Pagamento fatura ${editPayInv.accounts?.name}`,
        occurred_on: editPayDate,
        account_id: editPayAccount,
        to_account_id: editPayInv.account_id,
        status: "paid",
        source: "manual",
      });

    if (txErr) {
      toast.error(txErr.message);
      return;
    }

    await supabase
      .from("invoices")
      .update({
        paid_at: new Date(editPayDate + "T12:00:00").toISOString(),
      })
      .eq("id", editPayInv.id);

    toast.success("Pagamento atualizado ✓");

    setEditPayInv(null);

    qc.invalidateQueries({ queryKey: ["invoices"] });
    qc.invalidateQueries({ queryKey: ["transactions"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  };

  // 🔥 ESSA FUNÇÃO ESTAVA FALTANDO
  const saveItem = async () => {
    if (
      !user ||
      !payInv ||
      !itemForm.description ||
      !itemForm.unit_price
    ) {
      return;
    }

    const qty = Number(itemForm.quantity) || 1;
    const unit = Number(itemForm.unit_price) || 0;

    const { error } = await supabase
      .from("invoice_items")
      .insert({
        user_id: user.id,
        invoice_id: payInv.id,
        description: itemForm.description,
        quantity: qty,
        unit_price: unit,
        amount: qty * unit,
      });

    if (error) {
      toast.error(error.message);
      return;
    }

    await triggerRecompute(payInv.id);

    toast.success("Item adicionado");

    setItemDialog(false);

    setItemForm({
      description: "",
      quantity: "1",
      unit_price: "",
    });

    qc.invalidateQueries({ queryKey: ["invoices"] });
  };

  const openEditAdj = (adj: any) => {
    setEditingAdj(adj);

    setAdjForm({
      invoice_id: adj.invoice_id,
      amount: String(adj.amount),
    });

    setAdjDialog(true);
  };

  const saveAdjustment = async () => {
    if (!user || !adjForm.invoice_id || !adjForm.amount) return;

    const amountNum = Number(adjForm.amount);

    const inv = invoices.find(
      (i: any) => i.id === adjForm.invoice_id
    );

    const payload: any = {
      user_id: user.id,
      invoice_id: adjForm.invoice_id,
      amount: amountNum,
      month_year: inv
        ? `${inv.reference_month}/${inv.reference_year}`
        : "manual",
    };

    if (editingAdj) {
      payload.id = editingAdj.id;
    }

    const { error } = await supabase
      .from("invoice_initial_balances")
      .upsert(payload);

    if (error) {
      toast.error(error.message);
      return;
    }

    await triggerRecompute(adjForm.invoice_id);

    toast.success(
      editingAdj
        ? "Ajuste atualizado"
        : "Ajuste criado"
    );

    setAdjDialog(false);
    setEditingAdj(null);

    qc.invalidateQueries({
      queryKey: ["initial_balances"],
    });
  };

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-6">
        Faturas
      </h1>

      {invLoading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : (
        <div className="space-y-4">
          {invoices.map((inv: any) => (
            <InvCard
              key={inv.id}
              inv={inv}
              onPay={() => {
                setPayInv(inv);
                setPayAccount(cashAccounts[0]?.id ?? "");
              }}
              onAddItem={() => {
                setPayInv(inv);

                setItemDialog(true);

                setItemForm({
                  description: "",
                  quantity: "1",
                  unit_price: "",
                });
              }}
              onEditPayment={() =>
                openEditPayment(inv)
              }
            />
          ))}
        </div>
      )}

      {/* MODAL ITEM */}
      <Dialog
        open={itemDialog}
        onOpenChange={setItemDialog}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Adicionar item extra
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label>Descrição</Label>

              <Input
                value={itemForm.description}
                onChange={(e) =>
                  setItemForm({
                    ...itemForm,
                    description: e.target.value,
                  })
                }
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Quantidade</Label>

                <Input
                  type="number"
                  value={itemForm.quantity}
                  onChange={(e) =>
                    setItemForm({
                      ...itemForm,
                      quantity: e.target.value,
                    })
                  }
                />
              </div>

              <div>
                <Label>Valor unitário</Label>

                <Input
                  type="number"
                  step="0.01"
                  value={itemForm.unit_price}
                  onChange={(e) =>
                    setItemForm({
                      ...itemForm,
                      unit_price: e.target.value,
                    })
                  }
                />
              </div>
            </div>

            <Button
              onClick={saveItem}
              className="w-full"
            >
              Adicionar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function InvCard({
  inv,
  onPay,
  onAddItem,
  onEditPayment,
}: any) {
  const [expanded, setExpanded] = useState(false);

  const { data: details } = useQuery({
    queryKey: ["invoice-details", inv.id],

    queryFn: async () => {
      const [txR, itemsR] = await Promise.all([
        supabase
          .from("transactions")
          .select("*")
          .eq("invoice_id", inv.id),

        supabase
          .from("invoice_items")
          .select("*")
          .eq("invoice_id", inv.id),
      ]);

      return {
        transactions: txR.data ?? [],
        items: itemsR.data ?? [],
      };
    },

    enabled: expanded,
  });

  return (
    <div className="rounded-2xl border p-4 bg-surface-1">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="font-bold">
            {inv.accounts?.name}
          </div>

          <div className="text-sm text-muted-foreground">
            {monthNames[inv.reference_month - 1]}/
            {inv.reference_year}
          </div>

          <div className="text-2xl font-bold mt-2">
            {formatBRL(Number(inv.total_amount))}
          </div>
        </div>

        <div className="flex gap-2">
          <Button size="sm" onClick={onPay}>
            Pagar
          </Button>

          <Button
            size="sm"
            variant="outline"
            onClick={onAddItem}
          >
            <Plus className="h-4 w-4" />
          </Button>

          <Button
            size="sm"
            variant="ghost"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="mt-4 space-y-2 border-t pt-4">
          {details?.transactions.map((t: any) => (
            <div
              key={t.id}
              className="flex justify-between text-sm"
            >
              <span>{t.description}</span>

              <span>
                {formatBRL(Number(t.amount))}
              </span>
            </div>
          ))}

          {details?.items.map((it: any) => (
            <div
              key={it.id}
              className="flex justify-between text-sm text-primary"
            >
              <span>{it.description}</span>

              <span>
                {formatBRL(Number(it.amount))}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}