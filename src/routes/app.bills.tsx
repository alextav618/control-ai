import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { formatBRL, formatDateBR, monthNames, localDateString } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Trash2, Check, AlertCircle, ChevronLeft, ChevronRight, Calendar as CalendarIcon, Hash } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { addMonths, startOfMonth, differenceInMonths, format } from "date-fns";
import { ptBR } from "date-fns/locale";

export const Route = createFileRoute("/app/bills")({
  component: BillsPage,
});

const FREQUENCIES = [
  { value: "monthly", label: "Mensal", interval: 1 },
  { value: "bimonthly", label: "Bimestral", interval: 2 },
  { value: "quarterly", label: "Trimestral", interval: 3 },
  { value: "semiannual", label: "Semestral", interval: 6 },
  { value: "annual", label: "Anual", interval: 12 },
];

function BillsPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  
  // Controle de Mês Exibido
  const [viewDate, setViewDate] = useState(new Date(2026, 4, 10)); // Ref: Maio 2026
  const currentMonth = viewDate.getMonth() + 1;
  const currentYear = viewDate.getFullYear();

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ 
    name: "", 
    expected_amount: "", 
    due_day: "10", 
    amount_kind: "fixed", 
    category_id: "", 
    default_account_id: "",
    frequency: "monthly",
    start_date: localDateString(new Date(2026, 4, 1)),
    total_installments: ""
  });

  const [payOpen, setPayOpen] = useState<string | null>(null);
  const [payAmount, setPayAmount] = useState("");

  const { data: allBills = [] } = useQuery({
    queryKey: ["fixed-bills", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("fixed_bills").select("*").eq("active", true).order("due_day");
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const { data: occs = [] } = useQuery({
    queryKey: ["occs", user?.id, currentMonth, currentYear],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("recurring_occurrences")
        .select("*")
        .eq("reference_month", currentMonth)
        .eq("reference_year", currentYear);
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const { data: cats = [] } = useQuery({
    queryKey: ["categories", user?.id],
    queryFn: async () => {
      const { data } = await supabase.from("categories").select("*").eq("kind", "expense");
      return data ?? [];
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

  // Lógica de Filtro por Frequência
  const visibleBills = useMemo(() => {
    return allBills.filter((bill: any) => {
      const startDate = new Date(bill.start_date + "T12:00:00");
      const targetDate = startOfMonth(viewDate);
      
      const diffMonths = differenceInMonths(targetDate, startOfMonth(startDate));
      
      if (diffMonths < 0) return false; // Ainda não começou

      const freqMeta = FREQUENCIES.find(f => f.value === (bill.frequency || "monthly"));
      const interval = freqMeta?.interval || 1;

      // Verifica se o mês atual faz parte do ciclo (ex: a cada 6 meses)
      const isCycleMonth = diffMonths % interval === 0;
      if (!isCycleMonth) return false;

      // Se houver limite de parcelas, verifica se já acabou
      if (bill.total_installments) {
        const installmentNum = (diffMonths / interval) + 1;
        if (installmentNum > bill.total_installments) return false;
      }

      return true;
    });
  }, [allBills, viewDate]);

  const occByBill = new Map<string, any>();
  occs.forEach((o: any) => occByBill.set(o.fixed_bill_id, o));

  const create = async () => {
    if (!user || !form.name || !form.due_day) return;
    const expected = form.amount_kind === "fixed" ? Number(form.expected_amount) : 0;
    
    const payload: any = {
      user_id: user.id,
      name: form.name,
      expected_amount: expected,
      due_day: Number(form.due_day),
      amount_kind: form.amount_kind,
      category_id: form.category_id || null,
      default_account_id: form.default_account_id || null,
      frequency: form.frequency,
      start_date: form.start_date,
      total_installments: form.total_installments ? Number(form.total_installments) : null,
    };

    const { error } = await (supabase as any).from("fixed_bills").insert(payload);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Despesa fixa criada");
      setOpen(false);
      setForm({ 
        name: "", expected_amount: "", due_day: "10", amount_kind: "fixed", 
        category_id: "", default_account_id: "", frequency: "monthly", 
        start_date: localDateString(new Date(2026, 4, 1)), total_installments: "" 
      });
      qc.invalidateQueries({ queryKey: ["fixed-bills"] });
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Remover esta despesa fixa?")) return;
    const { error } = await supabase.from("fixed_bills").update({ active: false }).eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success("Removida"); qc.invalidateQueries({ queryKey: ["fixed-bills"] }); }
  };

  const markPaid = async (bill: any, amountValue: number) => {
    if (!user) return;
    if (!amountValue || amountValue <= 0) { toast.error("Informe o valor"); return; }
    
    const occurredOn = `${currentYear}-${String(currentMonth).padStart(2, "0")}-${String(Math.min(bill.due_day, 28)).padStart(2, "0")}`;
    
    const { data: tx, error: txErr } = await supabase.from("transactions").insert({
      user_id: user.id,
      type: "expense",
      amount: Number(amountValue),
      description: `${bill.name} (${monthNames[currentMonth - 1]}/${currentYear})`,
      occurred_on: occurredOn,
      account_id: bill.default_account_id ?? null,
      category_id: bill.category_id ?? null,
      fixed_bill_id: bill.id,
      status: "paid",
      source: "manual",
    }).select().single();
    
    if (txErr) { toast.error(txErr.message); return; }
    
    await supabase.from("recurring_occurrences").upsert({
      user_id: user.id,
      fixed_bill_id: bill.id,
      reference_month: currentMonth,
      reference_year: currentYear,
      amount: Number(amountValue),
      status: "paid",
      transaction_id: tx.id,
    }, { onConflict: "fixed_bill_id,reference_month,reference_year" });
    
    toast.success("Lançamento confirmado");
    setPayOpen(null);
    setPayAmount("");
    qc.invalidateQueries({ queryKey: ["occs"] });
    qc.invalidateQueries({ queryKey: ["transactions"] });
  };

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto animate-in fade-in duration-300">
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center bg-surface-1 border border-border rounded-xl p-1 shadow-card">
            <Button variant="ghost" size="icon" onClick={() => setViewDate(addMonths(viewDate, -1))} className="h-9 w-9"><ChevronLeft className="h-5 w-5" /></Button>
            <div className="px-4 min-w-[140px] text-center">
              <div className="text-xs text-muted-foreground uppercase font-bold tracking-tighter">{currentYear}</div>
              <div className="font-display font-bold text-sm capitalize">{format(viewDate, "MMMM", { locale: ptBR })}</div>
            </div>
            <Button variant="ghost" size="icon" onClick={() => setViewDate(addMonths(viewDate, 1))} className="h-9 w-9"><ChevronRight className="h-5 w-5" /></Button>
          </div>
          <Button variant="outline" size="sm" onClick={() => setViewDate(new Date(2026, 4, 10))} className="rounded-xl h-11 px-4 gap-2">
            <CalendarIcon className="h-4 w-4" /> Hoje
          </Button>
        </div>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button className="h-11 px-6 shadow-glow"><Plus className="h-4 w-4 mr-2" /> Nova Despesa</Button></DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Cadastrar Despesa Fixa</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div>
                <Label>Nome da Despesa</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ex: Aluguel, Seguro, IPTU" className="mt-1.5" />
              </div>
              
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Tipo de Valor</Label>
                  <Select value={form.amount_kind} onValueChange={(v) => setForm({ ...form, amount_kind: v })}>
                    <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="fixed">Valor Fixo</SelectItem>
                      <SelectItem value="variable">Valor Variável</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Vencimento (Dia)</Label>
                  <Input type="number" min={1} max={31} value={form.due_day} onChange={(e) => setForm({ ...form, due_day: e.target.value })} className="mt-1.5" />
                </div>
              </div>

              {form.amount_kind === "fixed" && (
                <div>
                  <Label>Valor Esperado (R$)</Label>
                  <Input type="number" step="0.01" value={form.expected_amount} onChange={(e) => setForm({ ...form, expected_amount: e.target.value })} className="mt-1.5" />
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Frequência (Ciclo)</Label>
                  <Select value={form.frequency} onValueChange={(v) => setForm({ ...form, frequency: v })}>
                    <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {FREQUENCIES.map(f => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Mês de Início</Label>
                  <Input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} className="mt-1.5" />
                </div>
              </div>

              <div>
                <Label className="flex items-center gap-2">
                  Total de Parcelas <span className="text-[10px] text-muted-foreground uppercase">(Opcional)</span>
                </Label>
                <Input type="number" placeholder="Vazio para permanente" value={form.total_installments} onChange={(e) => setForm({ ...form, total_installments: e.target.value })} className="mt-1.5" />
                <p className="text-[10px] text-muted-foreground mt-1">Se preenchido, a despesa será removida da lista após a última parcela.</p>
              </div>

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
                  <Label>Conta Padrão</Label>
                  <Select value={form.default_account_id} onValueChange={(v) => setForm({ ...form, default_account_id: v })}>
                    <SelectTrigger className="mt-1.5"><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>
                      {accounts.map((a: any) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <Button onClick={create} className="w-full mt-2">Salvar Despesa Fixa</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="space-y-4">
        <h2 className="font-display font-semibold text-xs text-muted-foreground uppercase tracking-widest px-1">
          Lançamentos Previstos para {format(viewDate, "MMMM", { locale: ptBR })}
        </h2>

        <div className="rounded-3xl border border-border bg-surface-1 overflow-hidden shadow-card">
          {visibleBills.length === 0 ? (
            <div className="p-16 text-center text-muted-foreground text-sm flex flex-col items-center gap-3">
              <CalendarIcon className="h-8 w-8 opacity-20" />
              Nenhuma despesa fixa prevista para este mês.
            </div>
          ) : (
            <div className="divide-y divide-border">
              {visibleBills.map((b: any) => {
                const occ = occByBill.get(b.id);
                const paid = occ?.status === "paid";
                const isVar = b.amount_kind === "variable";
                const displayAmount = paid ? Number(occ.amount) : Number(b.expected_amount);
                const freqLabel = FREQUENCIES.find(f => f.value === b.frequency)?.label || "Mensal";
                
                return (
                  <div key={b.id} className="p-4 hover:bg-surface-2/30 transition-colors group">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-4 min-w-0">
                        <div className={cn(
                          "h-10 w-10 rounded-xl flex items-center justify-center shrink-0 shadow-sm",
                          paid ? "bg-audit-green/10 text-audit-green" : "bg-audit-yellow/10 text-audit-yellow"
                        )}>
                          <Check className={cn("h-5 w-5", !paid && "opacity-20")} />
                        </div>
                        <div className="min-w-0">
                          <div className="font-display font-semibold truncate flex items-center gap-2">
                            {b.name}
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground font-mono uppercase">
                              {freqLabel}
                            </span>
                            {b.total_installments && (
                              <span className="text-[10px] flex items-center gap-0.5 text-primary">
                                <Hash className="h-2.5 w-2.5" /> Parc.
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-muted-foreground flex gap-2 flex-wrap items-center">
                            <span>Vence dia {b.due_day}</span>
                            <span>·</span>
                            <span>{isVar ? "valor variável" : "valor fixo"}</span>
                            {paid && <span className="text-audit-green font-bold uppercase tracking-tighter">PAGO</span>}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className={cn("font-mono tabular font-bold text-sm", paid ? "text-foreground" : "text-muted-foreground")}>
                          {isVar && !paid ? "—" : formatBRL(displayAmount)}
                        </span>
                        {!paid && (
                          <Button size="sm" variant="outline" onClick={() => { setPayOpen(b.id); setPayAmount(isVar ? "" : String(b.expected_amount)); }} className="rounded-lg">
                            Lançar
                          </Button>
                        )}
                        <Button size="icon" variant="ghost" onClick={() => remove(b.id)} className="opacity-0 group-hover:opacity-100 transition-opacity">
                          <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                        </Button>
                      </div>
                    </div>
                    {payOpen === b.id && (
                      <div className="mt-4 flex items-center gap-3 p-4 rounded-2xl bg-surface-2 border border-border animate-in slide-in-from-top-2">
                        <div className="flex-1">
                          <Label className="text-[10px] uppercase font-bold text-muted-foreground">Valor pago</Label>
                          <Input type="number" step="0.01" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} autoFocus className="mt-1" />
                        </div>
                        <div className="flex gap-2 pt-5">
                          <Button size="sm" onClick={() => markPaid(b, Number(payAmount))}>Confirmar</Button>
                          <Button size="sm" variant="ghost" onClick={() => { setPayOpen(null); setPayAmount(""); }}>Cancelar</Button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}