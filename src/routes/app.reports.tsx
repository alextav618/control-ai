import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { formatBRL, monthNames } from "@/lib/format";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, PieChart, Pie, Cell, AreaChart, Area } from "recharts";
import { BarChart3, TrendingUp, TrendingDown, PieChart as PieIcon, Calendar, Landmark } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/reports")({
  component: ReportsPage,
});

const COLORS = ["var(--primary)", "var(--accent)", "var(--audit-yellow)", "var(--audit-green)", "var(--destructive)", "var(--primary-glow)"];

function ReportsPage() {
  const { user } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ["reports-data", user?.id],
    queryFn: async () => {
      const now = new Date();
      const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);
      const startDate = sixMonthsAgo.toISOString().split('T')[0];

      const [txR, catsR, accR, assetsR, snapsR, movR, invR] = await Promise.all([
        supabase.from("transactions").select("*").gte("occurred_on", startDate),
        supabase.from("categories").select("*"),
        supabase.from("accounts").select("*").eq("archived", false),
        supabase.from("investment_assets").select("*").eq("archived", false),
        supabase.from("investment_snapshots").select("*").order("snapshot_date", { ascending: false }),
        supabase.from("investment_movements").select("*"),
        supabase.from("invoices").select("*").in("status", ["open", "closed"]),
      ]);

      return {
        transactions: txR.data ?? [],
        categories: catsR.data ?? [],
        accounts: accR.data ?? [],
        assets: assetsR.data ?? [],
        snapshots: snapsR.data ?? [],
        movements: movR.data ?? [],
        invoices: invR.data ?? [],
      };
    },
    enabled: !!user,
  });

  const monthlyData = useMemo(() => {
    if (!data) return [];
    const groups: Record<string, { month: string; income: number; expense: number; netWorth: number }> = {};
    
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      groups[key] = { month: `${monthNames[d.getMonth()]}/${String(d.getFullYear()).slice(2)}`, income: 0, expense: 0, netWorth: 0 };
    }

    data.transactions.forEach((t: any) => {
      if (t.type === "transfer") return;
      const date = new Date(t.occurred_on + "T12:00:00");
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      if (groups[key]) {
        if (t.type === "income") groups[key].income += Number(t.amount);
        else if (t.type === "expense") groups[key].expense += Number(t.amount);
      }
    });

    // Cálculo simplificado de evolução de patrimônio (apenas para o mês atual como referência)
    const cash = data.accounts.filter(a => a.type !== 'credit_card').reduce((s, a) => s + Number(a.current_balance), 0);
    const debt = data.invoices.reduce((s, i) => s + Number(i.total_amount), 0);
    let invest = 0;
    data.assets.forEach(a => {
      const snap = data.snapshots.find(s => s.asset_id === a.id);
      if (snap) invest += Number(snap.market_value);
      else {
        const movs = data.movements.filter(m => m.asset_id === a.id);
        invest += movs.reduce((s, m) => {
          if (m.type === 'deposit') return s + Number(m.amount);
          if (m.type === 'withdrawal') return s - Number(m.amount);
          return s + Number(m.amount);
        }, 0);
      }
    });

    const currentNetWorth = cash + invest - debt;
    const currentKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    
    // Simulando histórico de patrimônio baseado no fluxo de caixa (aproximação)
    let runningNetWorth = currentNetWorth;
    const sortedKeys = Object.keys(groups).sort().reverse();
    sortedKeys.forEach((key, idx) => {
      groups[key].netWorth = runningNetWorth;
      if (idx < sortedKeys.length - 1) {
        const flow = groups[key].income - groups[key].expense;
        runningNetWorth -= flow;
      }
    });

    return Object.values(groups);
  }, [data]);

  const categoryData = useMemo(() => {
    if (!data) return [];
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();

    const groups: Record<string, { name: string; value: number }> = {};
    
    data.transactions.forEach((t: any) => {
      if (t.type !== "expense") return;
      const date = new Date(t.occurred_on + "T12:00:00");
      if (date.getMonth() + 1 === currentMonth && date.getFullYear() === currentYear) {
        const cat = data.categories.find((c: any) => c.id === t.category_id);
        const name = cat?.name || "Sem categoria";
        if (!groups[name]) groups[name] = { name, value: 0 };
        groups[name].value += Number(t.amount);
      }
    });

    return Object.values(groups).sort((a, b) => b.value - a.value);
  }, [data]);

  const stats = useMemo(() => {
    if (monthlyData.length === 0) return { avgIncome: 0, avgExpense: 0, savingsRate: 0 };
    const totalIncome = monthlyData.reduce((s, m) => s + m.income, 0);
    const totalExpense = monthlyData.reduce((s, m) => s + m.expense, 0);
    const avgIncome = totalIncome / monthlyData.length;
    const avgExpense = totalExpense / monthlyData.length;
    const savingsRate = totalIncome > 0 ? ((totalIncome - totalExpense) / totalIncome) * 100 : 0;
    return { avgIncome, avgExpense, savingsRate };
  }, [monthlyData]);

  if (isLoading) return <div className="p-6 text-muted-foreground">Carregando relatórios...</div>;

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto animate-in fade-in duration-300 space-y-6">
      <div>
        <h1 className="font-display text-2xl md:text-3xl font-bold flex items-center gap-2">
          <BarChart3 className="h-7 w-7 text-primary" /> Relatórios
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Análise detalhada da sua evolução financeira.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-2xl border border-border bg-surface-1 p-5 shadow-card">
          <div className="text-xs text-muted-foreground uppercase tracking-wider flex items-center gap-1.5 mb-1">
            <TrendingUp className="h-3 w-3 text-income" /> Média de Receita
          </div>
          <div className="font-mono font-bold text-xl tabular">{formatBRL(stats.avgIncome)}</div>
          <div className="text-[10px] text-muted-foreground mt-1">Últimos 6 meses</div>
        </div>
        <div className="rounded-2xl border border-border bg-surface-1 p-5 shadow-card">
          <div className="text-xs text-muted-foreground uppercase tracking-wider flex items-center gap-1.5 mb-1">
            <TrendingDown className="h-3 w-3 text-expense" /> Média de Despesa
          </div>
          <div className="font-mono font-bold text-xl tabular">{formatBRL(stats.avgExpense)}</div>
          <div className="text-[10px] text-muted-foreground mt-1">Últimos 6 meses</div>
        </div>
        <div className="rounded-2xl border border-border bg-surface-1 p-5 shadow-card">
          <div className="text-xs text-muted-foreground uppercase tracking-wider flex items-center gap-1.5 mb-1">
            <Calendar className="h-3 w-3 text-primary" /> Taxa de Poupança
          </div>
          <div className={cn("font-mono font-bold text-xl tabular", stats.savingsRate >= 0 ? "text-audit-green" : "text-audit-red")}>
            {stats.savingsRate.toFixed(1)}%
          </div>
          <div className="text-[10px] text-muted-foreground mt-1">Média do período</div>
        </div>
      </div>

      {/* Gráfico de Patrimônio Líquido */}
      <div className="rounded-2xl border border-border bg-surface-1 p-5 shadow-card">
        <h2 className="font-display font-semibold mb-6 flex items-center gap-2">
          <Landmark className="h-4 w-4 text-primary" /> Evolução do Patrimônio Líquido
        </h2>
        <div className="h-[300px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={monthlyData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="colorNet" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="var(--primary)" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
              <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} dy={10} />
              <YAxis axisLine={false} tickLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 10 }} tickFormatter={(v) => `R$ ${v}`} />
              <Tooltip
                contentStyle={{ backgroundColor: "var(--surface-1)", borderColor: "var(--border)", borderRadius: "12px", fontSize: "12px" }}
                formatter={(v: number) => [formatBRL(v), "Patrimônio"]}
              />
              <Area type="monotone" dataKey="netWorth" stroke="var(--primary)" fillOpacity={1} fill="url(#colorNet)" strokeWidth={3} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Gráfico Mensal */}
        <div className="rounded-2xl border border-border bg-surface-1 p-5 shadow-card">
          <h2 className="font-display font-semibold mb-6 flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" /> Fluxo de Caixa Mensal
          </h2>
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 10 }} tickFormatter={(v) => `R$ ${v}`} />
                <Tooltip
                  cursor={{ fill: "var(--surface-2)" }}
                  contentStyle={{ backgroundColor: "var(--surface-1)", borderColor: "var(--border)", borderRadius: "12px", fontSize: "12px" }}
                  formatter={(v: number) => [formatBRL(v)]}
                />
                <Legend verticalAlign="top" align="right" iconType="circle" wrapperStyle={{ paddingBottom: "20px", fontSize: "12px" }} />
                <Bar name="Receita" dataKey="income" fill="var(--income)" radius={[4, 4, 0, 0]} />
                <Bar name="Despesa" dataKey="expense" fill="var(--expense)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Gráfico de Categorias */}
        <div className="rounded-2xl border border-border bg-surface-1 p-5 shadow-card">
          <h2 className="font-display font-semibold mb-6 flex items-center gap-2">
            <PieIcon className="h-4 w-4 text-primary" /> Gastos por Categoria
          </h2>
          <div className="h-[300px] w-full flex flex-col md:flex-row items-center">
            <div className="flex-1 h-full w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={categoryData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={80}
                    paddingAngle={5}
                    dataKey="value"
                  >
                    {categoryData.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} stroke="none" />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ backgroundColor: "var(--surface-1)", borderColor: "var(--border)", borderRadius: "12px", fontSize: "12px" }}
                    formatter={(v: number) => [formatBRL(v)]}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="flex-1 space-y-2 mt-4 md:mt-0 md:pl-6 w-full">
              {categoryData.slice(0, 5).map((c, i) => (
                <div key={c.name} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                    <span className="text-muted-foreground truncate max-w-[120px]">{c.name}</span>
                  </div>
                  <span className="font-mono font-semibold">{formatBRL(c.value)}</span>
                </div>
              ))}
              {categoryData.length > 5 && (
                <div className="text-[10px] text-muted-foreground text-center pt-2">
                  + {categoryData.length - 5} outras categorias
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}