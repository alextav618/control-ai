import { formatBRL } from "@/lib/format";
import { cn } from "@/lib/utils";

interface BreakdownCardProps {
  label: string;
  value: number;
  total: number;
  color: string;
}

export function BreakdownCard({ label, value, total, color }: BreakdownCardProps) {
  const pct = total > 0 ? Math.min(100, (value / total) * 100) : 0;
  return (
    <div className="rounded-2xl border border-border bg-surface-1 p-4 md:p-5 shadow-card hover:shadow-elegant transition-shadow">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="text-xs text-muted-foreground font-mono">{pct.toFixed(0)}%</span>
      </div>
      <div className="mt-2 font-mono tabular text-lg md:text-xl font-semibold">{formatBRL(value)}</div>
      <div className="mt-3 h-1.5 rounded-full bg-surface-2 overflow-hidden">
        <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}