import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { transferFunds } from "@/lib/transfer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useBanks } from "@/lib/banks";
import { useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/app/transfers")({ component: TransfersPage });

function TransfersPage() {
  const { data: banks = [] } = useQuery({
    queryKey: ["banks"],
    queryFn: async () => {
      const { data, error } = await supabase.from("banks").select("id, name").order("name");
      if (error) throw error;
      return data as Array<{ id: string; name: string }>;
    },
  });

  const [fromBank, setFromBank] = useState<string | null>(null);
  const [toBank, setToBank] = useState<string | null>(null);
  const [amount, setAmount] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fromBank || !toBank || !amount || parseFloat(amount) <= 0) {
      setError("Preencha todos os campos corretamente.");
      return;
    }
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      await transferFunds(
        fromBank,
        toBank,
        parseFloat(amount),
        description
      );
      setSuccess("Transferência concluída com sucesso!");
      setTimeout(() => {
        setAmount        setAmount("");
        setDescription("");
        setFromBank(null);
        setToBank(null);
      }, 1500);
    } catch (err: any) {
      setError(err.message ?? "Erro inesperado.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto animate-in fade-in duration-300">
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-display text-2xl md:text-3xl font-bold">
          <span className="h-6 w-6 rounded-full bg-gradient-primary flex items-center justify-center text-primary-foreground">🏦</span>
          Transferir entre Bancos
        </h1>
        <Button variant="ghost" onClick={() => navigate("/app")}>
          ← Voltar ao Dashboard
        </Button>
      </div>

      <div className="rounded-2xl border border-border bg-surface-1 p-6 shadow-card">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label>Banco de Origem</Label>
              <Select value={fromBank} onValueChange={setFromBank}>
                <SelectTrigger className="mt-1.5">
                  <SelectValue placeholder="Selecione o banco de origem" />
                </SelectTrigger>
                <SelectContent>
                  {banks.map((b: any) => (
                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Banco de Destino</Label>
              <Select value={toBank} onValueChange={setToBank}>
                <SelectTrigger className="mt-1.5">
                  <SelectValue placeholder="Selecione o banco de destino" />
                </SelectTrigger>
                <SelectContent>
                  {banks.map((b: any) => (
                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>Valor</Label>
            <Input
              type="number"
              step="0.01"
              min="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0,00"
              className="mt-1.5 text-lg"
            />
          </div>
          <div>
            <Label>Descrição (opcional)</Label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Ex: Transferência para conta poupança"
              className="mt-1.5"
            />
          </div>
          {error && <p className="text-sm text-destructive bg-destructive/10 p-3 rounded-lg">{error}</p>}
          {success && <p className="text-sm text-audit-green bg-audit-green/10 p-3 rounded-lg">{success}</p>}
          <Button type="submit" disabled={loading || !fromBank || !toBank || !amount} className="w-full h-12 text-base">
            {loading ? (
              <>
                <Loader2 className="inline-block h-4 w-4 mr-2 animate-spin" />
                Processando...
              </>
            ) : (
              "Confirmar Transferência"
            )}
          </Button>
        </form>
      </div>
    </div>
  );
}