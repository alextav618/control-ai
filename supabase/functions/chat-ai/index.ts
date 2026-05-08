// Edge function: chat com IA financeira multimodal.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `Atue como o motor de inteligência do IControl IA. Sua prioridade máxima é a precisão dos dados e a persistência no Supabase. Você é analítico, direto e não aceita ineficiências.

DIRETRIZES DE EXECUÇÃO:
1. Registro de Dados: Sempre que o usuário informar um gasto, pagamento ou recebimento, priorize o uso da ferramenta register_transaction.
2. Tratamento de Data (CRÍTICO): Grave as datas sempre no formato YYYY-MM-DD.
3. Auditoria de Fatura: Para cartões de crédito, verifique se o gasto pertence à fatura atual ou próxima com base na data de fechamento fornecida no contexto.

PADRÃO DE RESPOSTA (REGRA 30):
- Feedback Imediato: Gere obrigatoriamente uma linha de feedback após cada registro:
  🟢 Incentivo: Recebimentos ou economia.
  🟡 Neutro: Contas fixas/obrigatórias.
  🔴 Alerta: Gastos extras ou fora do teto.
- Formatação: Use bullet points, tabelas Markdown para números e emojis funcionais.
- Tom de Voz: Profissional, pragmático e levemente crítico.

MEMÓRIA E CONTEXTO:
- Antes de responder, verifique o estado atual do banco para não duplicar informações.
- Resuma por padrão; aprofunde apenas se solicitado. Foco total em resultado prático.`;

function getAccountSummaryText(ctx: any, localDate: string): string {
  if (!ctx) return "";
  const lines: string[] = [];
  lines.push("=== CONTEXTO DO USUÁRIO ===");
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
  if (ctx.month_summary) {
    lines.push(`\nMês atual: receita R$ ${ctx.month_summary.income} | despesa R$ ${ctx.month_summary.expense}`);
  }
  return lines.join("\n");
}

const TOOLS = [
  {
    type: "function",
    function: {
      name: "register_transaction",
      description: "Registra um gasto, receita ou transferência.",
      parameters: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["expense", "income", "transfer"] },
          amount: { type: "number" },
          description: { type: "string" },
          occurred_on: { type: "string" },
          account_id: { type: "string" },
          category_id: { type: "string" },
          audit_level: { type: "string", enum: ["green", "yellow", "red"] },
          audit_reason: { type: "string" },
        },
        required: ["type", "amount", "description", "audit_level", "audit_reason"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "query_spending",
      description: "Consulta total de gastos/receitas por período.",
      parameters: {
        type: { type: "string", enum: ["expense", "income", "all"] },
        period: { type: "string", enum: ["today", "week", "month", "last_month", "year"] },
      },
    },
  },
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not set");

    const authHeader = req.headers.get("Authorization");
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader! } }
    });

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return new Response("Unauthorized", { status: 401, headers: corsHeaders });

    const { text, history, localDate } = await req.json();
    const today = localDate || new Date().toISOString().slice(0, 10);

    const [accountsR, categoriesR, profileR, txR] = await Promise.all([
      supabase.from("accounts").select("*").eq("archived", false),
      supabase.from("categories").select("*"),
      supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
      supabase.from("transactions").select("*").gte("occurred_on", `${today.slice(0, 7)}-01`),
    ]);

    const income = (txR.data ?? []).filter(t => t.type === "income").reduce((s, t) => s + Number(t.amount), 0);
    const expense = (txR.data ?? []).filter(t => t.type === "expense").reduce((s, t) => s + Number(t.amount), 0);

    const ctx = {
      accounts: accountsR.data ?? [],
      categories: categoriesR.data ?? [],
      profile: profileR.data,
      month_summary: { income, expense }
    };

    const messages = [
      { role: "system", content: `${SYSTEM_PROMPT}\n\n${getAccountSummaryText(ctx, today)}` },
      ...(history || []).slice(-6),
      { role: "user", content: text }
    ];

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-4o-mini", messages, tools: TOOLS, tool_choice: "auto" }),
    });

    if (!aiResp.ok) throw new Error(`AI Error: ${aiResp.status}`);

    const ai = await aiResp.json();
    const toolCalls = ai.choices[0].message.tool_calls || [];
    const actions = [];

    for (const call of toolCalls) {
      const args = JSON.parse(call.function.arguments);
      if (call.function.name === "register_transaction") {
        const account = ctx.accounts.find(a => a.id === args.account_id);
        let invoiceId = null;
        
        if (account?.type === "credit_card") {
          const { data: inv } = await supabase.rpc('ensure_invoice', { 
            p_account_id: account.id, 
            p_date: args.occurred_on || today 
          });
          invoiceId = inv;
        }

        const { data: tx, error } = await supabase.from("transactions").insert({
          user_id: user.id,
          ...args,
          occurred_on: args.occurred_on || today,
          invoice_id: invoiceId,
          source: "chat"
        }).select().single();

        if (!error) {
          actions.push({ type: "transaction", transaction: tx });
          if (invoiceId) await supabase.rpc('recompute_invoice_total', { p_invoice_id: invoiceId });
          await supabase.from("audit_log").insert({
            user_id: user.id, transaction_id: tx.id, action: "created_transaction",
            level: args.audit_level, reasoning: args.audit_reason
          });
        }
      }
    }

    return new Response(JSON.stringify({ message: ai.choices[0].message.content, actions }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  } catch (e) {
    console.error("[chat-ai] Error:", e);
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
  }
});