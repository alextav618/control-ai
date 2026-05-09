import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { formatBRL, monthNames } from "@/lib/format";
import { Sparkles, AlertTriangle, ThumbsUp, Lightbulb, TrendingDown, TrendingUp, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/app/insights")({
  component: InsightsPage,
});

type Insight = {
  level: "praise" | "tip" | "warning" | "alert";
  title: string;
  body: string;
};

function InsightsPage() {
  const { user } = useAuth();
  const [aiText, setAiText] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["insights-data", user?.id],
    queryFn: async () => {
      const now = new Date();
      const m = now.getMonth() + 1;
      const y = now.getFullYear();
      const monthStart = `${y}-${String(m).padStart(2, "0")}-01`;
      const lastMonthDate = new Date(y, now.getMonth() - 1, 1);
      const lmStart = `${lastMonthDate.getFullYear()}-${String(lastMonthDate.getMonth() + 1).padStart(2, "0")}-01`;

      const [txR, lmR, billsR, invR, profR, accR, itemsR] = await Promise.all([
        supabase.from("transactions").select("*, categories(name, icon)").gte("occurred_on", monthStart),
        supabase.from("transactions").select("amount, type, category_id, occurred_on, categories(name)").gte("occurred_on", lmStart).lt("occurred_on", monthStart),
        supabase.from("fixed_bills").select("*").eq("active", true),
        supabase.from("invoices").select("*, accounts!inner(name, archived)").eq("accounts.archived", false).in("status", ["open", "closed"]),
        supabase.from("profiles").select("*").maybeSingle(),
        supabase.from("accounts").select("*").eq("archived", false),
        supabase.from("invoice_items").select("*"),
      ]);
      return {
        tx: txR.data ?? [],
        lastTx: lmR.data ?? [],
        bills: billsR.data ?? [],
        invoices: invR.data ?? [],
        profile: profR.data,
        accounts: accR.data ?? [],
        invoiceItems: itemsR.data ?? [],
      };
    },
    enabled: !!user,
  });

  const insights = useMemo<Insight[]>(() => {
    if (!data) return [];
    const out: Insight[] = [];
    // Transferências são ignoradas nos insights de receita e despesa
    const tx = (data.tx as any[]).filter(t => t.type !== 'transfer');
    const lastTx = (data.lastTx as any[]).filter(t => t.type !== 'transfer');

    const expense = tx.filter(t => t.type === "expense").reduce((s, t) => s + Number(t.amount), 0);
    const income = tx.filter(t => t.type === "income").reduce((s, t) => s + Number(t.amount), 0);
    const lastExpense = lastTx.filter(t => t.type === "expense").reduce((s, t) => s + Number(t.amount), 0);
    const balance = income - expense;

    // Saldo positivo
    if (income > 0 && balance > 0 && balance / income > 0.2) {
      out.push({
        level: "praise",
        title: "Sobrou mais de 20% da receita 🎉",
        body: `Você está economizando ${formatBRL(balance)} este mês — ${((balance / income) * 100).toFixed(0)}% da receita. Considere mover esse valor para investimentos.`,
      });
    }

    // Despesa subiu vs mês anterior
    if (lastExpense > 0 && expense > lastExpense * 1.2) {
      out.push({
        level: "warning",
        title: "Gasto cresceu mais de 20% vs. mês passado",
        body: `Mês passado: ${formatBRL(lastExpense)}. Este mês: ${formatBRL(expense)}. Vale revisar onde foi a diferença.`,
      });
    } else if (lastExpense > 0 && expense < lastExpense * 0.85) {
      out.push({
        level: "praise",
        title: "Você gastou menos que no mês anterior",
        body: `${formatBRL(lastExpense - expense)} a menos comparado com o mês passado. Ótimo controle.`,
      });
    }

    // Categorias dominantes
    const byCat: Record<string, { name: string; total: number }> = {};
    tx.filter(t => t.type === "expense").forEach((t: any) => {
      const k = t.category_id ?? "none";
      const name = t.categories?.name ?? "Sem categoria";
      byCat[k] = byCat[k] ?? { name, total: 0 };
      byCat[k].total += Number(t.amount);
    });
    const cats = Object.values(byCat).sort((a, b) => b.total - a.total).slice(0, 6);
    if (cats[0] && expense > 0 && cats[0].total / expense > 0.4) {
      out.push({
        level: "warning",
        title: `${cats[0].name} concentra mais de 40% dos gastos`,
        body: `${formatBRL(cats[0].total)} foram nessa categoria. Ter uma categoria muito dominante é sinal de concentração de risco no orçamento.`,
      });
    }

    // Faturas em aberto somadas
    const openInvTotal = (data.invoices as any[]).filter(i => i.status !== "paid").reduce((s, i) => s + Number(i.total_amount), 0);
    const cashTotal = (data.accounts as any[]).filter(a => a.type !== "credit_card").reduce((s, a) => s + Number(a.current_balance), 0);
    if (openInvTotal > 0 && openInvTotal > cashTotal) {
      out.push({
        level: "alert",
        title: "Faturas em aberto maiores que o saldo em conta",
        body: `Você tem ${formatBRL(openInvTotal)} em faturas e ${formatBRL(cashTotal)} disponível. Atenção para não rolar fatura — os juros do rotativo podem passar de 15% ao mês.`,
      });
    }

    // Itens de fatura sem categorização
    const itemsWithoutCategory = (data.invoiceItems as any[]).filter(i => !i.category_id).length;
    if (itemsWithoutCategory >= 3) {
      out.push({
        level: "tip",
        title: `${itemsWithoutCategory} itens de fatura sem categoria`,
        body: "Categorizar itens de fatura melhora a precisão dos relatórios e da auditoria da IA. Edite os itens na aba Faturas.",
      });
    }

    // Sem categoria em transações
    const noCat = tx.filter((t: any) => t.type === "expense" && !t.category_id).length;
    if (noCat >= 3) {
      out.push({
        level: "tip",
        title: `${noCat} lançamentos sem categoria`,
        body: "Categorizar tudo melhora a precisão dos relatórios e da auditoria da IA. Edite as transações na aba Lançamentos.",
      });
    }

    // Auditoria vermelha
    const reds = tx.filter((t: any) => t.audit_level === "red").length;
    if (reds > 0) {
      out.push({
        level: "alert",
        title: `${reds} ${reds === 1 ? "gasto sinalizado" : "gastos sinalizados"} como impulso`,
        body: "A IA classificou esses lançamentos como vermelhos por estarem fora do padrão. Revise se foram realmente necessários.",
      });
    }

    // Orçamento
    if (data.profile?.monthly_budget && expense > Number(data.profile.monthly_budget)) {
      out.push({
        level: "alert",
        title: "Orçamento mensal estourado",
        body: `Você definiu ${formatBRL(Number(data.profile.monthly_budget))} e já gastou ${formatBRL(expense)}.`,
      });
    }

    // Total de itens em faturas
    const totalItemsValue = (data.invoiceItems as any[]).reduce((s, i) => s + Number(i.amount), 0);
    if (totalItemsValue > 0 && totalItemsValue > expense * 0.3) {
      out.push({
        level: "warning",
        title: "Itens de fatura representam grande parte dos gastos",
        body: `Itens de fatura somam ${formatBRL(totalItemsValue)} (${((totalItemsValue / expense) * 100).toFixed(0)}% dos gastos). Considere revisar compras parceladas.`,
      });
    }

    // Tudo zen
    if (out.length === 0) {
      out.push({
        level: "praise",
        title: "Suas finanças estão sob controle",
        body: "Nenhum ponto crítico detectado este mês. Continue auditando os lançamentos para manter a clareza.",
      });
      out.push({
        level: "tip",
        title: "Hora de pensar em metas",
        body: "Que tal definir um objetivo de economia ou um aporte mensal em investimentos? A consistência vale mais que o valor.",
      });
    }

    return out;
  }, [data]);

  const askAi = async () => {
    if (!data) return;
    setAiLoading(true);
    setAiText(null);
    try {
      const tx = (data.tx as any[]).filter(t => t.type !== 'transfer');
      const expense = tx.filter(t => t.type === "expense").reduce((s, t) => s + Number(t.amount), 0);
      const income = tx.filter(t => t.type === "income").reduce((s, t) => s + Number(t.amount), 0);
      const itemsTotal = (data.invoiceItems as any[]).reduce((s, i) => s + Number(i.amount), 0);
      const summary = `Receita: ${formatBRL(income)}. Despesa: ${formatBRL(expense)}. Saldo: ${formatBRL(income - expense)}. Itens de fatura: ${formatBRL(itemsTotal)}. Faturas em aberto somam ${formatBRL((data.invoices as any[]).filter(i => i.status !== "paid").reduce((s, i) => s + Number(i.total_amount), 0))}.`;
      const { data: resp, error } = await supabase.functions.invoke("chat-ai", {
        body: { text: `Faça uma análise financeira pessoal curta (máx 6 linhas) e direta sobre meu mês: ${summary} Não registre nada, apenas avalie e dê 1 dica prática.`, history: [] },
      });
      if (error) throw error;
      setAiText(resp?.message ?? "Sem retorno.");
    } catch (e: any) {
      toast.error("Não foi possível consultar a IA agora.");
    } finally {
      setAiLoading(false);
    }
  };

  if (isLoading) return <div className="p-6 text-muted-foreground">Carregando insights...</div>;

  const now = new Date();
  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto animate-in fade-in duration-300 space-y-6">
      <div>
        <h1 className="font-display text-2xl md:text-3xl font-bold flex items-center gap-2">
          <Sparkles className="h-6 w-6 text-primary" /> Insights
        </h1>
        <p className="text-sm text-muted-foreground mt-1">{monthNames[now.getMonth()]} de {now.getFullYear()} · análise automática</p>
      </div>

      <div className="grid md:grid-cols-2 gap-3 md:gap-4">
        {insights.map((it, i) => <InsightCard key={i} insight={it} />)}
      </div>

      <div className="rounded-2xl border border-border bg-surface-1 p-4 md:p-6 shadow-card">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="font-display font-semibold flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" /> Avaliação da IA</h2>
            <p className="text-xs text-muted-foreground mt-1">Peça uma análise narrativa em linguagem natural sobre o seu mês.</p>
          </div>
          <Button onClick={askAi} disabled={aiLoading} variant="outline">
            {aiLoading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Analisando...</> : "Pedir avaliação"}
          </Button>
        </div>
        {aiText && (
          <div className="mt-4 rounded-xl bg-surface-2 border border-border p-4 text-sm whitespace-pre-wrap leading-relaxed">{aiText}</div>
        )}
      </div>
    </div>
  );
}

function InsightCard({ insight }: { insight: Insight }) {
  const meta = {
    praise:  { Icon: ThumbsUp,        color: "text-audit-green",  bg: "bg-audit-green/10",  border: "border-audit-green/30" },
    tip:     { Icon: Lightbulb,       color: "text-primary",      bg: "bg-primary/10",      border: "border-primary/30" },
    warning: { Icon: AlertTriangle,   color: "text-audit-yellow", bg: "bg-audit-yellow/10", border: "border-audit-yellow/30" },
    alert:   { Icon: TrendingDown,    color: "text-audit-red",    bg: "bg-audit-red/10",    border: "border-audit-red/30" },
  }[insight.level];
  const Icon = meta.Icon;
  return (
    <div className={cn("rounded-2xl border p-4 md:p-5 shadow-card", meta.bg, meta.border)}>
      <div className="flex items-start gap-3">
        <div className={cn("h-9 w-9 rounded-lg flex items-center justify-center shrink-0 bg-background/50", meta.color)}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <h3 className="font-display font-semibold leading-tight">{insight.title}</h3>
          <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">{insight.body}</p>
        </div>
      </div>
    </div>
  );
}