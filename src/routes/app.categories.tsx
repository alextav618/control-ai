import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Trash2, Pencil, Check, X } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/app/categories")({
  component: CategoriesPage,
});

function CategoriesPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", kind: "expense", icon: "📦", color: "#94a3b8" });
  const [editing, setEditing] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{ name: string; icon: string }>({ name: "", icon: "" });

  const { data: cats = [] } = useQuery({
    queryKey: ["categories", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("categories").select("*").order("kind").order("name");
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const create = async () => {
    if (!user || !form.name) return;
    const { error } = await supabase.from("categories").insert({
      user_id: user.id, name: form.name, kind: form.kind as any, icon: form.icon, color: form.color,
    });
    if (error) toast.error(error.message);
    else {
      toast.success("Categoria criada");
      setOpen(false);
      setForm({ name: "", kind: "expense", icon: "📦", color: "#94a3b8" });
      qc.invalidateQueries({ queryKey: ["categories"] });
    }
  };

  const startEdit = (c: any) => { setEditing(c.id); setEditForm({ name: c.name, icon: c.icon ?? "" }); };
  const saveEdit = async (id: string) => {
    const { error } = await supabase.from("categories").update({ name: editForm.name, icon: editForm.icon }).eq("id", id);
    if (error) toast.error(error.message);
    else { setEditing(null); qc.invalidateQueries({ queryKey: ["categories"] }); }
  };
  const remove = async (id: string) => {
    if (!confirm("Excluir esta categoria? Lançamentos antigos ficarão sem categoria.")) return;
    const { error } = await supabase.from("categories").delete().eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success("Excluída"); qc.invalidateQueries({ queryKey: ["categories"] }); }
  };

  const expense = cats.filter((c: any) => c.kind === "expense");
  const income = cats.filter((c: any) => c.kind === "income");

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto animate-in fade-in duration-300">
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-display text-2xl md:text-3xl font-bold">Categorias</h1>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-2" />Nova</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Nova categoria</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div><Label>Nome</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1.5" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Tipo</Label>
                  <Select value={form.kind} onValueChange={(v) => setForm({ ...form, kind: v })}>
                    <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="expense">Despesa</SelectItem>
                      <SelectItem value="income">Receita</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>Ícone (emoji)</Label><Input value={form.icon} onChange={(e) => setForm({ ...form, icon: e.target.value })} className="mt-1.5" /></div>
              </div>
              <Button onClick={create} className="w-full">Criar</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Section title="Despesas" cats={expense} editing={editing} editForm={editForm} setEditForm={setEditForm} startEdit={startEdit} saveEdit={saveEdit} cancelEdit={() => setEditing(null)} remove={remove} />
      <div className="h-6" />
      <Section title="Receitas" cats={income} editing={editing} editForm={editForm} setEditForm={setEditForm} startEdit={startEdit} saveEdit={saveEdit} cancelEdit={() => setEditing(null)} remove={remove} />
    </div>
  );
}

function Section({ title, cats, editing, editForm, setEditForm, startEdit, saveEdit, cancelEdit, remove }: any) {
  return (
    <div>
      <h2 className="font-display font-semibold mb-3 text-muted-foreground text-sm uppercase tracking-wide">{title}</h2>
      <div className="rounded-2xl border border-border bg-surface-1 overflow-hidden">
        {cats.length === 0 && <div className="p-6 text-center text-muted-foreground text-sm">Nenhuma.</div>}
        <div className="divide-y divide-border">
          {cats.map((c: any) => (
            <div key={c.id} className="p-3 flex items-center gap-3">
              {editing === c.id ? (
                <>
                  <Input value={editForm.icon} onChange={(e) => setEditForm({ ...editForm, icon: e.target.value })} className="w-16" />
                  <Input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} className="flex-1" />
                  <Button size="icon" variant="ghost" onClick={() => saveEdit(c.id)}><Check className="h-4 w-4 text-audit-green" /></Button>
                  <Button size="icon" variant="ghost" onClick={cancelEdit}><X className="h-4 w-4" /></Button>
                </>
              ) : (
                <>
                  <span className="text-xl w-8 text-center">{c.icon}</span>
                  <span className="flex-1 font-medium">{c.name}</span>
                  <Button size="icon" variant="ghost" onClick={() => startEdit(c)}><Pencil className="h-4 w-4 text-muted-foreground" /></Button>
                  <Button size="icon" variant="ghost" onClick={() => remove(c.id)}><Trash2 className="h-4 w-4 text-muted-foreground" /></Button>
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
