import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { formatBRL, formatDateBR, localDateString, monthNames } from "@/lib/format";
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
  validateSearch: (search: Record<string, unknown>): { month?: number; year?: number } => {
    const now = new Date(2026, 4, 10);
    return {
      month: typeof search.month === "number" ? search.month : now.getMonth() + 1,
      year: typeof search.year === "number" ? search.year : now.getFullYear(),
    };
  },
  component: TxPage,
});

function TxPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { month, year } = Route.useSearch();
  
  const viewDate = useMemo(() => new Date(year!, month! - 1, 10), [month, year]);
  
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
    occurred_on: localDateString(viewDate),
    account_id: "",
    to_account_id: "",
    category_id: "",
    payment_method: "debito",
    invoice_id: "",
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
      payment_method: "debito",
      invoice_id: "",
    });
    setEditId(null);
    setPropagate(false);
  };

  useEffect(() => { if (!open) resetForm(); }, [open, viewDate]);

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

  const handleMonthChange = (offset: number) => {
    const next = addMonths(viewDate, offset);
    navigate({
      to: "/app/transactions",
      search: { month: next.getMonth() + 1, year: next.getFullYear() }
    });
  };

  const handleSave = async () => {
    if (!user || !form.description || !form.amount || !form.account_id) { toast.error("Preencha o básico"); return; }
    setSubmitting(true);
    try {
      const payload: any = {
        user_id: user.id, type: form.type, description: form.description, amount: Number(form.amount),
        occurred_on: form.occurred_on, account_id: form.account_id, to_account_id: form.type === "transfer" ? form.to_account_id : null,
        category_id: form.category_id || null, status: "paid", source: "manual"
      };
      if (editId) await supabase.from("transactions").update(payload).eq("id", editId);
      else await supabase.from("transactions").insert(payload);
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["accounts"] });
      toast.success("Lançamento salvo");
    } catch (e: any) { toast.error(e.message); } finally { setSubmitting(false); }
  };

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto animate-in fade-in duration-300">
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center bg-surface-1 border border-border rounded-xl p-1 shadow-card">
            <Button variant="ghost" size="icon" onClick={() => handleMonthChange(-1)} className="h-9 w-9"><ChevronLeft className="h-5 w-5" /></Button>
            <div className="px-4 min-w-[140px] text-center">
              <div className="text-xs text-muted-foreground uppercase font-bold tracking-tighter">{year}</div>
              <div className="font-display font-bold text-sm capitalize">{format(viewDate, "MMMM", { locale: ptBR })}</div>
            </div>
            <Button variant="ghost" size="icon" onClick={() => handleMonthChange(1)} className="h-9 w-9"><ChevronLeft className="h-5 w-5 rotate-180" /></Button>
          </div>
        </div>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button className="h-11 px-6 shadow-glow"><Plus className="h-4 w-4 mr-2" /> Novo Lançamento</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>{editId ? "Editar" : "Novo"} lançamento</DialogTitle></DialogHeader>
            <div className="space-y-4 pt-2">
              <div><Label>Tipo</Label><Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}><SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="expense">Despesa</SelectItem><SelectItem value="income">Receita</SelectItem><SelectItem value="transfer">Transferência</SelectItem></SelectContent></Select></div>
              <div><Label>Descrição</Label><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="mt-1.5" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Valor</Label><Input type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="mt-1.5" /></div>
                <div><Label>Data</Label><Input type="date" value={form.occurred_on} onChange={(e) => setForm({ ...form, occurred_on: e.target.value })} className="mt-1.5" /></div>
              </div>
              <Button onClick={handleSave} disabled={submitting} className="w-full mt-4">{submitting ? "Salvando..." : "Salvar"}</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="rounded-2xl border border-border bg-surface-1 p-5 shadow-card"><div className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold mb-1">Receitas</div><div className="font-mono font-bold text-2xl text-income">{formatBRL(summary.income)}</div></div>
        <div className="rounded-2xl border border-border bg-surface-1 p-5 shadow-card"><div className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold mb-1">Despesas</div><div className="font-mono font-bold text-2xl text-expense">{formatBRL(summary.expense)}</div></div>
        <div className="rounded-2xl border border-border bg-surface-1 p-5 shadow-card"><div className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold mb-1">Resultado</div><div className={cn("font-mono font-bold text-2xl", summary.balance >= 0 ? "text-income" : "text-expense")}>{formatBRL(summary.balance)}</div></div>
      </div>

      <div className="flex items-center gap-3 mb-6">
        <div className="relative flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" /><Input placeholder="Buscar..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 h-11 bg-surface-1" /></div>
        <Select value={filterType} onValueChange={setFilterType}><SelectTrigger className="w-[140px] h-11"><SelectValue placeholder="Tipo" /></SelectTrigger><SelectContent><SelectItem value="all">Todos</SelectItem><SelectItem value="expense">Despesas</SelectItem><SelectItem value="income">Receitas</SelectItem><SelectItem value="transfer">Transferências</SelectItem></SelectContent></Select>
      </div>

      <div className="space-y-8">
        {groupedTx.map(([date, dayTxs]) => (
          <div key={date} className="space-y-3">
            <h3 className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.2em] px-2 flex items-center gap-3"><span className="shrink-0">{formatDateBR(date)}</span><div className="h-px bg-border w-full" /></h3>
            <div className="rounded-2xl border border-border bg-surface-1 overflow-hidden divide-y divide-border shadow-card">
              {dayTxs.map((t: any) => (
                <div key={t.id} className="p-4 flex items-center justify-between hover:bg-surface-2/50 group">
                  <div className="flex items-center gap-4">
                    <div className="h-10 w-10 rounded-xl bg-surface-2 flex items-center justify-center text-xl">{t.categories?.icon || (t.type === "transfer" ? "🔄" : "📦")}</div>
                    <div>
                      <div className="font-display font-semibold text-sm">{t.description}</div>
                      <div className="text-[10px] text-muted-foreground">{t.accounts?.name}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className={cn("font-mono font-bold text-sm", t.type === "income" ? "text-income" : t.type === "expense" ? "text-expense" : "text-muted-foreground")}>{t.type === "income" ? "+" : t.type === "expense" ? "-" : ""}{formatBRL(Number(t.amount))}</div>
                    <Button variant="ghost" size="icon" onClick={() => editId === t.id ? setEditId(null) : setEditId(t.id)} className="opacity-0 group-hover:opacity-100"><Pencil className="h-4 w-4" /></Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}