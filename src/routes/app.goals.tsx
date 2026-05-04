import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { formatBRL, formatDateBR } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Target, Trash2, Pencil, CheckCircle2, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/goals")({
  component: GoalsPage,
});

function GoalsPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", target_amount: "", current_amount: "0", deadline: "", icon: "🎯" });

  const { data: goals = [], isLoading } = useQuery({
    queryKey: ["goals", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("goals").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const submit = async () => {
    if (!user || !form.name || !form.target_amount) {
      toast.error("Preencha o nome e o valor alvo");
      return;
    }

    const payload = {
      user_id: user.id,
      name: form.name,
      target_amount: Number(form.target_amount),
      current_amount: Number(form.current_amount),
      deadline: form.deadline || null,
      icon: form.icon,
    };

    if (editId) {
      const { error } = await supabase.from("goals").update(payload).eq("id", editId);
      if (error) { toast.error(error.message); return; }
      toast.success("Meta atualizada");
    } else {
      const { error } = await supabase.from("goals").insert(payload);
      if (error) { toast.error(error.message); return; }
      toast.success("Meta criada");
    }

    setOpen(false);
    setEditId(null);
    setForm({ name: "", target_amount: "", current_amount: "0", deadline: "", icon: "🎯" });
    qc.invalidateQueries({ queryKey: ["goals"] });
  };

  const remove = async (id: string) => {
    if (!confirm("Excluir esta meta?")) return;
    const { error } = await supabase.from("goals").delete().eq("id", id);
    if (error) toast.error(error.message);
    else {
      toast.success("Meta excluída");
      qc.invalidateQueries({ queryKey: ["goals"] });
    }
  };

  const openEdit = (g: any) => {
    setEditId(g.id);
    setForm({
      name: g.name,
      target_amount: String(g.target_amount),
      current_amount: String(g.current_amount),
      deadline: g.deadline || "",
      icon: g.icon || "🎯",
    });
    setOpen(true);
  };

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto animate-in fade-in duration-300">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-2xl md:text-3xl font-bold">Metas Financeiras</h1>
          <p className="text-sm text-muted-foreground mt-1">Planeje e acompanhe seus objetivos de economia.</p>
        </div>
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setEditId(null); setForm({ name: "", target_amount: "", current_amount: "0", deadline: "", icon: "🎯" }); } }}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4 mr-2" /> Nova Meta</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>{editId ? "Editar Meta" : "Nova Meta Financeira"}</DialogTitle></DialogHeader>
            <div className="space-y-4 pt-4">
              <div className="grid grid-cols-4 gap-3">
                <div className="col-span-1">
                  <Label>Ícone</Label>
                  <Input value={form.icon} onChange={(e) => setForm({ ...form, icon: e.target.value })} className="mt-1.5 text-center text-xl" />
                </div>
                <div className="col-span-3">
                  <Label>Nome da Meta</Label>
                  <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ex: Viagem para o Japão" className="mt-1.5" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Valor Alvo (R$)</Label>
                  <Input type="number" step="0.01" value={form.target_amount} onChange={(e) => setForm({ ...form, target_amount: e.target.value })} className="mt-1.5" />
                </div>
                <div>
                  <Label>Valor Atual (R$)</Label>
                  <Input type="number" step="0.01" value={form.current_amount} onChange={(e) => setForm({ ...form, current_amount: e.target.value })} className="mt-1.5" />
                </div>
              </div>
              <div>
                <Label>Prazo (opcional)</Label>
                <Input type="date" value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} className="mt-1.5" />
              </div>
              <Button onClick={submit} className="w-full">{editId ? "Salvar Alterações" : "Criar Meta"}</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="text-center py-10 text-muted-foreground">Carregando metas...</div>
      ) : goals.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-12 text-center">
          <Target className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4" />
          <h3 className="font-display font-semibold text-lg">Nenhuma meta definida</h3>
          <p className="text-sm text-muted-foreground mt-1 max-w-xs mx-auto">
            Defina objetivos como reserva de emergência, viagens ou compras importantes para acompanhar seu progresso.
          </p>
          <Button variant="outline" className="mt-6" onClick={() => setOpen(true)}>Começar agora</Button>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          {goals.map((g: any) => (
            <GoalCard key={g.id} goal={g} onEdit={() => openEdit(g)} onDelete={() => remove(g.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function GoalCard({ goal, onEdit, onDelete }: { goal: any; onEdit: () => void; onDelete: () => void }) {
  const pct = Math.min(100, (Number(goal.current_amount) / Number(goal.target_amount)) * 100);
  const isCompleted = pct >= 100;

  return (
    <div className="rounded-2xl border border-border bg-surface-1 p-5 shadow-card hover:shadow-elegant transition-all group">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-12 w-12 rounded-xl bg-surface-2 flex items-center justify-center text-2xl shrink-0">
            {goal.icon || "🎯"}
          </div>
          <div className="min-w-0">
            <h3 className="font-display font-bold truncate">{goal.name}</h3>
            <div className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5">
              {goal.deadline ? (
                <>Prazo: {formatDateBR(goal.deadline)}</>
              ) : (
                <>Sem prazo definido</>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
          <Button variant="ghost" size="icon" onClick={onEdit}><Pencil className="h-4 w-4 text-muted-foreground" /></Button>
          <Button variant="ghost" size="icon" onClick={onDelete}><Trash2 className="h-4 w-4 text-muted-foreground" /></Button>
        </div>
      </div>

      <div className="mt-6">
        <div className="flex items-end justify-between mb-2">
          <div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Progresso</div>
            <div className="font-mono font-bold text-lg tabular">
              {formatBRL(Number(goal.current_amount))}
              <span className="text-xs text-muted-foreground font-normal ml-1">/ {formatBRL(Number(goal.target_amount))}</span>
            </div>
          </div>
          <div className={cn(
            "text-sm font-bold font-mono tabular",
            isCompleted ? "text-audit-green" : "text-primary"
          )}>
            {pct.toFixed(0)}%
          </div>
        </div>
        <div className="h-2 rounded-full bg-surface-2 overflow-hidden">
          <div 
            className={cn(
              "h-full rounded-full transition-all duration-1000",
              isCompleted ? "bg-audit-green" : "bg-gradient-primary"
            )} 
            style={{ width: `${pct}%` }} 
          />
        </div>
      </div>

      {isCompleted && (
        <div className="mt-4 flex items-center gap-2 text-xs text-audit-green font-medium bg-audit-green/10 p-2 rounded-lg">
          <CheckCircle2 className="h-3.5 w-3.5" /> Meta alcançada! Parabéns!
        </div>
      )}
    </div>
  );
}