import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { formatBRL, formatDateBR } from "@/lib/format";
import { ShieldCheck, AlertTriangle, AlertCircle, Info, Search, Filter, ArrowRightLeft } from "lucide-react";
import { useState, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/audit")({
  component: AuditPage,
});

function AuditPage() {
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [levelFilter, setLevelFilter] = useState("all");

  const { data: logs = [], isLoading } = useQuery({
    queryKey: ["audit-logs", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("audit_log")
        .select(`
          *,
          transactions (
            description,
            amount,
            occurred_on,
            type,
            account_id,
            to_account_id
          )
        `)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const { data: accounts = [] } = useQuery({
    queryKey: ["accounts-simple", user?.id],
    queryFn: async () => {
      const { data } = await supabase.from("accounts").select("id, name");
      return data ?? [];
    },
    enabled: !!user,
  });

  const filteredLogs = useMemo(() => {
    return logs.filter((log: any) => {
      const matchesSearch = 
        log.reasoning?.toLowerCase().includes(search.toLowerCase()) ||
        log.transactions?.description?.toLowerCase().includes(search.toLowerCase()) ||
        log.action?.toLowerCase().includes(search.toLowerCase());
      
      const matchesLevel = levelFilter === "all" || log.level === levelFilter;
      
      return matchesSearch && matchesLevel;
    });
  }, [logs, search, levelFilter]);

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto animate-in fade-in duration-300">
      <div className="mb-6">
        <h1 className="font-display text-2xl md:text-3xl font-bold flex items-center gap-2">
          <ShieldCheck className="h-7 w-7 text-primary" /> Auditoria de IA
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Transparência total sobre como a IA classifica e avalia seus gastos.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
        <div className="relative md:col-span-2">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input 
            placeholder="Buscar por justificativa ou transação..." 
            value={search} 
            onChange={(e) => setSearch(e.target.value)} 
            className="pl-9"
          />
        </div>
        <Select value={levelFilter} onValueChange={setLevelFilter}>
          <SelectTrigger>
            <div className="flex items-center gap-2">
              <Filter className="h-3.5 w-3.5 text-muted-foreground" />
              <SelectValue placeholder="Nível de Alerta" />
            </div>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os níveis</SelectItem>
            <SelectItem value="green">🟢 Saudável (Green)</SelectItem>
            <SelectItem value="yellow">🟡 Atenção (Yellow)</SelectItem>
            <SelectItem value="red">🔴 Crítico (Red)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">Carregando registros de auditoria...</div>
      ) : filteredLogs.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-12 text-center">
          <Info className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4" />
          <h3 className="font-display font-semibold text-lg">Nenhum registro encontrado</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Os registros aparecem aqui conforme você interage com a IA no chat.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredLogs.map((log: any) => (
            <AuditCard key={log.id} log={log} accounts={accounts} />
          ))}
        </div>
      )}
    </div>
  );
}

function AuditCard({ log, accounts }: { log: any; accounts: any[] }) {
  const levelMeta = {
    green: { icon: ShieldCheck, color: "text-audit-green", bg: "bg-audit-green/10", border: "border-audit-green/20", label: "Saudável" },
    yellow: { icon: AlertTriangle, color: "text-audit-yellow", bg: "bg-audit-yellow/10", border: "border-audit-yellow/20", label: "Atenção" },
    red: { icon: AlertCircle, color: "text-audit-red", bg: "bg-audit-red/10", border: "border-audit-red/20", label: "Crítico" },
  }[log.level as "green" | "yellow" | "red"] || { icon: Info, color: "text-muted-foreground", bg: "bg-muted/10", border: "border-border", label: "Info" };

  const Icon = levelMeta.icon;
  const isTransfer = log.transactions?.type === "transfer";
  const fromAcc = accounts.find(a => a.id === log.transactions?.account_id)?.name;
  const toAcc = accounts.find(a => a.id === log.transactions?.to_account_id)?.name;

  return (
    <div className={cn("rounded-2xl border p-4 md:p-5 shadow-card transition-all hover:shadow-elegant", levelMeta.bg, levelMeta.border)}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <div className={cn("h-10 w-10 rounded-xl flex items-center justify-center shrink-0 bg-background/50", levelMeta.color)}>
            <Icon className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-display font-bold text-sm uppercase tracking-wider">{log.action.replace(/_/g, ' ')}</span>
              <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-bold uppercase", levelMeta.bg, levelMeta.color)}>
                {levelMeta.label}
              </span>
            </div>
            <p className="text-sm mt-2 leading-relaxed text-foreground/90">
              {log.reasoning || "Sem justificativa detalhada fornecida pela IA."}
            </p>
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{formatDateBR(log.created_at)}</div>
          <div className="text-[10px] text-muted-foreground">{new Date(log.created_at).toLocaleTimeString("pt-BR", { hour: '2-digit', minute: '2-digit' })}</div>
        </div>
      </div>

      {log.transactions && (
        <div className="mt-4 pt-4 border-t border-border/50 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 min-w-0">
            <div className="h-6 w-6 rounded bg-surface-2 flex items-center justify-center text-[10px] shrink-0">
              {isTransfer ? <ArrowRightLeft className="h-3 w-3" /> : "TX"}
            </div>
            <div className="min-w-0">
              <span className="text-xs font-medium truncate block">{log.transactions.description}</span>
              {isTransfer && (
                <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                  <span>{fromAcc || "Origem"}</span>
                  <ArrowRightLeft className="h-2 w-2" />
                  <span>{toAcc || "Destino"}</span>
                </div>
              )}
            </div>
          </div>
          <div className={cn(
            "font-mono text-xs font-bold tabular", 
            isTransfer ? "text-muted-foreground" : (log.transactions.type === "income" ? "text-income" : "text-expense")
          )}>
            {isTransfer ? "" : (log.transactions.type === "income" ? "+" : "-")}{formatBRL(log.transactions.amount)}
          </div>
        </div>
      )}
    </div>
  );
}