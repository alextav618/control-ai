import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { formatBRL, formatDateBR, monthNames } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Check, CreditCard, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/invoices")({
  component: InvoicesPage,
});

function InvoicesPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [payInv, setPayInv] = useState<any>(null);
  const [payAccount, setPayAccount] = useState("");
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10));

  const { data: invoices = [] } = useQuery({
    queryKey: ["invoices", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("invoices").select("*, accounts(name, type)").order("due_date", { ascending: false });
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

    // Cria transaction de despesa "Pagamento de fatura"
    const { error: txErr } = await supabase.from("transactions").insert({
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

    // Debita saldo da conta de pagamento
    const acc = accounts.find((a: any) => a.id === payAccount);
    if (acc) {
      await supabase.from("accounts").update({ current_balance: Number(acc.current_balance) - Number(payInv.total_amount) }).eq("id", acc.id);
    }

    // Marca invoice como paga
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

  const open = invoices.filter((i: any) => i.status !== "paid");
  const paid = invoices.filter((i: any) => i.status === "paid");

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto animate-in fade-in duration-300">
      <h1 className="font-display text-2xl md:text-3xl font-bold mb-6">Faturas</h1>

      <section className="mb-8">
        <h2 className="font-display font-semibold mb-3 text-sm text-muted-foreground uppercase tracking-wide">Em aberto ({open.length})</h2>
        {open.length === 0 ? (
          <div className="rounded-2xl border border-border bg-surface-1 p-8 text-center text-sm text-muted-foreground">
            Nenhuma fatura em aberto 🎉
          </div>
        ) : (
          <div className="space-y-2">
            {open.map((inv: any) => <InvCard key={inv.id} inv={inv} onPay={() => openPay(inv)} />)}
          </div>
        )}
      </section>

      {paid.length > 0 && (
        <section>
          <h2 className="font-display font-semibold mb-3 text-sm text-muted-foreground uppercase tracking-wide">Pagas</h2>
          <div className="space-y-2">
            {paid.slice(0, 12).map((inv: any) => <InvCard key={inv.id} inv={inv} onReopen={() => reopen(inv)} />)}
          </div>
        </section>
      )}

      <Dialog open={!!payInv} onOpenChange={(v) => !v && setPayInv(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Pagar fatura</DialogTitle></DialogHeader>
          {payInv && (
            <div className="space-y-4">
              <div className="rounded-lg bg-surface-2 p-4">
                <div className="text-xs text-muted-foreground">{payInv.accounts?.name}</div>
                <div className="font-mono tabular text-2xl font-bold mt-1">{formatBRL(Number(payInv.total_amount))}</div>
                <div className="text-xs text-muted-foreground mt-1">vence {formatDateBR(payInv.due_date)}</div>
              </div>
              <div>
                <Label>Pagar com</Label>
                <Select value={payAccount} onValueChange={setPayAccount}>
                  <SelectTrigger className="mt-1.5"><SelectValue placeholder="Escolha a conta" /></SelectTrigger>
                  <SelectContent>
                    {cashAccounts.map((a: any) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name} · {formatBRL(Number(a.current_balance))}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Data do pagamento</Label>
                <Input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} className="mt-1.5" />
              </div>
              <Button onClick={confirmPay} className="w-full"><Check className="h-4 w-4 mr-2" />Confirmar pagamento</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function InvCard({ inv, onPay, onReopen }: { inv: any; onPay?: () => void; onReopen?: () => void }) {
  const due = new Date(inv.due_date);
  const days = Math.ceil((due.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  const overdue = inv.status !== "paid" && days < 0;
  const urgent = inv.status !== "paid" && days >= 0 && days <= 5;
  const isPaid = inv.status === "paid";

  return (
    <div className={cn(
      "rounded-2xl border bg-surface-1 p-4 flex items-center gap-3 shadow-card transition-all",
      overdue ? "border-audit-red/40" : urgent ? "border-audit-yellow/40" : "border-border",
      isPaid && "opacity-70"
    )}>
      <div className="h-10 w-10 rounded-lg bg-surface-2 flex items-center justify-center shrink-0">
        <CreditCard className="h-5 w-5 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-medium flex items-center gap-2 flex-wrap">
          {inv.accounts?.name}
          {overdue && <span className="text-[10px] px-1.5 py-0.5 rounded bg-audit-red/20 text-audit-red flex items-center gap-1"><AlertCircle className="h-3 w-3" />{Math.abs(days)}d em atraso</span>}
          {urgent && <span className="text-[10px] px-1.5 py-0.5 rounded bg-audit-yellow/20 text-audit-yellow">{days === 0 ? "vence hoje" : `${days}d`}</span>}
          {isPaid && <span className="text-[10px] px-1.5 py-0.5 rounded bg-audit-green/20 text-audit-green">paga</span>}
        </div>
        <div className="text-xs text-muted-foreground mt-0.5">
          {monthNames[inv.reference_month - 1]}/{inv.reference_year} · vence {formatDateBR(inv.due_date)}
        </div>
      </div>
      <div className="font-mono tabular font-semibold text-expense whitespace-nowrap">{formatBRL(Number(inv.total_amount))}</div>
      {onPay && <Button size="sm" onClick={onPay}><Check className="h-3.5 w-3.5 mr-1" />Pagar</Button>}
      {onReopen && <Button size="sm" variant="ghost" onClick={onReopen}>Reabrir</Button>}
    </div>
  );
}
