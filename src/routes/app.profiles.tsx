import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react"; 
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { formatBRL } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Pencil, Save, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/profiles")({
  component: ProfilesPage,
});

function ProfilesPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ display_name: "", monthly_budget: "" });

  const { data: profile } = useQuery({
    queryKey: ["profile", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("*").eq("id", user!.id).maybeSingle();
      if (error) console.error('Erro Supabase (fetch profile):', error);
      return data;
    },
    enabled: !!user,
  });

  useEffect(() => { 
    if (profile) {
      setForm({
        display_name: profile.display_name || "",
        monthly_budget: profile.monthly_budget ? String(profile.monthly_budget) : "",
      });
    }
  }, [profile]);

  const save = async () => {
    if (!user) return;
    const payload: any = { id: user.id };
    if (form.display_name) payload.display_name = form.display_name;
    if (form.monthly_budget) payload.monthly_budget = Number(form.monthly_budget);

    const { error } = await supabase.from("profiles").upsert(payload);
    if (error) { 
      console.error('Erro Supabase (upsert profile):', error);
      toast.error(error.message); 
      return; 
    }
    toast.success("Perfil salvo");
    setOpen(false);
    setEditing(false);
    qc.invalidateQueries({ queryKey: ["profile"] });
  };

  if (!user) return null;

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto animate-in fade-in duration-300">
      <h1 className="font-display text-2xl md:text-3xl font-bold mb-6">Meu Perfil</h1>

      <div className="rounded-2xl border border-border bg-surface-1 p-6 shadow-card">
        {!profile || editing ? (
          <div className="space-y-4">
            <div>
              <Label>Nome de exibição</Label>
              <Input
                value={form.display_name}
                onChange={(e) => setForm({ ...form, display_name: e.target.value })}
                placeholder="Seu nome"
                className="mt-1.5"
              />
            </div>
            <div>
              <Label>Orçamento mensal (R$)</Label>
              <Input
                type="number"
                step="0.01"
                value={form.monthly_budget}
                onChange={(e) => setForm({ ...form, monthly_budget: e.target.value })}
                placeholder="Ex: 3000"
                className="mt-1.5"
              />
            </div>
            <div className="flex gap-2 pt-2">
              <Button onClick={save}><Save className="h-4 w-4 mr-2" />Salvar</Button>
              {editing && <Button variant="ghost" onClick={() => { setEditing(false); if (profile) setForm({ display_name: profile.display_name || "", monthly_budget: profile.monthly_budget ? String(profile.monthly_budget) : "" }); }}><X className="h-4 w-4 mr-2" />Cancelar</Button>}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-display text-xl font-semibold">{profile.display_name || "Sem nome"}</h2>
                <p className="text-sm text-muted-foreground">{user.email}</p>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setEditing(true)}><Pencil className="h-4 w-4" /></Button>
            </div>

            <div className="rounded-xl bg-surface-2 p-4">
              <div className="text-sm text-muted-foreground mb-1">Orçamento mensal</div>
              <div className="font-mono tabular text-2xl font-bold">
                {profile.monthly_budget ? formatBRL(Number(profile.monthly_budget)) : "Não definido"}
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-2" />Nova meta</Button>
              <Button variant="outline" onClick={() => setEditing(true)}><Pencil className="h-4 w-4 mr-2" />Editar</Button>
            </div>
          </div>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Nova meta financeira</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">Em desenvolvimento — metas de economia e investimento estarão disponíveis em breve.</p>
            <Button onClick={() => setOpen(false)} variant="outline" className="w-full">Fechar</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}