import { createFileRoute } from "@tanstack/react-router";
import { TrendingUp } from "lucide-react";

export const Route = createFileRoute("/app/investments")({
  component: InvestmentsPage,
});

function InvestmentsPage() {
  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="font-display text-3xl font-bold">Investimentos</h1>
      <div className="mt-8 rounded-2xl border border-dashed border-border bg-surface-1 p-12 text-center">
        <TrendingUp className="h-10 w-10 text-primary mx-auto mb-4" />
        <h2 className="font-display text-xl font-semibold">Em breve</h2>
        <p className="text-sm text-muted-foreground mt-2 max-w-md mx-auto">
          Vamos cadastrar ativos com aportes/resgates ao longo do tempo, rentabilidade estimada
          (CDI, IPCA, prefixado) e evolução do patrimônio. Esse módulo entra na próxima fase.
        </p>
      </div>
    </div>
  );
}
