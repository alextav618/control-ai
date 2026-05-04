// Edge function: transfer_funds RPC
// Handles fund transfers between banks with validation and error handling

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
    const { fromBankId, toBankId, amount, description } = body;

    // Basic validation
    if (!fromBankId || !toBankId || amount <= 0 || fromBankId === toBankId) {
      return new Response(JSON.stringify({ error: "Invalid transfer parameters" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Check if banks exist
    const fromBank = await supabase.from("banks").select("id, balance").eq("id", fromBankId).single();
    const toBank = await supabase.from("banks").select("id, balance").eq("id", toBankId).single();

    if (!fromBank || !toBank) {
      return new Response(JSON.stringify({ error: "One or both banks not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Check sufficient balance
    if (fromBank.balance < amount) {
      return new Response(JSON.stringify({ error: "Insufficient funds in source bank" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Execute transfer
    const { data: result, error: transferErr } = await supabase.from("bank_transfers").insert({
      user_id: userId,
      from_bank_id: fromBankId,
      to_bank_id: toBankId,
      amount: amount,
      description: description || "Transfer",
      status: "completed",
      created_at: new Date().toISOString(),
    }).select().single();

    if (transferErr) {
      return new Response(JSON.stringify({ error: "Transfer failed" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Update bank balances
    await supabase.from("banks").update({
      balance: fromBank.balance - amount
    }).eq("id", fromBankId);

    await supabase.from("banks").update({
      balance: toBank.balance + amount
    }).eq("id", toBankId);

    return new Response(JSON.stringify({ success: true, transferId: result.id }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("transfer_funds error", e);
    return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});