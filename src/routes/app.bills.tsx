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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Trash2, Check, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

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

  const { data: bills = [] } = useQuery({
    queryKey: ["bills", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from<any>("fixed_bills").select("*").eq("active", true).order("due_day");
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const { data: occs = [] } = useQuery({
    queryKey: ["occs", user?.id, ref.month, ref.year],
    queryFn: async () => {
      const { data, error } = await supabase.from<any>("recurring_occurrences").select("*").eq("reference_month", ref.month).eq("reference_year", ref.year);
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const { data: cats = [] } = useQuery({
    queryKey: ["categories", user?.id],
    queryFn: async () => {
      const { data } = await supabase.from<any>("categories").select("*").eq("kind", "expense");
      return data ?? [];
    },
    enabled: !!user,
  });

  const { data: accounts = [] } = useQuery({
    queryKey: ["accounts", user?.id],
    queryFn: async () => {
      const { data } = await supabase.from<any>("accounts").select("*").eq("archived", false);
      return data ?? [];
    },
    enabled: !!user,
  });

  const occByBill = new Map<string, any>();
  occs.forEach((o: any) => occByBill.set(o.fixed_bill_id, o));

  const create = async () => {
    if (!user || !form.name || !form.due_day) return;
    const expected = form.amount_kind === "fixed" ? Number(form.expected_amount) : 0;
    const { error } = await supabase.from<any>("fixed_bills").insert({
      user_id: user.id,
      name: form.name,
      expected_amount: expected,
      due_day: Number(form.due_day),
      amount_kind: form.amount_kind,
      category_id: form.category_id || null,
      default_account_id: form.default_account_id || null,
    });
    if (error) toast.error(error.message);
    else {
      toast.success("Recorrente criada");
      setOpen(false);
      setForm({ name: "", expected_amount: "", due_day: "", amount_kind: "fixed", category_id: "", default_account_id: "" });
      qc.invalidateQueries({ queryKey: ["bills"] });
    }
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from<any>("fixed_bills").update({ active: false }).eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success("Removida"); qc.invalidateQueries({ queryKey: ["bills"] }); }
  };

  const markPaid = async (bill: any, amountValue: number) => {
    if (!user) return;
    if (!amountValue || amountValue <= 0) { toast.error("Informe o valor"); return; }
    const today = new Date();
    const occurredOn = `${ref.year}-${String(ref.month).padStart(2, "0")}-${String(Math.min(bill.due_day, 28)).padStart(2, "0")}`;
    // Cria a transação
    const { data: tx, error: txErr } = await supabase.from<any>("transactions").insert({
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
    }).select().single();
    if (txErr) { toast.error(txErr.message); return; }
    // Upsert da ocorrência
    const { error: occErr } = await supabase.from<any>("recurring_occurrences").upsert({
      user_id: user.id,
      fixed_bill_id: bill.id,
      reference_month: ref.month,
      reference_year: ref.year,
      amount: amountValue,
      status: "paid",
      transaction_id: tx.id,
    }, { onConflict: "fixed_bill_id,reference_month,reference_year" });
    if (occErr) toast.error(occErr.message);
    else {
      toast.success("Lançado");
      setPayOpen(null);
      setPayAmount("");
      qc.invalidateQueries({ queryKey: ["occs"] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    }
  };

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto animate-in fade-in duration-300">
      <div className="flex items-center justify-between mb-2">
        <h1 className="font-display text-2xl md:text-3xl font-bold">Recorrentes</h1>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-2" />Nova</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Nova despesa recorrente</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div><Label>Nome</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ex: Energia elétrica" className="mt-1.5" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Tipo de valor</Label>
                  <Select value={form.amount_kind} onValueChange={(v) => setForm({ ...form, amount_kind: v })}>
                    <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="fixed">Fixo (mesmo valor todo mês)</SelectItem>
                      <SelectItem value="variable">Variável (preencho depois)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>Vence dia</Label><Input type="number" min={1} max={31} value={form.due_day} onChange={(e) => setForm({ ...form, due_day: e.target.value })} className="mt-1.5" /></div>
              </div>
              {form.amount_kind === "fixed" && (
                <div><Label>Valor</Label><Input type="number" step="0.01" value={form.expected_amount} onChange={(e) => setForm({ ...form, expected_amount: e.target.value })} className="mt-1.5" /></div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Categoria</Label>
                  <Select value={form.category_id} onValueChange={(v) => setForm({ ...form, category_id: v })}>
                    <SelectTrigger className="mt-1.5"><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>
                      {cats.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.icon} {c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Conta padrão</Label>
                  <Select value={form.default_account_id} onValueChange={(v) => setForm({ ...form, default_account_id: v })}>
                    <SelectTrigger className="mt-1.5"><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>
                      {accounts.map((a: any) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Button onClick={create} className="w-full">Criar</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
      <p className="text-sm text-muted-foreground mb-6">{monthNames[ref.month - 1]} de {ref.year}</p>

      <div className="rounded-2xl border border-border bg-surface-1 overflow-hidden">
        {bills.length === 0 && <div className="p-8 text-center text-muted-foreground text-sm">Nada cadastrado. A IA também pode criar pelo chat.</div>}
        <div className="divide-y divide-border">
          {bills.map((b: any) => {
            const occ = occByBill.get(b.id);
            const paid = occ?.status === "paid";
            const isVar = b.amount_kind === "variable";
            const displayAmount = paid ? Number(occ.amount) : Number(b.expected_amount);
            return (
              <div key={b.id} className="p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className={cn(
                      "h-2 w-2 rounded-full shrink-0",
                      paid ? "bg-audit-green" : "bg-audit-yellow"
                    )} />
                    <div className="min-w-0">
                      <div className="font-medium truncate">{b.name}</div>
                      <div className="text-xs text-muted-foreground flex gap-2 flex-wrap">
                        <span>vence dia {b.due_day}</span>
                        <span>·</span>
                        <span>{isVar ? "variável" : "fixa"}</span>
                        {paid && <><span>·</span><span className="text-audit-green">pago</span></>}
                        {!paid && !isVar && <><span>·</span><span className="text-audit-yellow flex items-center gap-1"><AlertCircle className="h-3 w-3" />pendente</span></>}
                        {!paid && isVar && <><span>·</span><span className="text-audit-yellow">aguardando valor</span></>}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={cn("font-mono tabular font-semibold whitespace-nowrap", paid ? "text-foreground" : "text-muted-foreground")}>
                      {isVar && !paid ? "—" : formatBRL(displayAmount)}
                    </span>
                    {!paid && (
                      <Button size="sm" variant="outline" onClick={() => { setPayOpen(b.id); setPayAmount(isVar ? "" : String(b.expected_amount)); }}>
                        <Check className="h-3.5 w-3.5 mr-1" /> Lançar
                      </Button>
                    )}
                    <Button size="icon" variant="ghost" onClick={() => remove(b.id)}><Trash2 className="h-4 w-4 text-muted-foreground" /></Button>
                  </div>
                </div>
                {payOpen === b.id && (
                  <div className="mt-3 flex items-center gap-2 p-3 rounded-lg bg-surface-2 border border-border">
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
      </div>
    </div>
  );
}