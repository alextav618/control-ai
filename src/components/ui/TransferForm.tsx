import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useBanks } from "@/lib/banks";
import { toast } from "sonner";

interface TransferFormProps {
  onTransfer?: (data: { fromBankId: string; toBankId: string; amount: number; description: string }) => void;
}

export function TransferForm({ onTransfer }: TransferFormProps) {
  const { data: banks = [] } = useBanks();
  const [fromBankId, setFromBankId] = useState<string>("");
  const [toBankId, setToBankId] = useState<string>("");
  const [amount, setAmount] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!fromBankId || !toBankId || !amount || fromBankId === toBankId) {
      toast.error("Selecione contas diferentes e informe um valor.");
      return;
    }

    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      toast.error("Valor inválido.");
      return;
    }

    setIsSubmitting(true);
    try {
      await onTransfer?.({
        fromBankId,
        toBankId,
        amount: amountNum,
        description: description || "Transferência"
      });
      
      // Reset form
      setFromBankId("");
      setToBankId("");
      setAmount("");
      setDescription("");
    } catch (error) {
      toast.error("Falha ao processar transferência.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <Label>Conta de Origem</Label>
        <Select value={fromBankId} onValueChange={setFromBankId}>
          <SelectTrigger>
            <SelectValue placeholder="Selecione a conta de origem" />
          </SelectTrigger>
          <SelectContent>
            {banks.map((bank) => (
              <SelectItem key={bank.id} value={bank.id}>
                {bank.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label>Conta de Destino</Label>
        <Select value={toBankId} onValueChange={setToBankId}>
          <SelectTrigger>
            <SelectValue placeholder="Selecione a conta de destino" />
          </SelectTrigger>
          <SelectContent>
            {banks.map((bank) => (
              <SelectItem key={bank.id} value={bank.id}>
                {bank.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label>Valor (R$)</Label>
        <Input
          type="number"
          step="0.01"
          min="1"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="Ex: 150.00"
        />
      </div>

      <div>
        <Label>Descrição</Label>
        <Input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Ex: Transferência para João Silva"
        />
      </div>

      <Button type="submit" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? "Processando..." : "Transferir"}
      </Button>
    </form>
  );
}