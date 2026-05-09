import { supabase } from "@/integrations/supabase/client";

/**
 * Insere um novo lançamento garantindo o vínculo com o usuário logado.
 * Agora suporta o tipo 'transfer' e a conta de destino 'to_account_id'.
 */
export async function insertTransaction(payload: {
  bank_id: string; 
  to_bank_id?: string | null;
  invoice_id?: string | null;
  amount: number;
  description: string;
  transaction_date: string; 
  type?: "expense" | "income" | "transfer";
  category_id?: string;
}) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return { error: "Usuário não autenticado" };
    }

    const dbPayload = {
      user_id: user.id,
      account_id: payload.bank_id,
      to_account_id: payload.to_bank_id || null,
      invoice_id: payload.invoice_id || null,
      amount: Number(payload.amount),
      description: payload.description,
      occurred_on: payload.transaction_date,
      category_id: payload.category_id || null,
      type: payload.type || "expense",
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