import { createFileRoute } from '@tanstack/react-router'
"use client";

import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button, Input, Label, Select, SelectTrigger, SelectValue, SelectContent } from "@/components/ui/form";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/app/transfers")({ component: TransferPage });

function TransferPage() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const [banks, setBanks] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedFrom, setSelectedFrom] = useState<string>("");
  const [selectedTo, setSelectedTo] = useState<string>("");
  const [amount, setAmount] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [transferResult, setTransferResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  // Carrega os bancos ao montar
  useEffect(() => {
    const fetchBanks = async () => {
      const { data, error } = await supabase.from("banks").select("id, name").order("name", { ascending: true });
      if (error) {
        console.error("Erro ao buscar bancos:", error);
        return;
      }
      setBanks(data as Array<{ id: string; name: string }>);
    };
    fetchBanks();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setTransferResult(null);

    if (!selectedFrom || !selectedTo || !amount || selectedFrom === selectedTo) {
      setError("Selecione contas diferentes e informe um valor.");
      setSubmitting(false);
      return;
    }

    const amountNum = Number(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      setError("Valor inválido.");
      setSubmitting(false);
      return;
    }

    try {
      const { data, error: rpcError } = await supabase.rpc("transfer_funds", {
        p_from_bank_id: selectedFrom,
        p_to_bank_id: selectedTo,
        p_amount: amountNum,
        p_description: description,
      });

      if (rpcError) {
        throw rpcError;
      }

      setTransferResult(data);
    } catch (err: any) {
      console.error("Transfer RPC error:", err);
      setError(err.message ?? "Falha ao processar transferência.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto animate-in fade-in duration-300 space-y-6">
      <h1 className="font-display text-2xl md:text-3xl font-bold">
        <svg className="h-6 w-6 text-primary inline mr-1" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16v8a4 4 0 008 0v-8m-8 0V8a4 4 0 018 0v8m-8 0V8a4 4 0 018 0v8m-8 0v-8a4 4 0 018 0v8m-8 0V8a4 4 0 018 0v8" />
        </svg>
        Transferências entre contas
      </h1>

      {error && <div className="rounded-md bg-destructive/20 p-2.5 text-sm text-destructive">{error}</div>}

      {transferResult && (
        <div className="rounded-md bg-audit-green/20 p-2.5 text-sm text-audit-green">
          ✅ Transferência concluída! ID: {transferResult.transferId}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Conta de Origem */}
        <div>
          <Label>Conta de Origem</Label>
          <SelectTrigger asChild>
            <SelectValue className="text-muted-foreground" />
            <SelectContent>
              {banks.map((bank) => (
                <SelectItem key={bank.id} value={bank.id}>
                  {bank.name}
                </SelectItem>
              ))}
            </SelectContent>
          </SelectTrigger>
        </div>

        {/* Conta de Destino */}
        <div>
          <Label>Conta de Destino</Label>
          <SelectTrigger asChild>
            <SelectValue className="text-muted-foreground" />
            <SelectContent>
              {banks.map((bank) => (
                <SelectItem key={bank.id} value={bank.id}>
                  {bank.name}
                </SelectItem>
              ))}
            </SelectContent>
          </SelectTrigger>
        </div>

        {/* Valor */}
        <div>
          <Label>Valor (R$)</Label>
          <Input
            type="number"
            step="0.01"
            min="1"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="Ex: 150.00"
            className="mt-1.5"
          />
        </div>

        {/* Descrição */}
        <div>
          <Label>Descrição</Label>
          <Input            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Ex: Transferência para João Silva"
            className="mt-1.5"
          />
        </div>

        <Button
          type="submit"
          className={cn("w-full", submitting && "opacity-70 cursor-not-allowed")}
          disabled={submitting}
        >
          {submitting ? (
            <>
              <svg className="animate-spin h-4 w-4 mr-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth={4} />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              Processando...
            </>
          ) : (
            "Transferir"
          )}
        </Button>
      </form>

      {/* Exibir saldo atualizado após transferência bem‑sucedida */}
      {transferResult && (
        <div className="mt-4 rounded-md bg-surface-2 p-3 text-sm text-muted-foreground">
          Saldo atualizado nas contas envolvidas foi refletido automaticamente nas visualizações de banco.
        </div>
      )}
    </div>
  );
}