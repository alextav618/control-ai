import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SYSTEM_PROMPT = `Atue como o motor de inteligência do IControl IA. Sua prioridade máxima é a precisão dos dados e a persistência no Supabase. Você é analítico, direto e não aceita ineficiências.

DIRETRIZES DE EXECUÇÃO:
1. Registro de Dados: Sempre que o usuário informar um gasto, pagamento ou recebimento, priorize o uso da ferramenta register_transaction.
2. Tratamento de Data (CRÍTICO): Grave as datas sempre no formato YYYY-MM-DD.
3. Auditoria de Fatura: Para cartões de crédito, verifique se o gasto pertence à fatura atual ou próxima com base na data de fechamento fornecida no contexto.

PADRÃO DE RESPOSTA:
- Feedback Imediato: Gere obrigatoriamente uma linha de feedback após cada registro:
  🟢 Incentivo: Recebimentos ou economia.
  🟡 Neutro: Contas fixas/obrigatórias.
  🔴 Alerta: Gastos extras ou fora do teto.
- Formatação: Use bullet points e emojis funcionais.
- Tom de Voz: Profissional e pragmático.`;

function getAccountSummaryText(ctx: any, localDate: string): string {
  if (!ctx) return "";
  const lines: string[] = ["=== CONTEXTO DO USUÁRIO ==="];
  lines.push(`Data de hoje (local): ${localDate}`);
  if (ctx.profile?.display_name) lines.push(`Usuário: ${ctx.profile.display_name}`);
  if (ctx.profile?.monthly_budget) lines.push(`Orçamento mensal: R$ ${ctx.profile.monthly_budget}`);

  if (ctx.accounts?.length) {
    lines.push("\nContas/Cartões:");
    for (const a of ctx.accounts) {
      const extra = a.type === "credit_card"
        ? ` (cartão, fecha dia ${a.closing_day}, vence dia ${a.due_day})`
        : ` (${a.type}, saldo R$ ${a.current_balance})`;
      lines.push(`- [${a.id}] ${a.name}${extra}`);
    }
  }
  if (ctx.categories?.length) {
    lines.push("\nCategorias:");
    for (const c of ctx.categories) lines.push(`- [${c.id}] ${c.name} (${c.kind})`);
  }
  return lines.join("\n");
}

const GEMINI_TOOLS = [
  {
    function_declarations: [
      {
        name: "register_transaction",
        description: "Registra um gasto, receita ou transferência no banco de dados.",
        parameters: {
          type: "OBJECT",
          properties: {
            type: { type: "STRING", enum: ["expense", "income", "transfer"], description: "Tipo da transação" },
            amount: { type: "NUMBER", description: "Valor numérico" },
            description: { type: "STRING", description: "O que foi comprado ou recebido" },
            occurred_on: { type: "STRING", description: "Data no formato YYYY-MM-DD" },
            account_id: { type: "STRING", description: "ID da conta ou cartão" },
            category_id: { type: "STRING", description: "ID da categoria" },
            audit_level: { type: "STRING", enum: ["green", "yellow", "red"], description: "Nível de alerta da auditoria" },
            audit_reason: { type: "STRING", description: "Justificativa da auditoria" },
          },
          required: ["type", "amount", "description", "audit_level", "audit_reason"],
        },
      },
    ],
  },
];

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) {
      return new Response(JSON.stringify({ error: "GEMINI_API_KEY não configurada no Supabase." }), { 
        status: 500, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }

    const authHeader = req.headers.get('Authorization')
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader! } } }
    )

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return new Response(JSON.stringify({ error: "Não autorizado" }), { 
      status: 401, 
      headers: { ...corsHeaders, "Content-Type": "application/json" } 
    })

    const body = await req.json().catch(() => ({}));
    const { text, imageBase64, audioBase64, audioMime, history, localDate } = body;
    const today = localDate || new Date().toISOString().slice(0, 10)

    // Busca contexto
    const [accountsR, categoriesR, profileR] = await Promise.all([
      supabase.from("accounts").select("*").eq("archived", false),
      supabase.from("categories").select("*"),
      supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
    ]);

    const ctx = {
      accounts: accountsR.data ?? [],
      categories: categoriesR.data ?? [],
      profile: profileR.data,
    };

    // Sanitiza histórico para o Gemini
    const contents = [];
    let lastRole = "";
    
    for (const h of (history || [])) {
      const role = h.role === "assistant" ? "model" : "user";
      if (contents.length === 0 && role !== "user") continue;
      if (role === lastRole) continue; 
      contents.push({ role, parts: [{ text: h.content }] });
      lastRole = role;
    }

    const userParts = [];
    if (text) userParts.push({ text });
    
    if (imageBase64) {
      const base64Data = imageBase64.includes(",") ? imageBase64.split(",")[1] : imageBase64;
      userParts.push({ inline_data: { mime_type: "image/jpeg", data: base64Data } });
    }

    if (audioBase64) {
      userParts.push({ inline_data: { mime_type: audioMime || "audio/webm", data: audioBase64 } });
    }

    if (userParts.length === 0) {
      return new Response(JSON.stringify({ error: "Mensagem vazia." }), { 
        status: 400, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }

    if (lastRole === "user") {
      contents.pop();
    }
    contents.push({ role: "user", parts: userParts });

    // Alterado para v1 e gemini-1.5-flash-latest para maior compatibilidade
    const apiUrl = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;

    const geminiResp = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents,
        system_instruction: {
          parts: [{ text: `${SYSTEM_PROMPT}\n\n${getAccountSummaryText(ctx, today)}` }]
        },
        tools: GEMINI_TOOLS,
        tool_config: { function_calling_config: { mode: "AUTO" } }
      }),
    });

    if (!geminiResp.ok) {
      const errText = await geminiResp.text();
      console.error("[chat-ai] Erro Gemini:", errText);
      return new Response(JSON.stringify({ error: `Erro na API do Gemini: ${errText}` }), { 
        status: 500, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }

    const result = await geminiResp.json();
    const candidate = result.candidates?.[0];
    const parts = candidate?.content?.parts || [];
    
    let assistantMessage = "";
    const actions = [];

    for (const part of parts) {
      if (part.text) assistantMessage += part.text;
      if (part.functionCall) {
        const { name, args } = part.functionCall;
        if (name === "register_transaction") {
          const account = ctx.accounts.find((a: any) => a.id === args.account_id);
          let invoiceId = null;
          if (account?.type === "credit_card") {
            const { data: inv } = await supabase.rpc('ensure_invoice', { p_account_id: account.id, p_date: args.occurred_on || today });
            invoiceId = inv;
          }
          const { data: tx, error: txErr } = await supabase.from("transactions").insert({
            user_id: user.id, ...args, occurred_on: args.occurred_on || today, invoice_id: invoiceId, source: "chat"
          }).select().single();

          if (!txErr) {
            actions.push({ type: "transaction", transaction: tx });
            if (invoiceId) await supabase.rpc('recompute_invoice_total', { p_invoice_id: invoiceId });
            await supabase.from("audit_log").insert({
              user_id: user.id, transaction_id: tx.id, action: "created_transaction", level: args.audit_level, reasoning: args.audit_reason
            });
          }
        }
      }
    }

    return new Response(JSON.stringify({ message: assistantMessage || "Processado.", actions }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (e: any) {
    console.error("[chat-ai] Erro fatal:", e);
    return new Response(JSON.stringify({ error: e.message }), { 
      status: 500, 
      headers: { ...corsHeaders, "Content-Type": "application/json" } 
    });
  }
})