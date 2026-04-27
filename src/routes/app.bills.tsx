import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { formatBRL } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/app/bills")({
  component: BillsPage,
});

function BillsPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", expected_amount: "", due_day: "" });

  const { data: bills = [] } = useQuery({
    queryKey: ["bills", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("fixed_bills").select("*").eq("active", true).order("due_day");
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const submit = async () => {
    if (!user || !form.name || !form.expected_amount || !form.due_day) return;
    const { error } = await supabase.from("fixed_bills").insert({
      user_id: user.id,
      name: form.name,
      expected_amount: Number(form.expected_amount),
      due_day: Number(form.due_day),
    });
    if (error) toast.error(error.message);
    else {
      toast.success("Conta fixa criada");
      setOpen(false);
      setForm({ name: "", expected_amount: "", due_day: "" });
      qc.invalidateQueries({ queryKey: ["bills"] });
    }
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("fixed_bills").update({ active: false }).eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success("Removida"); qc.invalidateQueries({ queryKey: ["bills"] }); }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-display text-3xl font-bold">Contas fixas</h1>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-2" /> Nova</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Nova conta fixa</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div><Label>Nome</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ex: Internet" className="mt-1.5" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Valor previsto</Label><Input type="number" step="0.01" value={form.expected_amount} onChange={(e) => setForm({ ...form, expected_amount: e.target.value })} className="mt-1.5" /></div>
                <div><Label>Vence dia</Label><Input type="number" min={1} max={31} value={form.due_day} onChange={(e) => setForm({ ...form, due_day: e.target.value })} className="mt-1.5" /></div>
              </div>
              <Button onClick={submit} className="w-full">Criar</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="rounded-2xl border border-border bg-surface-1 overflow-hidden">
        {bills.length === 0 && <div className="p-8 text-center text-muted-foreground text-sm">Sem contas fixas. A IA também pode cadastrar pra você no chat.</div>}
        <div className="divide-y divide-border">
          {bills.map((b: any) => (
            <div key={b.id} className="p-4 flex items-center justify-between">
              <div>
                <div className="font-medium">{b.name}</div>
                <div className="text-xs text-muted-foreground">Vence dia {b.due_day}</div>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-mono tabular font-semibold">{formatBRL(Number(b.expected_amount))}</span>
                <Button variant="ghost" size="icon" onClick={() => remove(b.id)}><Trash2 className="h-4 w-4 text-muted-foreground" /></Button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
