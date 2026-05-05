import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { formatBRL, formatDateBR, localDateString } from "@/lib/format";
import { Trash2, Plus, Pencil, Search, Filter, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/transactions")({
  component: TxPage,
});

function TxPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState("all");
  const [filterBank, setFilterBank] = useState("all");

  const [form, setForm] = useState({
    description: "",
    amount: "",
    date: localDateString(),
    bank_id: "",
    category: "",
    status: "Confirmado",
  });

  const resetForm = () => {
    setForm({ description: "", amount: "", date: localDateString(), bank_id: "", category: "", status: "Confirmado" });
    setEditId(null);
  };

  const openEdit = (t: any) => {
    setEditId(t.id);
    setForm({
      description: t.description,
      amount: String(t.amount),
      date: t.date,
      bank_id: t.bank_id ?? "",
      category: t.category ?? "",
      status: t.status ?? "Confirmado",
    });
    setOpen(true);
  };

  useEffect(() => { if (!open) resetForm(); }, [open]);

  const { data: tx = [], isLoading: txLoading } = useQuery({
    queryKey: ["transactions", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transactions")
        .select("*")
        .order("date", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const { data: banks = [] } = useQuery({
    queryKey: ["banks", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("banks").select("*");
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user,
  });

  const filteredTx = useMemo(() => {
    return tx.filter((t: any) => {
      const matchesSearch = t.description?.toLowerCase().includes(search.toLowerCase());
      const matchesCategory = filterCategory === "all" || t.category === filterCategory;
      const matchesBank = filterBank === "all" || t.bank_id === filterBank;
      return matchesSearch && matchesCategory && matchesBank;
    });
  }, [tx, search, filterCategory, filterBank]);

  const submit = async () => {
    if (submitting || !user) return;
    setSubmitting(true);
    try {
      const payload = {
        user_id: user.id,
        description: form.description,
        amount: Number(form.amount),
        date: form.date,
        bank_id: form.bank_id || null,
        category: form.category || null,
        status: form.status,
      };

      const { error } = editId 
        ? await supabase.from("transactions").update(payload).eq("id", editId)
        : await supabase.from("transactions").insert(payload);

      if (error) throw error;

      toast.success(editId ? "Atualizado" : "Lançado com sucesso!");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    } catch (e: any) {
      console.error("Erro ao salvar:", e);
      toast.error(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Excluir este lançamento?")) return;
    const { error } = await supabase.from("transactions").delete().eq("id", id);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Removido");
      qc.invalidateQueries({ queryKey: ["transactions"] });
    }
  };

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto animate-in fade-in duration-300">
      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <h1 className="font-display text-2xl md:text-3xl font-bold">Lançamentos</h1>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-2" />Novo</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>{editId ? "Editar" : "Novo Lançamento"}</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div><Label>Descrição</Label><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="mt-1.5" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Valor</Label><Input type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="mt-1.5" /></div>
                <div><Label>Data</Label><Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="mt-1.5" /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Banco/Conta</Label>
                  <Select value={form.bank_id} onValueChange={(v) => setForm({ ...form, bank_id: v })}>
                    <SelectTrigger className="mt-1.5"><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>
                      {banks.map((b: any) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Categoria</Label>
                  <Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="mt-1.5" placeholder="Ex: Alimentação" />
                </div>
              </div>
              <Button onClick={submit} disabled={submitting} className="w-full">{submitting ? "Salvando..." : "Salvar"}</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
        <Input placeholder="Buscar..." value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select value={filterBank} onValueChange={setFilterBank}>
          <SelectTrigger><SelectValue placeholder="Filtrar por Banco" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os bancos</SelectItem>
            {banks.map((b: any) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-2xl border border-border bg-surface-1 overflow-hidden">
        {txLoading ? <div className="p-8 text-center">Carregando...</div> : (
          <div className="divide-y divide-border">
            {filteredTx.map((t: any) => (
              <div key={t.id} className="p-4 flex items-center justify-between hover:bg-surface-2 transition-colors group">
                <div>
                  <div className="font-medium">{t.description}</div>
                  <div className="text-xs text-muted-foreground">{formatDateBR(t.date)} · {t.category || "Sem categoria"}</div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="font-mono font-semibold">{formatBRL(Number(t.amount))}</div>
                  <div className="flex opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(t)}><Pencil className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" onClick={() => remove(t.id)}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}