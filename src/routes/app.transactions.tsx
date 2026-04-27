import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { formatBRL, formatDateBR } from "@/lib/format";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/transactions")({
  component: TxPage,
});

function TxPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { data: tx = [] } = useQuery({
    queryKey: ["transactions", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transactions")
        .select("*, accounts(name, type), categories(name, icon)")
        .order("occurred_on", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const remove = async (id: string) => {
    const { error } = await supabase.from("transactions").delete().eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success("Removido"); qc.invalidateQueries({ queryKey: ["transactions"] }); qc.invalidateQueries({ queryKey: ["dashboard"] }); }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="font-display text-3xl font-bold mb-6">Lançamentos</h1>
      <div className="rounded-2xl border border-border bg-surface-1 overflow-hidden">
        {tx.length === 0 && <div className="p-8 text-center text-muted-foreground">Nenhum lançamento ainda.</div>}
        <div className="divide-y divide-border">
          {tx.map((t: any) => {
            const dot =
              t.audit_level === "green" ? "bg-audit-green" :
              t.audit_level === "yellow" ? "bg-audit-yellow" :
              t.audit_level === "red" ? "bg-audit-red" : "bg-muted";
            return (
              <div key={t.id} className="p-4 flex items-center gap-4 hover:bg-surface-2 transition-colors">
                <span className={cn("h-2.5 w-2.5 rounded-full shrink-0", dot)} title={t.audit_reason ?? ""} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium truncate">{t.description}</span>
                    {t.installment_number && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-surface-3 text-muted-foreground">parcela {t.installment_number}</span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5 flex gap-2 flex-wrap">
                    <span>{formatDateBR(t.occurred_on)}</span>
                    {t.accounts && <span>· {t.accounts.name}</span>}
                    {t.categories && <span>· {t.categories.icon} {t.categories.name}</span>}
                  </div>
                  {t.audit_reason && <div className="text-xs text-muted-foreground/80 mt-1 italic">{t.audit_reason}</div>}
                </div>
                <div className={cn("font-mono tabular font-semibold whitespace-nowrap", t.type === "income" ? "text-income" : "text-expense")}>
                  {t.type === "income" ? "+" : "-"}{formatBRL(Number(t.amount))}
                </div>
                <Button variant="ghost" size="icon" onClick={() => remove(t.id)}>
                  <Trash2 className="h-4 w-4 text-muted-foreground" />
                </Button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
