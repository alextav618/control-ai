import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { formatBRL, currentMonthYear, monthNames } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Trash2, Check } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type FixedBillRow = {
  id: string;
  user_id: string;
  name: string;
  expected_amount: number;
  due_day: number;
  amount_kind: string;
  category_id: string | null;
  default_account_id: string | null;
  active: boolean;
};

type TransactionRow = {
  id: string;
  user_id: string;
  type: string;
  amount: number;
  description: string;
  occurred_on: string;
  account_id: string | null;
  category_id: string | null;
  fixed_bill_id: string | null;
  status: string;
  source: string;
};

type RecurringOccurrenceRow = {
  id: string;
  user_id: string;
  fixed_bill_id: string;
  reference_month: number;
  reference_year: number;
  amount: number;
  status: string;
  transaction_id: string | null;
};

export const Route = createFileRoute("/app/bills")({
  component: BillsPage,
});

function BillsPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", expected_amount: "", due_day: "", amount_kind: "fixed", category_id: "", default_account_id: "" });
  const [payOpen, setPayOpen] = useState<string | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const ref = currentMonthYear();

  const { data: bills = [] } = useQuery<FixedBillRow[]>({
    queryKey: ["bills", user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await supabase.from<FixedBillRow>("fixed_bills").select("*").eq("active", true).order("due_day");
      if (error) throw error;
      return data || [];
    },
    enabled: !!user,
  });

  const create = async () => {
    if (!user || !form.name || !form.due_day) return;
    const expected = form.amount_kind === "fixed" ? Number(form.expected_amount) : 0;
    const { error } = await supabase.from<FixedBillRow>("fixed_bills").insert({
      user_id: user.id,
      name: form.name,
      expected_amount: expected,
      due_day: Number(form.due_day),
      amount_kind: form.amount_kind,
      category_id: form.category_id || null,
      default_account_id: form.default_account_id || null,
    });
    if (error) { toast.error(error.message); return; }
    toast.success("Recorrente criada");
    setOpen(false);
    qc.invalidateQueries({ queryKey: ["bills"] });
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from<FixedBillRow>("fixed_bills").update({ active: false }).eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Removida");
    qc.invalidateQueries({ queryKey: ["bills"] });
  };

  const markPaid = async (bill: FixedBillRow, amountValue: number) => {
    if (!user) return;
    if (!amountValue || amountValue <= 0) { toast.error("Informe o valor"); return; }
    const today = new Date();
    const occurredOn = `${ref.year}-${String(ref.month).padStart(2, "0")}-${String(Math.min(bill.due_day, 28)).padStart(2, "0")}`;
    
    const { data: tx, error: txErr } = await supabase
      .from<TransactionRow>("transactions")
      .insert({
        user_id: user.id,
        type: "expense",
        amount: amountValue,
        description: `${bill.name} (${monthNames[ref.month - 1]}/${ref.year})`,
        occurred_on: occurredOn,
        account_id: bill.default_account_id ?? null,
        category_id: bill.category_id ?? null,
        fixed_bill_id: bill.id,
        status: "paid",
        source: "manual",
      })
      .select()
      .single();
    if (txErr) { toast.error(txErr.message); return; }

    const { error: occErr } = await supabase
      .from<RecurringOccurrenceRow>("recurring_occurrences")
      .upsert({
        user_id: user.id,
        fixed_bill_id: bill.id,
        reference_month: ref.month,
        reference_year: ref.year,
        amount: amountValue,
        status: "paid",
        transaction_id: tx.id,
      }, { onConflict: "fixed_bill_id,reference_month,reference_year" });
    if (occErr) { toast.error(occErr.message); return; }

    toast.success("Lançado");
    setPayOpen(null);
    setPayAmount("");
    qc.invalidateQueries({ queryKey: ["occs"] });
    qc.invalidateQueries({ queryKey: ["transactions"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  };

  // ... rest of existing code
}