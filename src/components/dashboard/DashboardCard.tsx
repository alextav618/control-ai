import { cn } from "@/lib/utils";

interface DashboardCardProps {
  title: string;
  children: React.ReactNode;
  className?: string;
  icon?: any;
}

export function DashboardCard({ title, children, className, icon: Icon }: DashboardCardProps) {
  return (
    <div className={cn("rounded-2xl border border-border bg-surface-1 p-4 md:p-5 shadow-card", className)}>
      <h2 className="font-display font-semibold mb-4 flex items-center gap-2">
        {Icon && <Icon className="h-4 w-4 text-primary" />}
        {title}
      </h2>
      {children}
    </div>
  );
}