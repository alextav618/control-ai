import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { formatBRL, formatDateBR } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Trash2, Calendar, CreditCard, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/installments")({
  component: InstallmentsPage,
});

function InstallmentsPage() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const { data: plans = [], isLoading } = useQuery({
    queryKey: ["installment-plans", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("installment_plans")
        .select("*, accounts(name), transactions(id, installment_number, occurred_on, status)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const removePlan = async (plan: any) => {
    if (!confirm(`Excluir o parcelamento "${plan.description}"? Isso removerá todas as transações vinculadas a ele.`)) return;
    
    const { error } = await supabase.from("installment_plans").delete().eq("id", plan.id);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Parcelamento removido");
      qc.invalidateQueries({ queryKey: ["installment-plans"] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["invoices"] });
    }
  };

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto animate-in fade-in duration-300">
      <div className="mb-6">
        <h1 className="font-display text-2xl md:text-3xl font-bold">Parcelamentos</h1>
        <p className="text-sm text-muted-foreground mt-1">Acompanhe suas compras parceladas e o progresso de quitação.</p>
      </div>

      {isLoading ? (
        <div className="text-center py-10 text-muted-foreground">Carregando parcelamentos...</div>
      ) : plans.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-12 text-center">
          <Calendar className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4" />
          <h3 className="font-display font-semibold text-lg">Nenhum parcelamento ativo</h3>
          <p className="text-sm text-muted-foreground mt-1 max-w-xs mx-auto">
            Compras parceladas criadas pelo chat ou manualmente aparecerão aqui.
          </p>
        </div>
      ) : (
        <div className="grid gap-4">
          {plans.map((plan: any) => {
            const totalInstallments = plan.total_installments;
            const paidTransactions = plan.transactions?.filter((t: any) => {
              const today = new Date().toISOString().split('T')[0];
              return t.occurred_on <= today;
            }) || [];
            const currentInstallment = paidTransactions.length;
            const pct = (currentInstallment / totalInstallments) * 100;
            const remainingAmount = plan.total_amount - (currentInstallment * plan.installment_amount);

            return (
              <div key={plan.id} className="rounded-2xl border border-border bg-surface-1 p-5 shadow-card hover:shadow-elegant transition-all group">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="h-10 w-10 rounded-lg bg-surface-2 flex items-center justify-center shrink-0">
                      <CreditCard className="h-5 w-5 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-display font-bold truncate">{plan.description}</h3>
                      <div className="text-xs text-muted-foreground flex items-center gap-2 mt-0.5">
                        <span>{plan.accounts?.name || "Sem conta"}</span>
                        <span>·</span>
                        <span>Início: {formatDateBR(plan.start_date)}</span>
                      </div>
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => removePlan(plan)} className="opacity-0 group-hover:opacity-100 transition-opacity">
                    <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                  </Button>
                </div>

                <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Valor Total</div>
                    <div className="font-mono font-bold text-lg tabular">{formatBRL(plan.total_amount)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Parcela</div>
                    <div className="font-mono font-bold text-lg tabular">{formatBRL(plan.installment_amount)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Progresso</div>
                    <div className="font-mono font-bold text-lg tabular">{currentInstallment} / {totalInstallments}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Restante</div>
                    <div className="font-mono font-bold text-lg tabular text-primary">{formatBRL(remainingAmount)}</div>
                  </div>
                </div>

                <div className="mt-4">
                  <div className="h-1.5 rounded-full bg-surface-2 overflow-hidden">
                    <div 
                      className="h-full bg-gradient-primary transition-all duration-1000" 
                      style={{ width: `${pct}%` }} 
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}