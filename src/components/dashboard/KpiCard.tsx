import { cn } from "@/lib/utils";

interface KpiCardProps {
  label: string;
  value: string;
  icon?: any;
  accent?: "income" | "expense";
}

export function KpiCard({ label, value, icon: Icon, accent }: KpiCardProps) {
  return (
    <div className="rounded-2xl border border-border bg-surface-1 p-4 md:p-5 shadow-card hover:shadow-elegant transition-shadow">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        {Icon && <Icon className="h-4 w-4" />}
      </div>
      <div className={cn(
        "mt-2 font-mono tabular text-xl md:text-2xl font-semibold",
        accent === "income" && "text-income",
        accent === "expense" && "text-expense"
      )}>
        {value}
      </div>
    </div>
  );
}