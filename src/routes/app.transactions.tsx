import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { formatBRL, formatDateBR, localDateString } from "@/lib/format";
import { 
  Trash2, Plus, Pencil, Search, ArrowRightLeft, ShieldCheck, 
  AlertTriangle, AlertCircle, Info, CreditCard, Wallet,
  ChevronLeft, ChevronRight, Calendar as CalendarIcon,
  Loader2, Link as LinkIcon
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { addMonths, startOfMonth, endOfMonth, format } from "date-fns";
import { ptBR } from "date-fns/locale";

export const Route = createFileRoute("/app/transactions")({
  component: TxPage,
});

function TxPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  
  const [viewDate, setViewDate] = useState(new Date(2026, 4, 10)); // Ref: Maio 2026
  
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState("all");
  const [propagate, setPropagate] = useState(false);
  const [activeFormTab, setActiveFormTab] = useState("common");

  const [form, setForm] = useState({
    type: "expense",
    description: "",
    amount: "",
    occurred_on: localDateString(new Date(2026, 4, 10)),
    account_id: "",
    to_account_id: "",
    category_id: "",
    payment_method: "debito",
  });

  const resetForm = () => {
    setForm({ 
      type: "expense", 
      description: "", 
      amount: "", 
      occurred_on: localDateString(viewDate), 
      account_id: "", 
      to_account_id: "", 
      category_id: "", 
      payment_method: "debito"
    });
    setEditId(null);
    setPropagate(false);
    setActiveFormTab("common");
  };

  useEffect(() => { if (!open) resetForm(); }, [open]);

  const { data: rawTx = [], isLoading: txLoading } = useQuery({
    queryKey: ["transactions", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("transactions").select("*").order("occurred_on", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const { data: accounts = [] } = useQuery({
    queryKey: ["accounts", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("accounts").select("*").eq("archived", false).order("name");
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user,
  });

  const { data: cats = [] } = useQuery({
    queryKey: ["categories", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("categories").select("*");
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user,
  });

  const cashAccounts = useMemo(() => accounts.filter((a: any) => a.type !== "credit_card"), [accounts]);
  const creditCardAccounts = useMemo(() => accounts.filter((a: any) => a.type === "credit_card"), [accounts]);

  const tx = useMemo(() => {
    const sMonth = startOfMonth(viewDate);
    const eMonth = endOfMonth(viewDate);
    
    return rawTx
      .map((t: any) => ({
        ...t,
        categories: cats.find((c: any) => c.id === t.category_id),
        accounts: accounts.find((a: any) => a.id === t.account_id),
      }))
      .filter((t: any) => {
        const d = new Date(t.occurred_on + "T12:00:00");
        const isInMonth = d >= sMonth && d <= eMonth;
        const matchesSearch = (t.description || "").toLowerCase().includes(search.toLowerCase());
        const matchesType = filterType === "all" || t.type === filterType;
        
        return isInMonth && matchesSearch && matchesType;
      });
  }, [rawTx, cats, accounts, viewDate, search, filterType]);

  const summary = useMemo(() => {
    const validTx = tx.filter(t => t.type !== 'transfer');
    const income = validTx.filter(t => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0);
    const expense = validTx.filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0);
    return { income, expense, balance: income - expense };
  }, [tx]);

  const groupedTx = useMemo(() => {
    const groups: Record<string, any[]> = {};
    tx.forEach(t => {
      if (!groups[t.occurred_on]) groups[t.occurred_on] = [];
      groups[t.occurred_on].push(t);
    });
    return Object.entries(groups).sort((a, b) => b[0].localeCompare(a[0]));
  }, [tx]);

  const handleSave = async () => {
    if (!user || !form.description || !form.amount || !form.account_id) {
      toast.error("Preencha os campos obrigatórios");
      return;
    }

    setSubmitting(true);
    try {
      const payload: any = {
        user_id: user.id,
        type: form.type,
        description: form.description,
        amount: Number(form.amount),
        occurred_on: form.occurred_on,
        account_id: form.account_id,
        to_account_id: form.type === "transfer" ? form.to_account_id : null,
        category_id: form.category_id || null,
        payment_method: form.payment_method,
      };

      if (editId) {
        const { error } = await supabase.from("transactions").update(payload).eq("id", editId);
        if (error) throw error;

        const originalTx = rawTx.find(t => t.id === editId);
        if (originalTx?.installment_plan_id && originalTx.installment_number === 1 && propagate) {
          const { error: propErr } = await supabase
            .from("transactions")
            .update({
              description: form.description,
              amount: Number(form.amount),
              category_id: form.category_id || null,
            })
            .eq("installment_plan_id", originalTx.installment_plan_id)
            .gt("installment_number", 1);
          
          if (propErr) throw propErr;
          toast.success("Lançamento e parcelas futuras atualizados!");
        } else {
          toast.success("Lançamento atualizado!");
        }
      } else {
        const { error } = await supabase.from("transactions").insert(payload);
        if (error) throw error;
        toast.success("Lançamento criado!");
      }

      setOpen(false);
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["invoices"] });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const prevMonth = () => setViewDate(addMonths(viewDate, -1));
  const nextMonth = () => setViewDate(addMonths(viewDate, 1));
  const goToToday = () => setViewDate(new Date(2026, 4, 10));

  const removeTx = async (id: string) => {
    if (!confirm("Excluir este lançamento?")) return;
    const { error } = await supabase.from("transactions").delete().eq("id", id);
    if (error) toast.error(error.message);
    else {
      toast.success("Excluído");
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["accounts"] });
    }
  };

  const editTx = (t: any) => {
    const account = accounts.find((a: any) => a.id === t.account_id);
    const isCreditCard = account?.type === "credit_card";
    
    setForm({
      type: t.type,
      description: t.description,
      amount: String(t.amount),
      occurred_on: t.occurred_on,
      account_id: t.account_id || "",
      to_account_id: t.to_account_id || "",
      category_id: t.category_id || "",
      payment_method: t.payment_method || "debito",
    });
    setEditId(t.id);
    setActiveFormTab(isCreditCard ? "credit" : "common");
    setOpen(true);
  };

  const currentEditingTx = rawTx.find(t => t.id === editId);
  const canPropagate = currentEditingTx?.installment_plan_id && currentEditingTx?.installment_number === 1;

  const handleTabChange = (val: string) => {
    setActiveFormTab(val);
    setForm(prev => ({ 
      ...prev, 
      account_id: "", 
      type: val === "credit" ? "expense" : "expense" 
    }));
  };

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto animate-in fade-in duration-300">
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center bg-surface-1 border border-border rounded-xl p-1 shadow-card">
            <Button variant="ghost" size="icon" onClick={prevMonth} className="h-9 w-9"><ChevronLeft className="h-5 w-5" /></Button>
            <div className="px-4 min-w-[140px] text-center">
              <div className="text-xs text-muted-foreground uppercase font-bold tracking-tighter">
                {format(viewDate, "yyyy")}
              </div>
              <div className="font-display font-bold text-sm capitalize">
                {format(viewDate, "MMMM", { locale: ptBR })}
              </div>
            </div>
            <Button variant="ghost" size="icon" onClick={nextMonth} className="h-9 w-9"><ChevronRight className="h-5 w-5" /></Button>
          </div>
          <Button variant="outline" size="sm" onClick={goToToday} className="rounded-xl h-11 px-4 gap-2">
            <CalendarIcon className="h-4 w-4" /> Hoje
          </Button>
        </div>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button className="h-11 px-6 shadow-glow"><Plus className="h-4 w-4 mr-2" /> Novo Lançamento</Button></DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{editId ? "Editar lançamento" : "Novo lançamento"}</DialogTitle>
              <DialogDescription>Escolha o destino do lançamento no topo.</DialogDescription>
            </DialogHeader>
            
            <Tabs value={activeFormTab} onValueChange={handleTabChange} className="w-full">
              <TabsList className="grid w-full grid-cols-2 mb-4">
                <TabsTrigger value="common" className="flex items-center gap-2">
                  <Wallet className="h-4 w-4" /> Dinheiro/Conta
                </TabsTrigger>
                <TabsTrigger value="credit" className="flex items-center gap-2">
                  <CreditCard className="h-4 w-4" /> Cartão de Crédito
                </TabsTrigger>
              </TabsList>

              <div className="space-y-4 pt-2">
                <div>
                  <Label>Tipo</Label>
                  <Select 
                    value={form.type} 
                    onValueChange={(v) => setForm({ ...form, type: v })}
                    disabled={activeFormTab === "credit" && !editId} // Trava em despesa para cartão no novo lançamento
                  >
                    <SelectTrigger className="mt-1.5">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="expense">Despesa</SelectItem>
                      {activeFormTab === "common" && (
                        <>
                          <SelectItem value="income">Receita</SelectItem>
                          <SelectItem value="transfer">Transferência</SelectItem>
                        </>
                      )}
                    </SelectContent>
                  </Select>
                  {activeFormTab === "credit" && (
                    <p className="text-[10px] text-muted-foreground mt-1">Lançamentos em cartão são sempre registrados como despesa.</p>
                  )}
                </div>

                <div>
                  <Label>Descrição</Label>
                  <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Ex: Mercado" className="mt-1.5" />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Valor (R$)</Label>
                    <Input type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="mt-1.5" />
                  </div>
                  <div>
                    <Label>Data</Label>
                    <Input type="date" value={form.occurred_on} onChange={(e) => setForm({ ...form, occurred_on: e.target.value })} className="mt-1.5" />
                  </div>
                </div>

                <div>
                  <Label>{activeFormTab === "credit" ? "Cartão Utilizado" : (form.type === "transfer" ? "Conta de Origem" : "Conta / Carteira")}</Label>
                  <Select value={form.account_id} onValueChange={(v) => setForm({ ...form, account_id: v })}>
                    <SelectTrigger className="mt-1.5"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                    <SelectContent>
                      {(activeFormTab === "common" ? cashAccounts : creditCardAccounts).map((a: any) => (
                        <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {form.type === "transfer" && activeFormTab === "common" && (
                  <div>
                    <Label>Conta de Destino</Label>
                    <Select value={form.to_account_id} onValueChange={(v) => setForm({ ...form, to_account_id: v })}>
                      <SelectTrigger className="mt-1.5"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                      <SelectContent>
                        {cashAccounts.map((a: any) => (
                          <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {form.type !== "transfer" && (
                  <div>
                    <Label>Categoria</Label>
                    <Select value={form.category_id} onValueChange={(v) => setForm({ ...form, category_id: v })}>
                      <SelectTrigger className="mt-1.5"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                      <SelectContent>
                        {cats.map((c: any) => (
                          <SelectItem key={c.id} value={c.id}>{c.icon} {c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {canPropagate && (
                  <div className="flex items-center space-x-2 pt-2 bg-primary/5 p-3 rounded-lg border border-primary/20 animate-in fade-in duration-300">
                    <Checkbox id="propagate" checked={propagate} onCheckedChange={(v) => setPropagate(!!v)} />
                    <label htmlFor="propagate" className="text-xs font-medium leading-none cursor-pointer">
                      Propagar alterações para todas as parcelas futuras?
                    </label>
                  </div>
                )}

                <DialogFooter className="pt-2">
                  <Button onClick={handleSave} disabled={submitting} className="w-full">
                    {submitting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                    {editId ? "Salvar Alterações" : "Criar Lançamento"}
                  </Button>
                </DialogFooter>
              </div>
            </Tabs>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <SummaryCard label="Receitas" value={summary.income} type="income" />
        <SummaryCard label="Despesas" value={summary.expense} type="expense" />
        <SummaryCard label="Saldo do Mês" value={summary.balance} type="balance" />
      </div>

      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar na competência..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 h-11 rounded-xl bg-surface-1" />
        </div>
        <Select value={filterType} onValueChange={setFilterType}>
          <SelectTrigger className="w-[140px] h-11 rounded-xl"><SelectValue placeholder="Tipo" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="expense">Despesas</SelectItem>
            <SelectItem value="income">Receitas</SelectItem>
            <SelectItem value="transfer">Transferências</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-8">
        {txLoading ? (
          <div className="text-center py-20"><Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" /></div>
        ) : groupedTx.length === 0 ? (
          <div className="text-center py-24 border border-dashed rounded-3xl border-border bg-surface-1/30">
            <div className="h-12 w-12 rounded-full bg-surface-2 flex items-center justify-center mx-auto mb-4">
              <CalendarIcon className="h-6 w-6 text-muted-foreground/50" />
            </div>
            <h3 className="font-display font-semibold text-lg">Sem lançamentos em {format(viewDate, "MMMM", { locale: ptBR })}</h3>
            <p className="text-sm text-muted-foreground mt-1">Navegue pelos meses ou crie um novo registro.</p>
          </div>
        ) : (
          groupedTx.map(([date, dayTxs]) => (
            <div key={date} className="space-y-3">
              <h3 className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.2em] px-2 flex items-center gap-3">
                <span className="shrink-0">{formatDateBR(date)}</span>
                <div className="h-px bg-border w-full" />
              </h3>
              <div className="rounded-2xl border border-border bg-surface-1 overflow-hidden divide-y divide-border shadow-card">
                {dayTxs.map((t: any) => (
                  <TxRow key={t.id} t={t} accounts={accounts} onDelete={() => removeTx(t.id)} onEdit={() => editTx(t)} />
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function SummaryCard({ label, value, type }: { label: string; value: number; type: "income" | "expense" | "balance" }) {
  return (
    <div className="rounded-2xl border border-border bg-surface-1 p-5 shadow-card">
      <div className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold mb-1">{label}</div>
      <div className={cn(
        "font-mono font-bold text-2xl tabular",
        type === "income" ? "text-income" : type === "expense" ? "text-expense" : (value >= 0 ? "text-income" : "text-expense")
      )}>
        {formatBRL(value)}
      </div>
    </div>
  );
}

function TxRow({ t, accounts, onDelete, onEdit }: { t: any; accounts: any[]; onDelete: () => void; onEdit: () => void }) {
  const isTransfer = t.type === "transfer";
  const toAccount = isTransfer ? accounts.find((a: any) => a.id === t.to_account_id) : null;
  const isLinked = !!t.installment_plan_id;

  return (
    <div className="p-4 flex items-center gap-3 hover:bg-surface-2/50 transition-colors group">
      <div className="flex items-center gap-4 flex-1 min-w-0">
        <div className="h-10 w-10 rounded-xl bg-surface-2 flex items-center justify-center shrink-0 text-xl shadow-sm">
          {isTransfer ? "🔄" : (t.categories?.icon || "📦")}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-display font-semibold truncate text-sm">{t.description}</span>
            {isLinked && <LinkIcon className="h-3 w-3 text-primary shrink-0" title="Parte de um parcelamento" />}
            {t.audit_level && <AuditIndicator level={t.audit_level} reason={t.audit_reason} />}
            {t.invoice_id && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-bold border border-primary/20 shrink-0">FATURA</span>}
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5 flex gap-2 items-center flex-wrap">
            {isTransfer ? (
              <>
                <span className="font-medium text-primary">{t.accounts?.name}</span>
                <ArrowRightLeft className="h-3 w-3" />
                <span className="font-medium text-primary">{toAccount?.name || "Conta destino"}</span>
              </>
            ) : (
              <>
                <span>{t.accounts?.name}</span>
                <span>·</span>
                <span className="capitalize">{t.payment_method}</span>
              </>
            )}
            {t.installment_number && (
              <>
                <span>·</span>
                <span className="text-[10px] px-1.5 rounded bg-muted font-mono">Parc. {t.installment_number}</span>
              </>
            )}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <div className={cn(
          "font-mono tabular font-bold text-sm mr-2",
          t.type === "income" ? "text-income" : t.type === "expense" ? "text-expense" : "text-muted-foreground"
        )}>
          {t.type === "income" ? "+" : t.type === "expense" ? "-" : ""}{formatBRL(Number(t.amount))}
        </div>
        <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
          <Button variant="ghost" size="icon" onClick={onEdit} className="h-8 w-8 shrink-0"><Pencil className="h-3.5 w-3.5 text-muted-foreground" /></Button>
          <Button variant="ghost" size="icon" onClick={onDelete} className="h-8 w-8 shrink-0"><Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" /></Button>
        </div>
      </div>
    </div>
  );
}

function AuditIndicator({ level, reason }: { level: string; reason?: string }) {
  const meta = {
    green: { icon: ShieldCheck, color: "text-audit-green", bg: "bg-audit-green/10", label: "Saudável" },
    yellow: { icon: AlertTriangle, color: "text-audit-yellow", bg: "bg-audit-yellow/10", label: "Atenção" },
    red: { icon: AlertCircle, color: "text-audit-red", bg: "bg-audit-red/10", label: "Crítico" },
  }[level as "green" | "yellow" | "red"] || { icon: Info, color: "text-muted-foreground", bg: "bg-muted/10", label: "Info" };

  const Icon = meta.icon;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className={cn("h-5 w-5 rounded-full flex items-center justify-center transition-transform hover:scale-110 shadow-sm", meta.bg, meta.color)}>
          <Icon className="h-3 w-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-4 rounded-2xl shadow-elegant border-border">
        <div className="flex items-center gap-2 mb-2">
          <Icon className={cn("h-4 w-4", meta.color)} />
          <span className="text-[10px] font-bold uppercase tracking-widest">Auditoria IA: {meta.label}</span>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          {reason || "Classificação automática via IControl IA."}
        </p>
      </PopoverContent>
    </Popover>
  );
}