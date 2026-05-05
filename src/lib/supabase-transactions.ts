import { supabase } from "@/integrations/supabase/client";

/**
 * Insere um novo lançamento na tabela transactions.
 * @param payload Dados do lançamento (mapeados para o esquema do banco)
 */
export async function insertTransaction(payload: {
  user_id: string;
  bank_id: string; // Mapeado para account_id no banco
  invoice_id?: string | null;
  amount: number;
  description: string;
  currency?: string; // Opcional (não existe coluna currency no esquema atual)
  transaction_date: string; // Mapeado para occurred_on no banco
  type?: "expense" | "income" | "transfer";
}) {
  try {
    // 1. Garantir que o cliente está autenticado e obter a sessão
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    
    if (sessionError || !session) {
      console.error("Erro de Autenticação:", sessionError);
      return { 
        error: "Usuário não autenticado", 
        details: "Não foi possível encontrar uma sessão ativa para realizar a operação." 
      };
    }

    // 2. Preparar o payload para o banco de dados (mapeando nomes de colunas)
    // Nota: Usamos account_id e occurred_on conforme definido no seu types.ts
    const dbPayload = {
      user_id: payload.user_id || session.user.id,
      account_id: payload.bank_id,
      invoice_id: payload.invoice_id || null,
      amount: Number(payload.amount),
      description: payload.description,
      occurred_on: payload.transaction_date,
      type: payload.type || "expense", // Valor padrão caso não informado
      source: "manual",
      status: "paid" as const
    };

    console.log("Tentando inserir lançamento no Supabase...", dbPayload);

    // 3. Executar o insert com .select() para retornar o registro
    const { data, error } = await supabase
      .from("transactions")
      .insert(dbPayload)
      .select()
      .single();

    // 4. Tratamento de erro detalhado
    if (error) {
      console.error("Erro Supabase:", error);
      return {
        error: error.message,
        details: error.details || "Falha na persistência dos dados no banco."
      };
    }

    // 5. Retornar o registro criado e logar sucesso
    console.log("Lançamento criado com sucesso:", data);
    return { data };

  } catch (err: any) {
    console.error("Erro inesperado na função insertTransaction:", err);
    return {
      error: "Erro interno",
      details: err.message
    };
  }
}