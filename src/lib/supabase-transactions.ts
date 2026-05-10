import { supabase } from "@/integrations/supabase/client";

/**
 * Insere um novo lançamento garantindo o vínculo com o usuário logado.
 */
export async function insertTransaction(payload: {
  bank_id: string; 
  invoice_id?: string | null;
  amount: number;
  description: string;
  transaction_date: string; 
  type?: "expense" | "income" | "transfer";
  category_id?: string;
  to_account_id?: string;
}) {
  try {
    // 1. Forçar a obtenção do usuário da sessão atual
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return { error: "Usuário não autenticado" };
    }

    const dbPayload = {
      user_id: user.id, // Vínculo crítico para o RLS permitir a leitura depois
      account_id: payload.bank_id,
      invoice_id: payload.invoice_id || null,
      amount: Number(payload.amount),
      description: payload.description,
      occurred_on: payload.transaction_date,
      category_id: payload.category_id || null,
      type: payload.type || "expense",
      to_account_id: payload.to_account_id || null,
      source: "manual",
      status: "paid" as const
    };

    const { data, error } = await supabase
      .from("transactions")
      .insert(dbPayload)
      .select()
      .single();

    if (error) throw error;

    return { data };
  } catch (err: any) {
    console.error("Erro ao inserir:", err);
    return { error: err.message };
  }
}