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
import { useRouter, createFileRoute } from "@tanstack/react-router";
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
  const router = useRouter();

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
      const result = await transferFunds(
        fromBank,
        toBank,
        parseFloat(amount),
        description
      );
      setSuccess("Transferência concluída com sucesso!");
      // Reset fields and navigate back after a short delay
      setTimeout(() => {
        setAmount("");
        setDescription("");
        setFromBank(null);
        setToBank(null);
        navigate("/app");
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

      <Dialog open={!!fromBank} onOpenChange={(v) => setFromBank(v ? null : fromBank)}>
        <DialogTrigger asChild>
          <Button variant="outline" className="mr-2">
            {fromBank ? "Selecionar Destino" : "Selecionar Origem"}
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader><DialogTitle>Transferência entre Bancos</DialogTitle></DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label>Banco de Origem</Label>
              <Select value={fromBank} onValueChange={(v) => setFromBank(v)}>
                <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {banks.map((b: any) => (
                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Banco de Destino</Label>
              <Select value={toBank} onValueChange={(v) => setToBank(v)}>
                <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {banks.map((b: any) => (
                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Valor</Label>
              <Input                type="number"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                min={1}
                className="mt-1.5"
              />
            </div>
            <div>
              <Label>Descrição (opcional)</Label>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="mt-1.5"
                placeholder="Ex: Transferência para conta X"
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            {success && <p className="text-sm text-audit-green">{success}</p>}
            <Button type="submit" disabled={loading} className="w-full">
              {loading ? (
                <>
                  <Loader2 className="inline-block h-4 w-4 mr-2 animate-spin" /> Processando...
                </>
              ) : (
                "Transferir"
              )}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}