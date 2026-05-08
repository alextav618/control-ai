import { cn } from "@/lib/utils";
import { ShieldCheck, TrendingUp, AlertTriangle } from "lucide-react";

interface HealthScoreProps {
  score: number; // 0 a 100
  label: string;
  description: string;
}

export function HealthScore({ score, label, description }: HealthScoreProps) {
  const getColor = () => {
    if (score >= 80) return "text-audit-green";
    if (score >= 50) return "text-audit-yellow";
    return "text-audit-red";
  };

  const getBg = () => {
    if (score >= 80) return "bg-audit-green/10";
    if (score >= 50) return "bg-audit-yellow/10";
    return "bg-audit-red/10";
  };

  const Icon = score >= 80 ? ShieldCheck : score >= 50 ? TrendingUp : AlertTriangle;

  return (
    <div className={cn("rounded-2xl border border-border p-5 shadow-card flex items-center gap-5", getBg())}>
      <div className="relative h-20 w-20 shrink-0">
        <svg className="h-full w-full" viewBox="0 0 36 36">
          <path
            className="stroke-surface-3 fill-none"
            strokeWidth="3"
            d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
          />
          <path
            className={cn("fill-none transition-all duration-1000 ease-out", getColor().replace('text-', 'stroke-'))}
            strokeWidth="3"
            strokeDasharray={`${score}, 100`}
            strokeLinecap="round"
            d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center flex-col">
          <span className="text-xl font-bold font-mono leading-none">{score}</span>
          <span className="text-[8px] uppercase font-bold opacity-60">Score</span>
        </div>
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <Icon className={cn("h-4 w-4", getColor())} />
          <h3 className="font-display font-bold text-lg leading-tight">{label}</h3>
        </div>
        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
          {description}
        </p>
      </div>
    </div>
  );
}