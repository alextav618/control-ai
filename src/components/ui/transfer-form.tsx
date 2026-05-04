import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { transferFunds } from "@/lib/transfer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useQuery } from "@tanstack/react-query";
import { useBanks } from "@/lib/banks";

export function TransferForm() {
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
      setAmount("");
      setDescription("");
    } catch (err: any) {
      setError(err.message ?? "Erro inesperado.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={!!fromBank} onOpenChange={(v) => setFromBank(v ? null : fromBank)}>
      <DialogTrigger asChild>
        <Button variant="outline">Transferir entre bancos</Button>
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
            <Input
              type="number"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              min={1}
              className="mt-1.5"
            />
          </div>
          <div>
            <Label>Descrição (opcional)</Label>
            <Input              value={description}
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
                <span className="inline-block h-4 w-4 mr-2 animate-spin">⏳</span> Processando...
              </>
            ) : (
              "Transferir"
            )}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}