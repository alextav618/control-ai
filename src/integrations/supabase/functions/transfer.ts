import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const userId = userData.user.id;

    const body = await req.json();
    const { p_from_bank_id, p_to_bank_id, p_amount, p_description } = body;

    // Validação básica
    if (!p_from_bank_id || !p_to_bank_id || p_amount <= 0 || p_from_bank_id === p_to_bank_id) {
      return new Response(JSON.stringify({ error: "Parâmetros inválidos" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Verificação de existência das contas
    const fromBank = await supabase.from("banks").select("id, balance").eq("id", p_from_bank_id).single();
    const toBank = await supabase.from("banks").select("id, balance").eq("id", p_to_bank_id).single();

    if (!fromBank || !toBank) {
      return new Response(JSON.stringify({ error: "Uma ou ambas as contas não encontradas" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Verificação de saldo suficiente
    if (fromBank.balance < p_amount) {
      return new Response(JSON.stringify({ error: "Saldo insuficiente na conta de origem" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Execução da transferência
    const { data: result, error: transferErr } = await supabase.from("bank_transfers").insert({
      user_id: userId,
      from_bank_id: p_from_bank_id,
      to_bank_id: p_to_bank_id,
      amount: p_amount,
      description: p_description || "Transferência",
      status: "completed",
      created_at: new Date().toISOString(),
    }).select().single();

    if (transferErr) {
      return new Response(JSON.stringify({ error: "Falha na transferência" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Atualização dos saldos
    await supabase.from("banks").update({
      balance: fromBank.balance - p_amount
    }).eq("id", p_from_bank_id);

    await supabase.from("banks").update({
      balance: toBank.balance + p_amount
    }).eq("id", p_to_bank_id);

    return new Response(JSON.stringify({ success: true, transferId: result.id }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("transfer_funds error", e);
    return new Response(JSON.stringify({ error: "Erro interno do servidor" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});