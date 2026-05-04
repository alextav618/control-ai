import { formatBRL } from "@/lib/format";
import { cn } from "@/lib/utils";

export function BankBalances({ balances }: { balances: any[] }) {
  if (!balances?.length) {
    return <div className="text-center py-8 text-muted-foreground">Nenhum saldo cadastrado.</div>;
  }

  return (
    <div className="rounded-2xl border border-border bg-surface-1 p-4 md:p-6 shadow-card">
      <div className="space-y-4">
        {balances.map((b: any) => (
          <div key={b.bank_id} className="rounded-lg bg-surface-2 p-3 border border-border">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium">{b.bank_name}</div>
                <div className="text-xs text-muted-foreground">Agência</div>
              </div>
              <div className="font-mono tabular text-2xl font-semibold">
                {formatBRL(b.balance)}
              </div>
            </div>
            <div className="mt-1 text-xs text-muted-foreground truncate">
              Disponível para movimentação
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}