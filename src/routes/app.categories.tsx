import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Trash2, Pencil, Check, X } from "lucide-react";
import { toast } from "sonner";

type CategoryRow = {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
};

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

  const { data: cats = [] } = useQuery<CategoryRow[]>({
    queryKey: ["categories", user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await supabase.from<CategoryRow>("categories").select("*").order("kind").order("name");
      if (error) throw error;
      return data || [];
    },
    enabled: !!user,
  });

  const create = async () => {
    if (!user || !form.name) return;
    const { error } = await supabase
      .from<CategoryRow>("categories")
      .insert({
        user_id: user.id,
        name: form.name,
        kind: form.kind as any,
        icon: form.icon,
        color: form.color,
      });
    if (error) { toast.error(error.message); return; }
    toast.success("Categoria criada");
    setOpen(false);
    qc.invalidateQueries({ queryKey: ["categories"] });
  };

  const saveEdit = async (id: string) => {
    const { error } = await supabase
      .from<CategoryRow>("categories")
      .update({ name: editForm.name, icon: editForm.icon })
      .eq("id", id);
    if (error) { toast.error(error.message); return; }
    setEditing(null);
    qc.invalidateQueries({ queryKey: ["categories"] });
  };

  // ... rest of existing code
}