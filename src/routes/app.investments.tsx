import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { formatBRL, formatDateBR } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Trash2, TrendingUp, TrendingDown, ChevronRight, ArrowLeft, Camera, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/investments")({
  component: InvestmentsPage,
});

const ASSET_TYPES: Record<string, string> = {
  fixed_income: "Renda Fixa",
  stock: "Ação",
  reit: "FII",
  crypto: "Cripto",
  fund: "Fundo",
  treasury: "Tesouro",
  other: "Outro",
};

const INDEXERS: Record<string, string> = {
  cdi: "% CDI",
  ipca: "IPCA +",
  selic: "% SELIC",
  prefixed: "Prefixado",
  none: "—",
};

const MOV_TYPES: Record<string, { label: string; sign: 1 | -1; color: string }> = {
  deposit: { label: "Aporte", sign: 1, color: "text-audit-green" },
  withdrawal: { label: "Resgate", sign: -1, color: "text-audit-red" },
  interest: { label: "Juros", sign: 1, color: "text-audit-green" },
  dividend: { label: "Dividendo", sign: 1, color: "text-audit-green" },
  fee: { label: "Taxa", sign: -1, color: "text-audit-red" },
  tax: { label: "Imposto", sign: -1, color: "text-audit-red" },
};

// Calcula a taxa anual efetiva do ativo dado os indexadores atuais
function effectiveAnnualRate(
  indexer: string,
  rate: number | null,
  rates: { cdi?: number; selic?: number; ipca?: number },
): number | null {
  if (rate == null) return null;
  switch (indexer) {
    case "cdi": return rates.cdi != null ? (rates.cdi * rate) / 100 : null;
    case "selic": return rates.selic != null ? (rates.selic * rate) / 100 : null;
    case "ipca": return rates.ipca != null ? rates.ipca + rate : null;
    case "prefixed": return rate;
    default: return null;
  }
}

function InvestmentsPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [openAsset, setOpenAsset] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [assetForm, setAssetForm] = useState({
    name: "", type: "fixed_income", indexer: "cdi", rate: "", account_id: "", ticker: "", maturity_date: "",
  });

  const { data: assets = [] } = useQuery({
    queryKey: ["assets", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("investment_assets").select("*").eq("archived", false).order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const { data: accounts = [] } = useQuery({
    queryKey: ["accounts_for_invest", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("accounts").select("id,name,type,icon").eq("archived", false).order("name");
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const { data: indexRates = [] } = useQuery({
    queryKey: ["index_rates"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("index_rates").select("*");
      if (error) throw error;
      return (data || []) as Array<{ code: string; annual_rate: number; reference_date: string; updated_at: string; source: string | null }>;
    },
    refetchOnWindowFocus: false,
  });

  const ratesMap = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of indexRates) m[r.code] = Number(r.annual_rate);
    return { cdi: m.cdi, selic: m.selic, ipca: m.ipca };
  }, [indexRates]);

  const lastRateUpdate = useMemo(() => {
    if (!indexRates.length) return null;
    return indexRates.map((r) => r.updated_at).sort().pop() || null;
  }, [indexRates]);

  const refreshRates = async () => {
    toast.loading("Atualizando taxas...", { id: "rates" });
    try {
      const res = await fetch("/api/public/hooks/update-rates", { method: "POST" });
      if (!res.ok) throw new Error();
      toast.success("Taxas atualizadas", { id: "rates" });
      qc.invalidateQueries({ queryKey: ["index_rates"] });
    } catch {
      toast.error("Falha ao atualizar taxas", { id: "rates" });
    }
  };

  const { data: allMov = [] } = useQuery({
    queryKey: ["all_movements", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("investment_movements").select("*");
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const { data: allSnaps = [] } = useQuery({
    queryKey: ["all_snapshots", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("investment_snapshots").select("*").order("snapshot_date", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const positions = useMemo(() => {
    const map = new Map<string, { invested: number; withdrawn: number; income: number; lastSnap: number | null; lastSnapDate: string | null }>();
    for (const a of assets) map.set(a.id, { invested: 0, withdrawn: 0, income: 0, lastSnap: null, lastSnapDate: null });
    for (const m of allMov) {
      const p = map.get(m.asset_id); if (!p) continue;
      const amt = Number(m.amount);
      if (m.type === "deposit") p.invested += amt;
      else if (m.type === "withdrawal") p.withdrawn += amt;
      else if (m.type === "interest" || m.type === "dividend") p.income += amt;
      else if (m.type === "fee" || m.type === "tax") p.income -= amt;
    }
    for (const s of allSnaps) {
      const p = map.get(s.asset_id); if (!p) continue;
      if (!p.lastSnap || (p.lastSnapDate && s.snapshot_date > p.lastSnapDate)) {
        p.lastSnap = Number(s.market_value);
        p.lastSnapDate = s.snapshot_date;
      }
    }
    return map;
  }, [assets, allMov, allSnaps]);

  const totals = useMemo(() => {
    let invested = 0, current = 0;
    for (const a of assets) {
      const p = positions.get(a.id)!;
      const net = p.invested - p.withdrawn;
      invested += net;
      current += p.lastSnap ?? (net + p.income);
    }
    return { invested, current, profit: current - invested };
  }, [assets, positions]);

  // Agrupa por instituição (account)
  const byInstitution = useMemo(() => {
    const groups = new Map<string, { name: string; icon?: string; assets: any[]; total: number }>();
    for (const a of assets) {
      const acc = accounts.find((x: any) => x.id === a.account_id);
      const key = acc?.id || "_none";
      const name = acc?.name || "Sem instituição";
      const p = positions.get(a.id)!;
      const net = p.invested - p.withdrawn;
      const cur = p.lastSnap ?? (net + p.income);
      const g = groups.get(key) || { name, icon: acc?.icon, assets: [], total: 0 };
      g.assets.push(a);
      g.total += cur;
      groups.set(key, g);
    }
    return Array.from(groups.values()).sort((a, b) => b.total - a.total);
  }, [assets, accounts, positions]);

  const createAsset = async () => {
    if (!user || !assetForm.name) return;
    const { error } = await supabase.from("investment_assets").insert({
      user_id: user.id,
      name: assetForm.name,
      type: assetForm.type as any,
      indexer: assetForm.indexer as any,
      rate: assetForm.rate ? Number(assetForm.rate) : null,
      account_id: assetForm.account_id || null,
      ticker: assetForm.ticker || null,
      maturity_date: assetForm.maturity_date || null,
    } as any);
    if (error) return toast.error(error.message);
    toast.success("Ativo criado");
    setOpenAsset(false);
    setAssetForm({ name: "", type: "fixed_income", indexer: "cdi", rate: "", account_id: "", ticker: "", maturity_date: "" });
    qc.invalidateQueries({ queryKey: ["assets"] });
  };

  const archiveAsset = async (id: string) => {
    if (!confirm("Arquivar este ativo? O histórico fica preservado.")) return;
    const { error } = await supabase.from("investment_assets").update({ archived: true }).eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success("Arquivado"); qc.invalidateQueries({ queryKey: ["assets"] }); setSelectedId(null); }
  };

  if (selectedId) {
    const asset = assets.find((a: any) => a.id === selectedId);
    if (!asset) { setSelectedId(null); return null; }
    return <AssetDetail asset={asset} accounts={accounts} ratesMap={ratesMap} onBack={() => setSelectedId(null)} onArchive={() => archiveAsset(asset.id)} position={positions.get(asset.id)!} />;
  }

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto animate-in fade-in duration-300">
      <div className="flex items-center justify-between mb-6 gap-2 flex-wrap">
        <h1 className="font-display text-2xl md:text-3xl font-bold">Investimentos</h1>
        <Dialog open={openAsset} onOpenChange={setOpenAsset}>
          <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-2" />Novo ativo</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Novo ativo</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div><Label>Nome</Label><Input value={assetForm.name} onChange={(e) => setAssetForm({ ...assetForm, name: e.target.value })} placeholder="Ex: CDB Nubank, ITSA4, Tesouro IPCA 2035" className="mt-1.5" /></div>
              <div>
                <Label>Instituição (conta)</Label>
                <Select value={assetForm.account_id || "none"} onValueChange={(v) => setAssetForm({ ...assetForm, account_id: v === "none" ? "" : v })}>
                  <SelectTrigger className="mt-1.5"><SelectValue placeholder="Selecione uma conta" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Nenhuma</SelectItem>
                    {accounts.map((a: any) => (
                      <SelectItem key={a.id} value={a.id}>{a.icon ? `${a.icon} ` : ""}{a.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">Vincula o ativo a uma instituição cadastrada. Não afeta o saldo da conta.</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Tipo</Label>
                  <Select value={assetForm.type} onValueChange={(v) => setAssetForm({ ...assetForm, type: v })}>
                    <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(ASSET_TYPES).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Indexador</Label>
                  <Select value={assetForm.indexer} onValueChange={(v) => setAssetForm({ ...assetForm, indexer: v })}>
                    <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(INDEXERS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Taxa (%)</Label><Input type="number" step="0.01" value={assetForm.rate} onChange={(e) => setAssetForm({ ...assetForm, rate: e.target.value })} placeholder="Ex: 110" className="mt-1.5" /></div>
                <div><Label>Vencimento</Label><Input type="date" value={assetForm.maturity_date} onChange={(e) => setAssetForm({ ...assetForm, maturity_date: e.target.value })} className="mt-1.5" /></div>
              </div>
              <div><Label>Ticker (opcional)</Label><Input value={assetForm.ticker} onChange={(e) => setAssetForm({ ...assetForm, ticker: e.target.value.toUpperCase() })} className="mt-1.5" /></div>
              <Button onClick={createAsset} className="w-full">Criar ativo</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Taxas atuais de mercado */}
      <div className="rounded-2xl border border-border bg-surface-1 p-4 mb-6">
        <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
          <div>
            <div className="text-sm font-semibold">Taxas atuais</div>
            {lastRateUpdate && <div className="text-xs text-muted-foreground">Atualizado em {formatDateBR(lastRateUpdate)}</div>}
          </div>
          <Button size="sm" variant="ghost" onClick={refreshRates}><RefreshCw className="h-3.5 w-3.5 mr-1.5" />Atualizar</Button>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <RateChip label="CDI" value={ratesMap.cdi} />
          <RateChip label="SELIC" value={ratesMap.selic} />
          <RateChip label="IPCA" value={ratesMap.ipca} />
        </div>
      </div>

      {/* Resumo */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <KpiCard label="Investido (líquido)" value={formatBRL(totals.invested)} />
        <KpiCard label="Patrimônio atual" value={formatBRL(totals.current)} accent />
        <KpiCard
          label="Lucro / Prejuízo"
          value={formatBRL(totals.profit)}
          tone={totals.profit >= 0 ? "green" : "red"}
          icon={totals.profit >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
        />
      </div>

      {/* Lista por instituição */}
      {assets.length === 0 ? (
        <div className="rounded-2xl border border-border bg-surface-1 p-10 text-center text-muted-foreground text-sm">
          Nenhum ativo ainda. Cadastre o primeiro para começar a registrar aportes.
        </div>
      ) : (
        <div className="space-y-4">
          {byInstitution.map((g) => (
            <div key={g.name} className="rounded-2xl border border-border bg-surface-1 overflow-hidden">
              <div className="px-4 py-2.5 flex items-center justify-between bg-surface-2/50 border-b border-border">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <span>{g.icon || "🏦"}</span>
                  <span>{g.name}</span>
                  <span className="text-xs text-muted-foreground">· {g.assets.length} ativo{g.assets.length > 1 ? "s" : ""}</span>
                </div>
                <span className="font-mono font-semibold text-sm tabular">{formatBRL(g.total)}</span>
              </div>
              <div className="divide-y divide-border">
                {g.assets.map((a: any) => {
                  const p = positions.get(a.id)!;
                  const net = p.invested - p.withdrawn;
                  const cur = p.lastSnap ?? (net + p.income);
                  const profit = cur - net;
                  const profitPct = net > 0 ? (profit / net) * 100 : 0;
                  const eff = effectiveAnnualRate(a.indexer, a.rate, ratesMap);
                  return (
                    <button key={a.id} onClick={() => setSelectedId(a.id)} className="w-full p-4 flex items-center gap-3 hover:bg-surface-2 transition-colors text-left">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium truncate">{a.name}</span>
                          {a.ticker && <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono">{a.ticker}</span>}
                        </div>
                        <div className="text-xs text-muted-foreground flex gap-2 flex-wrap mt-0.5">
                          <span>{ASSET_TYPES[a.type]}</span>
                          {a.indexer !== "none" && <><span>·</span><span>{a.rate ?? "—"} {INDEXERS[a.indexer]}</span></>}
                          {eff != null && <><span>·</span><span className="text-primary">≈ {eff.toFixed(2)}% a.a.</span></>}
                          {p.lastSnapDate && <><span>·</span><span>atualizado {formatDateBR(p.lastSnapDate)}</span></>}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-mono font-semibold tabular">{formatBRL(cur)}</div>
                        <div className={cn("text-xs font-mono tabular", profit >= 0 ? "text-audit-green" : "text-audit-red")}>
                          {profit >= 0 ? "+" : ""}{formatBRL(profit)} ({profitPct.toFixed(2)}%)
                        </div>
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RateChip({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className="rounded-xl bg-surface-2 px-3 py-2 text-center">
      <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</div>
      <div className="font-mono font-bold text-base tabular">{value != null ? `${value.toFixed(2)}%` : "—"}</div>
    </div>
  );
}

function KpiCard({ label, value, accent, tone, icon }: { label: string; value: string; accent?: boolean; tone?: "green" | "red"; icon?: React.ReactNode }) {
  return (
    <div className={cn("rounded-2xl border border-border bg-surface-1 p-4", accent && "bg-gradient-to-br from-surface-1 to-surface-2")}>
      <div className="text-xs text-muted-foreground flex items-center gap-1.5">{icon}{label}</div>
      <div className={cn("font-mono font-bold text-2xl tabular mt-1", tone === "green" && "text-audit-green", tone === "red" && "text-audit-red")}>{value}</div>
    </div>
  );
}

function AssetDetail({ asset, accounts, ratesMap, onBack, onArchive, position }: { asset: any; accounts: any[]; ratesMap: { cdi?: number; selic?: number; ipca?: number }; onBack: () => void; onArchive: () => void; position: any }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [openMov, setOpenMov] = useState(false);
  const [openSnap, setOpenSnap] = useState(false);
  const [movForm, setMovForm] = useState({ type: "deposit", amount: "", occurred_on: new Date().toISOString().slice(0, 10), notes: "" });
  const [snapForm, setSnapForm] = useState({ market_value: "", snapshot_date: new Date().toISOString().slice(0, 10) });

  const { data: movements = [] } = useQuery({
    queryKey: ["movements", asset.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("investment_movements").select("*").eq("asset_id", asset.id).order("occurred_on", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: snapshots = [] } = useQuery({
    queryKey: ["snapshots", asset.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("investment_snapshots").select("*").eq("asset_id", asset.id).order("snapshot_date", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const net = position.invested - position.withdrawn;
  const cur = position.lastSnap ?? (net + position.income);
  const profit = cur - net;
  const profitPct = net > 0 ? (profit / net) * 100 : 0;
  const account = accounts.find((a) => a.id === asset.account_id);
  const eff = effectiveAnnualRate(asset.indexer, asset.rate, ratesMap);
  // Projeção de rendimento mensal (taxa anual -> mensal composta)
  const monthlyYield = eff != null ? cur * (Math.pow(1 + eff / 100, 1 / 12) - 1) : null;

  const addMov = async () => {
    if (!user || !movForm.amount) return;
    const { error } = await supabase.from("investment_movements").insert({
      user_id: user.id, asset_id: asset.id,
      type: movForm.type as any,
      amount: Number(movForm.amount),
      occurred_on: movForm.occurred_on,
      notes: movForm.notes || null,
    });
    if (error) return toast.error(error.message);
    toast.success("Movimentação registrada");
    setOpenMov(false);
    setMovForm({ type: "deposit", amount: "", occurred_on: new Date().toISOString().slice(0, 10), notes: "" });
    qc.invalidateQueries({ queryKey: ["movements", asset.id] });
    qc.invalidateQueries({ queryKey: ["all_movements"] });
  };

  const addSnap = async () => {
    if (!user || !snapForm.market_value) return;
    const { error } = await supabase.from("investment_snapshots").upsert({
      user_id: user.id, asset_id: asset.id,
      snapshot_date: snapForm.snapshot_date,
      market_value: Number(snapForm.market_value),
    }, { onConflict: "asset_id,snapshot_date" });
    if (error) return toast.error(error.message);
    toast.success("Posição atualizada");
    setOpenSnap(false);
    setSnapForm({ market_value: "", snapshot_date: new Date().toISOString().slice(0, 10) });
    qc.invalidateQueries({ queryKey: ["snapshots", asset.id] });
    qc.invalidateQueries({ queryKey: ["all_snapshots"] });
  };

  const removeMov = async (id: string) => {
    const { error } = await supabase.from("investment_movements").delete().eq("id", id);
    if (error) toast.error(error.message);
    else { qc.invalidateQueries({ queryKey: ["movements", asset.id] }); qc.invalidateQueries({ queryKey: ["all_movements"] }); }
  };

  const removeSnap = async (id: string) => {
    const { error } = await supabase.from("investment_snapshots").delete().eq("id", id);
    if (error) toast.error(error.message);
    else { qc.invalidateQueries({ queryKey: ["snapshots", asset.id] }); qc.invalidateQueries({ queryKey: ["all_snapshots"] }); }
  };

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto">
      <Button variant="ghost" size="sm" onClick={onBack} className="mb-4"><ArrowLeft className="h-4 w-4 mr-2" />Voltar</Button>

      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-2xl md:text-3xl font-bold flex items-center gap-2 flex-wrap">
            {asset.name}
            {asset.ticker && <span className="text-sm px-2 py-0.5 rounded bg-muted text-muted-foreground font-mono">{asset.ticker}</span>}
          </h1>
          <div className="text-sm text-muted-foreground mt-1 flex gap-2 flex-wrap">
            <span>{ASSET_TYPES[asset.type]}</span>
            {asset.indexer !== "none" && <><span>·</span><span>{asset.rate ?? "—"} {INDEXERS[asset.indexer]}</span></>}
            {eff != null && <><span>·</span><span className="text-primary">≈ {eff.toFixed(2)}% a.a.</span></>}
            {account && <><span>·</span><span>{account.icon ? `${account.icon} ` : ""}{account.name}</span></>}
            {asset.maturity_date && <><span>·</span><span>vence {formatDateBR(asset.maturity_date)}</span></>}
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={onArchive} className="text-muted-foreground"><Trash2 className="h-4 w-4 mr-2" />Arquivar</Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <KpiCard label="Investido" value={formatBRL(net)} />
        <KpiCard label="Atual" value={formatBRL(cur)} accent />
        <KpiCard label="Lucro" value={formatBRL(profit)} tone={profit >= 0 ? "green" : "red"} />
        <KpiCard label="Rentab." value={`${profitPct.toFixed(2)}%`} tone={profit >= 0 ? "green" : "red"} />
      </div>

      {monthlyYield != null && (
        <div className="rounded-2xl border border-border bg-gradient-to-br from-surface-1 to-surface-2 p-4 mb-6">
          <div className="text-xs text-muted-foreground">Rendimento estimado pela taxa atual</div>
          <div className="flex gap-6 mt-1 flex-wrap">
            <div>
              <div className="text-[10px] text-muted-foreground uppercase">Mensal</div>
              <div className="font-mono font-bold text-lg tabular text-audit-green">+{formatBRL(monthlyYield)}</div>
            </div>
            <div>
              <div className="text-[10px] text-muted-foreground uppercase">Anual</div>
              <div className="font-mono font-bold text-lg tabular text-audit-green">+{formatBRL(cur * (eff! / 100))}</div>
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground mt-2">Estimativa baseada em CDI/SELIC/IPCA atuais. Não considera IR.</p>
        </div>
      )}

      <div className="flex gap-2 mb-4 flex-wrap">
        <Dialog open={openMov} onOpenChange={setOpenMov}>
          <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-2" />Movimentação</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Nova movimentação</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Tipo</Label>
                  <Select value={movForm.type} onValueChange={(v) => setMovForm({ ...movForm, type: v })}>
                    <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(MOV_TYPES).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>Data</Label><Input type="date" value={movForm.occurred_on} onChange={(e) => setMovForm({ ...movForm, occurred_on: e.target.value })} className="mt-1.5" /></div>
              </div>
              <div><Label>Valor</Label><Input type="number" step="0.01" value={movForm.amount} onChange={(e) => setMovForm({ ...movForm, amount: e.target.value })} className="mt-1.5" /></div>
              <div><Label>Observação</Label><Input value={movForm.notes} onChange={(e) => setMovForm({ ...movForm, notes: e.target.value })} className="mt-1.5" /></div>
              <Button onClick={addMov} className="w-full">Registrar</Button>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={openSnap} onOpenChange={setOpenSnap}>
          <DialogTrigger asChild><Button variant="outline"><Camera className="h-4 w-4 mr-2" />Atualizar valor</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Posição em uma data</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <p className="text-xs text-muted-foreground">Informe o valor de mercado do ativo nessa data. Usamos isso pra calcular sua rentabilidade real.</p>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Data</Label><Input type="date" value={snapForm.snapshot_date} onChange={(e) => setSnapForm({ ...snapForm, snapshot_date: e.target.value })} className="mt-1.5" /></div>
                <div><Label>Valor de mercado</Label><Input type="number" step="0.01" value={snapForm.market_value} onChange={(e) => setSnapForm({ ...snapForm, market_value: e.target.value })} className="mt-1.5" /></div>
              </div>
              <Button onClick={addSnap} className="w-full">Salvar</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Tabs defaultValue="movements">
        <TabsList>
          <TabsTrigger value="movements">Movimentações ({movements.length})</TabsTrigger>
          <TabsTrigger value="snapshots">Histórico de valor ({snapshots.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="movements">
          <div className="rounded-2xl border border-border bg-surface-1 overflow-hidden">
            {movements.length === 0 && <div className="p-8 text-center text-muted-foreground text-sm">Nenhuma movimentação ainda.</div>}
            <div className="divide-y divide-border">
              {movements.map((m: any) => {
                const meta = MOV_TYPES[m.type];
                return (
                  <div key={m.id} className="p-3 flex items-center gap-3">
                    <div className="flex-1">
                      <div className="font-medium text-sm">{meta.label}</div>
                      <div className="text-xs text-muted-foreground">{formatDateBR(m.occurred_on)}{m.notes ? ` · ${m.notes}` : ""}</div>
                    </div>
                    <div className={cn("font-mono font-semibold tabular", meta.color)}>
                      {meta.sign > 0 ? "+" : "−"}{formatBRL(Number(m.amount))}
                    </div>
                    <Button size="icon" variant="ghost" onClick={() => removeMov(m.id)}><Trash2 className="h-4 w-4 text-muted-foreground" /></Button>
                  </div>
                );
              })}
            </div>
          </div>
        </TabsContent>
        <TabsContent value="snapshots">
          <div className="rounded-2xl border border-border bg-surface-1 overflow-hidden">
            {snapshots.length === 0 && <div className="p-8 text-center text-muted-foreground text-sm">Nenhuma foto ainda. Atualize o valor pra ver evolução.</div>}
            <div className="divide-y divide-border">
              {snapshots.map((s: any) => (
                <div key={s.id} className="p-3 flex items-center gap-3">
                  <div className="flex-1">
                    <div className="font-medium text-sm">{formatDateBR(s.snapshot_date)}</div>
                  </div>
                  <div className="font-mono font-semibold tabular">{formatBRL(Number(s.market_value))}</div>
                  <Button size="icon" variant="ghost" onClick={() => removeSnap(s.id)}><Trash2 className="h-4 w-4 text-muted-foreground" /></Button>
                </div>
              ))}
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
