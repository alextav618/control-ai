import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { formatBRL } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Plus, CreditCard, Wallet, Trash2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type AccountRow = {
  id: string;
  user_id: string;
  name: string;
  type: string;
  closing_day?: number;
  due_day?: number;
  credit_limit?: number;
  current_balance?: number;
  archived: boolean;
};

export const Route = createFileRoute("/app/accounts")({
  component: AccountsPage,
});

function AccountsPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    type: "bank" as string,
    current_balance: "0",
    closing_day: "",
    due_day: "",
    credit_limit: "",
  });
  const [confirmDel, setConfirmDel] = useState<AccountRow | null>(null);

  const { data: rawAccounts = [] } = useQuery<AccountRow[]>({
    queryKey: ["accounts", user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await supabase
        .from<AccountRow>("accounts")
        .select("*")
        .eq("archived", false)
        .order("created_at");
      if (error) throw error;
      return data || [];
    },
    enabled: !!user,
  });

  const submit = async () => {
    if (!user || !form.name) { toast.error("Informe o nome"); return; }
    const payload: Partial<AccountRow> & { user_id: string } = { user_id: user.id };
    
    if (form.type === "bank" || form.type === "credit_card") {
      payload.closing_day = Number(form.closing_day) || 1;
      payload.due_day = Number(form.due_day) || 10;
      if (form.type === "credit_card") payload.credit_limit = form.credit_limit ? Number(form.credit_limit) : null;
    } else {
      payload.current_balance = Number(form.current_balance) || 0;
    }

    if (editId) {
      const { error } = await supabase.from<AccountRow>("accounts").update(payload).eq("id", editId);
      if (error) { toast.error(error.message); return; }
      toast.success("Conta atualizada");
    } else {
      const { error } = await supabase.from<AccountRow>("accounts").insert(payload);
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
    const { error } = await supabase.from<AccountRow>("accounts").update({ archived: true }).eq("id", confirmDel.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Conta excluída");
    qc.invalidateQueries({ queryKey: ["accounts"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    qc.invalidateQueries({ queryKey: ["invoices"] });
    setConfirmDel(null);
  };

  // ... rest of existing code, fix calcDisponivelTotal and calcObrigatorioTotal to use actual data
  function calcDisponivelTotal(): string {
    if (!rawAccounts) return "0";
    const total = rawAccounts
      .filter(a => a.type !== "credit_card")
      .reduce((sum, a) => sum + Number(a.current_balance || 0), 0);
    return formatBRL(total);
  }

  function calcObrigatorioTotal(): string {
    // Implement actual calculation for obligations
    return "0";
  }
}