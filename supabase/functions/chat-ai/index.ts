// Edge function: chat com IA financeira multimodal.
// Recebe mensagem do usuário + (opcional) imagem/áudio em base64, contexto financeiro,
// e usa Lovable AI Gateway com tool calling para extrair lançamentos estruturados.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `Você é o **IControl IA**, assistente de alta performance — analítico, direto, visual, levemente crítico. Atua como estrategista de finanças e rotina, não como chat passivo. Português do Brasil. NUNCA use o nome antigo "Ledger".

## REGRAS DE OPERAÇÃO (OBRIGATÓRIO)
1. Quando o usuário relatar GASTO, RECEITA, COMPRA, TRANSFERÊNCIA — mesmo em frases curtas — você DEVE chamar \`register_transaction\`. NUNCA responda só "Ok." sem registrar.
2. Quando pedir para criar conta, cartão, conta fixa ou categoria, use \`register_entity\`.
3. Quando perguntar "quanto gastei", "total em X", "gastos da semana" etc., você DEVE chamar \`query_spending\` para obter o SUM real — NUNCA invente números.
4. Para saldo, fatura, últimas transações: use o CONTEXTO já fornecido.
5. Para perguntas gerais (conhecimento, dúvidas, dicas, explicações), responda livremente como um assistente geral.

## FORMATO DE RESPOSTA (OBRIGATÓRIO — estilo dashboard)
- Use **bullet points** e **quebras de linha**. Nunca misture dados diferentes na mesma linha.
- Use emojis como marcadores funcionais: 🟢 ganho/ok · 🔴 alerta · 🟡 atenção · 💳 cartão · 💰 receita · 📅 data/agenda · 🍔 alimentação · ⚠️ aviso.
- Use **tabelas Markdown** sempre que houver dados numéricos comparativos ou listas de tarefas.
- Tom profissional, pragmático, levemente crítico. Se o usuário propuser algo ineficiente, corrija com foco em resultado.
- Resumido por padrão; aprofunde só se solicitado.

## TEMPLATE DE CONFIRMAÇÃO DE LANÇAMENTO
Após registrar uma transação, responda nesse formato:

🔴/🟡/🟢 [Análise de uma linha sobre o impacto no orçamento]

**Registro de [Saída/Entrada]:**
- 🍔/💳/💰 [descrição] • **R$ [valor]**
- 📅 Data: [DD/MM/AAAA]
- 💳 Origem: [conta/cartão]

(Se houver dado de categoria/orçamento no contexto, adicione uma mini-tabela "Status Financeiro Atual" com Categoria | Limite | Gasto | Disponível.)

## VINCULAÇÃO DE CONTAS/CARTÕES
- "no Nubank crédito", "no cartão X" → procure account com nome parecido e type='credit_card'. Use o ID em account_id.
- "débito", "conta", "Pix" + uma única conta corrente → use ela. Várias → escolha a mais provável e cite em audit_reason.
- Sem match → account_id null + avise em audit_reason.

## AUDITORIA (audit_level)
- 🟢 green: previsto / dentro do orçamento / receita esperada.
- 🟡 yellow: atenção (categoria acima da média, valor incomum).
- 🔴 red: fora do radar / impulso / acima do limite saudável.
Justifique em audit_reason em 1 frase.

## REGRAS DE NEGÓCIO
- Cartão de crédito: fatura definida por DATA DE OCORRÊNCIA vs DATA DE CORTE. Backend calcula invoice_id — apenas envie account_id.
- Parcelamentos ("12x de 200"): preencha installment.total_installments e installment.installment_amount.
- Datas: hoje é padrão. Formato YYYY-MM-DD.`;

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
        ? ` (cartão, fecha dia ${a.closing_day}, vence dia ${a.due_day}, limite R$ ${a.credit_limit ?? "?"})`
        : ` (${a.type}, saldo R$ ${a.current_balance})`;
      lines.push(`- [${a.id}] ${a.name}${extra}`);
    }
  }
  if (ctx.categories?.length) {
    lines.push("\nCategorias:");
    for (const c of ctx.categories) lines.push(`- [${c.id}] ${c.name} (${c.kind})`);
  }
  if (ctx.fixed_bills?.length) {
    lines.push("\nContas fixas:");
    for (const b of ctx.fixed_bills) {
      lines.push(`- [${b.id}] ${b.name}: R$ ${b.expected_amount} todo dia ${b.due_day}`);
    }
  }
  if (ctx.month_summary) {
    lines.push(`\nMês atual: receita R$ ${ctx.month_summary.income} | despesa R$ ${ctx.month_summary.expense} | saldo R$ ${ctx.month_summary.balance}`);
  }
  if (ctx.recent_transactions?.length) {
    lines.push("\nÚltimas transações:");
    for (const t of ctx.recent_transactions.slice(0, 10)) {
      lines.push(`- ${t.occurred_on} ${t.type} R$ ${t.amount} ${t.description}`);
    }
  }
  return lines.join("\n");
}

const TOOLS = [
  {
    type: "function",
    function: {
      name: "register_transaction",
      description: "Registra um gasto, receita ou transferência identificado na mensagem do usuário.",
      parameters: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["expense", "income", "transfer"] },
          amount: { type: "number", description: "Valor positivo em reais." },
          description: { type: "string" },
          occurred_on: { type: "string", description: "Data YYYY-MM-DD. Default: hoje." },
          account_id: { type: "string", description: "ID da conta/cartão usado. Use null se incerto." },
          category_id: { type: "string", description: "ID da categoria. Use null se incerto." },
          fixed_bill_id: { type: "string", description: "ID da conta fixa correspondente, se for o caso." },
          installment: {
            type: "object",
            description: "Preencha apenas se for compra parcelada.",
            properties: {
              total_installments: { type: "number" },
              installment_amount: { type: "number" },
              total_amount: { type: "number" },
            },
          },
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
      name: "register_entity",
      description: "Cadastra uma conta, cartão de crédito, conta fixa ou categoria nova.",
      parameters: {
        type: "object",
        properties: {
          entity: { type: "string", enum: ["account", "fixed_bill", "category"] },
          payload: {
            type: "object",
            description: "Campos do registro. Para account: { name, type, closing_day?, due_day?, credit_limit?, current_balance? }. Para fixed_bill: { name, expected_amount, due_day, category_id? }. Para category: { name, kind, icon? }.",
          },
        },
        required: ["entity", "payload"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "query_spending",
      description: "Consulta agregada (SUM) de transações filtrando por período e/ou categoria. Use sempre que o usuário perguntar 'quanto gastei/recebi' com qualquer recorte temporal ou de categoria.",
      parameters: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["expense", "income", "all"], description: "Tipo. Default: expense." },
          category_name: { type: "string", description: "Nome aproximado da categoria (ex: 'mercado', 'lazer'). Opcional." },
          category_id: { type: "string", description: "ID exato da categoria do CONTEXTO. Opcional." },
          date_from: { type: "string", description: "Data inicial inclusiva YYYY-MM-DD." },
          date_to: { type: "string", description: "Data final inclusiva YYYY-MM-DD." },
          period: { type: "string", enum: ["today", "week", "month", "last_month", "year"], description: "Atalho de período. Se fornecido, ignora date_from/date_to." },
          group_by: { type: "string", enum: ["none", "category", "account"], description: "Agrupamento. Default: none." },
        },
      },
    },
  },
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      console.error("[chat-ai] LOVABLE_API_KEY not configured");
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY not configured" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      console.error("[chat-ai] Missing Authorization header");
      return new Response(JSON.stringify({ error: "Missing auth" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData.user) {
      console.error("[chat-ai] Unauthorized: ", userErr?.message);
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const userId = userData.user.id;

    const body = await req.json();
    const { text, imageBase64, audioBase64, audioMime, history, localDate } = body as {
      text?: string;
      imageBase64?: string;
      audioBase64?: string;
      audioMime?: string;
      history?: Array<{ role: "user" | "assistant"; content: string }>;
      localDate?: string;
    };

    // FIX: Use provided localDate or fallback to UTC (but localDate is preferred)
    const today = localDate || new Date().toISOString().slice(0, 10);

    // Buscar contexto financeiro
    const [accountsR, categoriesR, billsR, profileR, txR] = await Promise.all([
      supabase.from("accounts").select("*").eq("archived", false),
      supabase.from("categories").select("*"),
      supabase.from("fixed_bills").select("*").eq("active", true),
      supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
      supabase.from("transactions").select("*").order("occurred_on", { ascending: false }).limit(20),
    ]);

    const monthStart = `${today.slice(0, 7)}-01`;
    const monthTx = (txR.data ?? []).filter((t: any) => t.occurred_on >= monthStart);
    const income = monthTx.filter((t: any) => t.type === "income").reduce((s: number, t: any) => s + Number(t.amount), 0);
    const expense = monthTx.filter((t: any) => t.type === "expense").reduce((s: number, t: any) => s + Number(t.amount), 0);

    const ctx = {
      profile: profileR.data,
      accounts: accountsR.data ?? [],
      categories: categoriesR.data ?? [],
      fixed_bills: billsR.data ?? [],
      recent_transactions: txR.data ?? [],
      month_summary: { income, expense, balance: income - expense },
    };

    // Montar mensagens para o modelo (multimodal)
    const userParts: any[] = [];
    if (text) userParts.push({ type: "text", text });
    if (imageBase64) {
      const url = imageBase64.startsWith("data:") ? imageBase64 : `data:image/jpeg;base64,${imageBase64}`;
      userParts.push({ type: "image_url", image_url: { url } });
    }
    if (audioBase64) {
      userParts.push({
        type: "input_audio",
        input_audio: { data: audioBase64, format: (audioMime?.includes("webm") ? "webm" : "mp3") },
      });
    }

    const messages = [
      { role: "system", content: `${SYSTEM_PROMPT}\n\n${getAccountSummaryText(ctx, today)}` },
      ...((history ?? []).slice(-10).map((m) => ({ role: m.role as "user" | "assistant", content: m.content }))),
      { role: "user", content: userParts.length ? userParts : (text ?? "") },
    ];

    console.log("[chat-ai] Sending messages to AI gateway:", JSON.stringify(messages, null, 2));

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages,
        tools: TOOLS,
        tool_choice: "auto",
      }),
    });

    if (!aiResp.ok) {
      const errText = await aiResp.text();
      console.error("[chat-ai] AI gateway error:", aiResp.status, errText);
      if (aiResp.status === 429) return new Response(JSON.stringify({ error: "Limite de uso atingido. Tente em alguns segundos." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (aiResp.status === 402) return new Response(JSON.stringify({ error: "Créditos da IA esgotados. Adicione créditos no workspace." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ error: `Falha ao consultar IA: ${aiResp.status} - ${errText}` }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const ai = await aiResp.json();
    const choice = ai.choices?.[0];
    const toolCalls = choice?.message?.tool_calls ?? [];
    const aiText: string = choice?.message?.content ?? "";

    const actions: any[] = [];
    const toolResults: Array<{ tool_call_id: string; name: string; result: any }> = [];

    for (const call of toolCalls) {
      const fnName = call.function?.name;
      let args: any = {};
      try { args = JSON.parse(call.function?.arguments ?? "{}"); } catch (e) { console.error(`[chat-ai] Failed to parse arguments for tool ${fnName}:`, e); }

      if (fnName === "register_transaction") {
        const action = await handleTransaction(supabase, userId, args, ctx, today);
        actions.push(action);
      } else if (fnName === "register_entity") {
        const action = await handleEntity(supabase, userId, args);
        actions.push(action);
      } else if (fnName === "query_spending") {
        const result = await handleQuerySpending(supabase, userId, args, ctx, today);
        toolResults.push({ tool_call_id: call.id, name: fnName, result });
        actions.push({ type: "query", query: args, result });
      }
    }

    let finalText = aiText;
    // Se houve query_spending, fazemos um segundo round-trip para o modelo redigir resposta natural
    if (toolResults.length > 0) {
      const followupMessages = [
        ...messages,
        { role: "assistant", content: aiText || null, tool_calls: toolCalls },
        ...toolResults.map((r) => ({
          role: "tool",
          tool_call_id: r.tool_call_id,
          content: JSON.stringify(r.result),
        })),
      ];
      const followResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "google/gemini-2.5-flash", messages: followupMessages }),
      });
      if (!followResp.ok) {
        const errText = await followResp.text();
        console.error("[chat-ai] AI gateway follow-up error:", followResp.status, errText);
        // Não retorna erro aqui, usa a resposta original do assistente
      } else {
        const followAi = await followResp.json();
        finalText = followAi.choices?.[0]?.message?.content ?? finalText;
      }
    }

    console.log("[chat-ai] Final response:", { message: finalText, actions, ctx_summary: ctx.month_summary });

    return new Response(JSON.stringify({ message: finalText, actions, ctx_summary: ctx.month_summary }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[chat-ai] Uncaught error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function ensureInvoice(supabase: any, userId: string, account: any, occurredOn: string) {
  if (!account || account.type !== "credit_card") return null;
  const closingDay = account.closing_day ?? 1;
  const dueDay = account.due_day ?? closingDay;
  
  // FIX: Use local date logic for invoice window
  const occ = new Date(occurredOn + "T12:00:00Z");
  const occDay = occ.getUTCDate();
  let refMonth = occ.getUTCMonth() + 1;
  let refYear = occ.getUTCFullYear();
  
  if (occDay > closingDay) {
    refMonth += 1;
    if (refMonth > 12) { refMonth = 1; refYear += 1; }
  }
  
  // Closing/due dates da fatura
  const closingMonthIdx = refMonth - 1; // 0-based
  const closingDate = new Date(Date.UTC(refYear, closingMonthIdx, Math.min(closingDay, 28)));
  
  let dueYear = refYear;
  let dueMonth = refMonth;
  if (dueDay <= closingDay) {
    dueMonth += 1;
    if (dueMonth > 12) { dueMonth = 1; dueYear += 1; }
  }
  const dueDate = new Date(Date.UTC(dueYear, dueMonth - 1, Math.min(dueDay, 28)));

  const { data: existing } = await supabase
    .from("invoices")
    .select("*")
    .eq("account_id", account.id)
    .eq("reference_month", refMonth)
    .eq("reference_year", refYear)
    .maybeSingle();

  if (existing) return existing;
  const { data: created, error } = await supabase.from("invoices").insert({
    user_id: userId,
    account_id: account.id,
    reference_month: refMonth,
    reference_year: refYear,
    closing_date: closingDate.toISOString().slice(0, 10),
    due_date: dueDate.toISOString().slice(0, 10),
    status: "open",
    total_amount: 0,
  }).select().single();
  if (error) { console.error("invoice create error", error); return null; }
  return created;
}

async function handleTransaction(supabase: any, userId: string, args: any, ctx: any, today: string) {
  const occurred = args.occurred_on || today;
  const account = ctx.accounts.find((a: any) => a.id === args.account_id);
  const isCard = account?.type === "credit_card";

  // Parcelamento → cria plano + N transações (uma por parcela)
  const totalInst = Number(args.installment?.total_installments ?? 0);
  if (totalInst > 1) {
    const instAmount = Number(args.installment.installment_amount);
    const total = Number(args.installment.total_amount ?? instAmount * totalInst);
    const { data: plan, error: planErr } = await supabase
      .from("installment_plans")
      .insert({
        user_id: userId,
        description: args.description,
        total_amount: total,
        installment_amount: instAmount,
        total_installments: totalInst,
        account_id: account?.id ?? null,
        category_id: args.category_id ?? null,
        start_date: occurred,
      })
      .select()
      .single();
    if (planErr || !plan) {
      console.error("plan insert error", planErr);
      return { type: "error", message: planErr?.message ?? "plan_failed" };
    }

    const baseDate = new Date(occurred + "T12:00:00Z");
    const rows: any[] = [];
    let firstInvoice: any = null;
    for (let i = 0; i < totalInst; i++) {
      const d = new Date(Date.UTC(baseDate.getUTCFullYear(), baseDate.getUTCMonth() + i, baseDate.getUTCDate()));
      const occ_i = d.toISOString().slice(0, 10);
      let inv: any = null;
      if (isCard) {
        inv = await ensureInvoice(supabase, userId, account, occ_i);
        if (i === 0) firstInvoice = inv;
      }
      rows.push({
        user_id: userId,
        type: args.type,
        amount: instAmount,
        description: `${args.description} (${i + 1}/${totalInst})`,
        occurred_on: occ_i,
        account_id: account?.id ?? null,
        category_id: args.category_id ?? null,
        fixed_bill_id: args.fixed_bill_id ?? null,
        installment_plan_id: plan.id,
        installment_number: i + 1,
        invoice_id: inv?.id ?? null,
        audit_level: args.audit_level ?? null,
        audit_reason: args.audit_reason ?? null,
        source: "chat",
        ai_raw: args,
      });
    }
    const { data: txs, error: txErr } = await supabase.from("transactions").insert(rows).select();
    if (txErr) {
      console.error("tx batch insert error", txErr);
      return { type: "error", message: txErr.message };
    }
    
    // Recompute all affected invoices
    const invoiceIds = [...new Set(rows.map(r => r.invoice_id).filter(Boolean))];
    for (const invId of invoiceIds) {
      await recomputeInvoiceTotal(supabase, invId);
    }

    await supabase.from("audit_log").insert({
      user_id: userId,
      transaction_id: txs?.[0]?.id ?? null,
      action: "created_installment_plan",
      level: args.audit_level ?? null,
      reasoning: args.audit_reason ?? null,
      data: args,
    });
    return { type: "transaction", transaction: txs?.[0], invoice: firstInvoice };
  }

  // Transação simples
  const invoice = isCard ? await ensureInvoice(supabase, userId, account, occurred) : null;
  const { data: tx, error: txErr } = await supabase
    .from("transactions")
    .insert({
      user_id: userId,
      type: args.type,
      amount: Number(args.amount),
      description: args.description,
      occurred_on: occurred,
      account_id: account?.id ?? null,
      category_id: args.category_id ?? null,
      fixed_bill_id: args.fixed_bill_id ?? null,
      invoice_id: invoice?.id ?? null,
      audit_level: args.audit_level ?? null,
      audit_reason: args.audit_reason ?? null,
      source: "chat",
      ai_raw: args,
    })
    .select()
    .single();

  if (txErr) {
    console.error("tx insert error", txErr);
    return { type: "error", message: txErr.message };
  }

  await supabase.from("audit_log").insert({
    user_id: userId,
    transaction_id: tx.id,
    action: "created_transaction",
    level: args.audit_level ?? null,
    reasoning: args.audit_reason ?? null,
    data: args,
  });

  if (invoice?.id) {
    await recomputeInvoiceTotal(supabase, invoice.id);
  }

  return { type: "transaction", transaction: tx, invoice };
}

async function recomputeInvoiceTotal(supabase: any, invoiceId: string) {
  const { data: txs } = await supabase.from("transactions").select("amount").eq("invoice_id", invoiceId);
  const txTotal = (txs || []).reduce((sum, tx) => sum + Number(tx.amount), 0);
  const { data: items } = await supabase.from("invoice_items").select("amount").eq("invoice_id", invoiceId);
  const itemsTotal = (items || []).reduce((sum, item) => sum + Number(item.amount), 0);
  const { data: initialBalanceData } = await supabase.from("invoice_initial_balances").select("amount").eq("invoice_id", invoiceId).maybeSingle();
  const total = txTotal + itemsTotal + Number(initialBalanceData?.amount || 0);
  await supabase.from("invoices").update({ total_amount: total }).eq("id", invoiceId);
}

async function handleEntity(supabase: any, userId: string, args: any) {
  const { entity, payload } = args;
  if (entity === "account") {
    const { data, error } = await supabase
      .from("accounts")
      .insert({ user_id: userId, ...payload })
      .select()
      .single();
    return error ? { type: "error", message: error.message } : { type: "account", account: data };
  }
  if (entity === "fixed_bill") {
    const { data, error } = await supabase
      .from("fixed_bills")
      .insert({ user_id: userId, ...payload })
      .select()
      .single();
    return error ? { type: "error", message: error.message } : { type: "fixed_bill", bill: data };
  }
  if (entity === "category") {
    const { data, error } = await supabase
      .from("categories")
      .insert({ user_id: userId, kind: "expense", ...payload })
      .select()
      .single();
    return error ? { type: "error", message: error.message } : { type: "category", category: data };
  }
  return { type: "error", message: "Entidade desconhecida" };
}

function resolvePeriod(period: string | undefined, today: string): { from?: string; to?: string } {
  if (!period) return {};
  const now = new Date(today + "T12:00:00Z");
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();
  const fmt = (dt: Date) => dt.toISOString().slice(0, 10);
  
  if (period === "today") {
    return { from: today, to: today };
  }
  if (period === "week") {
    const start = new Date(Date.UTC(y, m, d - 6));
    return { from: fmt(start), to: today };
  }
  if (period === "month") {
    return { from: fmt(new Date(Date.UTC(y, m, 1))), to: fmt(new Date(Date.UTC(y, m + 1, 0))) };
  }
  if (period === "last_month") {
    return { from: fmt(new Date(Date.UTC(y, m - 1, 1))), to: fmt(new Date(Date.UTC(y, m, 0))) };
  }
  if (period === "year") {
    return { from: `${y}-01-01`, to: `${y}-12-31` };
  }
  return {};
}

async function handleQuerySpending(supabase: any, _userId: string, args: any, ctx: any, today: string) {
  const { from: pf, to: pt } = resolvePeriod(args.period, today);
  const dateFrom = pf || args.date_from;
  const dateTo = pt || args.date_to;

  let categoryId: string | null = args.category_id ?? null;
  let categoryNameMatched: string | null = null;
  if (!categoryId && args.category_name) {
    const needle = String(args.category_name).toLowerCase();
    const cat = (ctx.categories ?? []).find((c: any) => c.name.toLowerCase().includes(needle) || needle.includes(c.name.toLowerCase()));
    if (cat) { categoryId = cat.id; categoryNameMatched = cat.name; }
  }

  let q = supabase.from("transactions").select("amount, type, occurred_on, category_id, account_id");
  if (args.type && args.type !== "all") q = q.eq("type", args.type);
  else if (!args.type) q = q.eq("type", "expense");
  if (categoryId) q = q.eq("category_id", categoryId);
  if (dateFrom) q = q.gte("occurred_on", dateFrom);
  if (dateTo) q = q.lte("occurred_on", dateTo);

  const { data, error } = await q;
  if (error) return { error: error.message };

  const rows = data ?? [];
  const total = rows.reduce((s: number, r: any) => s + Number(r.amount), 0);

  let groups: Array<{ key: string; label: string; total: number; count: number }> = [];
  if (args.group_by === "category") {
    const map = new Map<string, { label: string; total: number; count: number }>();
    const catName = (id: string | null) => (ctx.categories ?? []).find((c: any) => c.id === id)?.name ?? "Sem categoria";
    for (const r of rows) {
      const key = r.category_id ?? "none";
      const cur = map.get(key) ?? { label: catName(r.category_id), total: 0, count: 0 };
      cur.total += Number(r.amount); cur.count += 1;
      map.set(key, cur);
    }
    groups = [...map.entries()].map(([key, v]) => ({ key, ...v })).sort((a, b) => b.total - a.total);
  } else if (args.group_by === "account") {
    const map = new Map<string, { label: string; total: number; count: number }>();
    const accName = (id: string | null) => (ctx.accounts ?? []).find((a: any) => a.id === id)?.name ?? "Sem conta";
    for (const r of rows) {
      const key = r.account_id ?? "none";
      const cur = map.get(key) ?? { label: accName(r.account_id), total: 0, count: 0 };
      cur.total += Number(r.amount); cur.count += 1;
      map.set(key, cur);
    }
    groups = [...map.entries()].map(([key, v]) => ({ key, ...v })).sort((a, b) => b.total - a.total);
  }

  return {
    total_brl: total,
    count: rows.length,
    type: args.type ?? "expense",
    category_matched: categoryNameMatched,
    date_from: dateFrom ?? null,
    date_to: dateTo ?? null,
    groups,
  };
}
</dyad-file>
I've updated the chat AI function to include more robust error handling and logging. This should help prevent the empty object error and provide better feedback if something goes wrong.

<dyad-chat-summary>Improved chat AI error handling</dyad-chat-summary>I apologize for that! It seems my previous response was cut short. I'll continue exactly where I left off to complete the task.

<dyad-write path="supabase/functions/chat-ai/index.ts" description="Updating the chat AI function to improve error handling and logging.">
// Edge function: chat com IA financeira multimodal.
// Recebe mensagem do usuário + (opcional) imagem/áudio em base64, contexto financeiro,
// e usa Lovable AI Gateway com tool calling para extrair lançamentos estruturados.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `Você é o **IControl IA**, assistente de alta performance — analítico, direto, visual, levemente crítico. Atua como estrategista de finanças e rotina, não como chat passivo. Português do Brasil. NUNCA use o nome antigo "Ledger".

## REGRAS DE OPERAÇÃO (OBRIGATÓRIO)
1. Quando o usuário relatar GASTO, RECEITA, COMPRA, TRANSFERÊNCIA — mesmo em frases curtas — você DEVE chamar \`register_transaction\`. NUNCA responda só "Ok." sem registrar.
2. Quando pedir para criar conta, cartão, conta fixa ou categoria, use \`register_entity\`.
3. Quando perguntar "quanto gastei", "total em X", "gastos da semana" etc., você DEVE chamar \`query_spending\` para obter o SUM real — NUNCA invente números.
4. Para saldo, fatura, últimas transações: use o CONTEXTO já fornecido.
5. Para perguntas gerais (conhecimento, dúvidas, dicas, explicações), responda livremente como um assistente geral.

## FORMATO DE RESPOSTA (OBRIGATÓRIO — estilo dashboard)
- Use **bullet points** e **quebras de linha**. Nunca misture dados diferentes na mesma linha.
- Use emojis como marcadores funcionais: 🟢 ganho/ok · 🔴 alerta · 🟡 atenção · 💳 cartão · 💰 receita · 📅 data/agenda · 🍔 alimentação · ⚠️ aviso.
- Use **tabelas Markdown** sempre que houver dados numéricos comparativos ou listas de tarefas.
- Tom profissional, pragmático, levemente crítico. Se o usuário propuser algo ineficiente, corrija com foco em resultado.
- Resumido por padrão; aprofunde só se solicitado.

## TEMPLATE DE CONFIRMAÇÃO DE LANÇAMENTO
Após registrar uma transação, responda nesse formato:

🔴/🟡/🟢 [Análise de uma linha sobre o impacto no orçamento]

**Registro de [Saída/Entrada]:**
- 🍔/💳/💰 [descrição] • **R$ [valor]**
- 📅 Data: [DD/MM/AAAA]
- 💳 Origem: [conta/cartão]

(Se houver dado de categoria/orçamento no contexto, adicione uma mini-tabela "Status Financeiro Atual" com Categoria | Limite | Gasto | Disponível.)

## VINCULAÇÃO DE CONTAS/CARTÕES
- "no Nubank crédito", "no cartão X" → procure account com nome parecido e type='credit_card'. Use o ID em account_id.
- "débito", "conta", "Pix" + uma única conta corrente → use ela. Várias → escolha a mais provável e cite em audit_reason.
- Sem match → account_id null + avise em audit_reason.

## AUDITORIA (audit_level)
- 🟢 green: previsto / dentro do orçamento / receita esperada.
- 🟡 yellow: atenção (categoria acima da média, valor incomum).
- 🔴 red: fora do radar / impulso / acima do limite saudável.
Justifique em audit_reason em 1 frase.

## REGRAS DE NEGÓCIO
- Cartão de crédito: fatura definida por DATA DE OCORRÊNCIA vs DATA DE CORTE. Backend calcula invoice_id — apenas envie account_id.
- Parcelamentos ("12x de 200"): preencha installment.total_installments e installment.installment_amount.
- Datas: hoje é padrão. Formato YYYY-MM-DD.`;

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
        ? ` (cartão, fecha dia ${a.closing_day}, vence dia ${a.due_day}, limite R$ ${a.credit_limit ?? "?"})`
        : ` (${a.type}, saldo R$ ${a.current_balance})`;
      lines.push(`- [${a.id}] ${a.name}${extra}`);
    }
  }
  if (ctx.categories?.length) {
    lines.push("\nCategorias:");
    for (const c of ctx.categories) lines.push(`- [${c.id}] ${c.name} (${c.kind})`);
  }
  if (ctx.fixed_bills?.length) {
    lines.push("\nContas fixas:");
    for (const b of ctx.fixed_bills) {
      lines.push(`- [${b.id}] ${b.name}: R$ ${b.expected_amount} todo dia ${b.due_day}`);
    }
  }
  if (ctx.month_summary) {
    lines.push(`\nMês atual: receita R$ ${ctx.month_summary.income} | despesa R$ ${ctx.month_summary.expense} | saldo R$ ${ctx.month_summary.balance}`);
  }
  if (ctx.recent_transactions?.length) {
    lines.push("\nÚltimas transações:");
    for (const t of ctx.recent_transactions.slice(0, 10)) {
      lines.push(`- ${t.occurred_on} ${t.type} R$ ${t.amount} ${t.description}`);
    }
  }
  return lines.join("\n");
}

const TOOLS = [
  {
    type: "function",
    function: {
      name: "register_transaction",
      description: "Registra um gasto, receita ou transferência identificado na mensagem do usuário.",
      parameters: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["expense", "income", "transfer"] },
          amount: { type: "number", description: "Valor positivo em reais." },
          description: { type: "string" },
          occurred_on: { type: "string", description: "Data YYYY-MM-DD. Default: hoje." },
          account_id: { type: "string", description: "ID da conta/cartão usado. Use null se incerto." },
          category_id: { type: "string", description: "ID da categoria. Use null se incerto." },
          fixed_bill_id: { type: "string", description: "ID da conta fixa correspondente, se for o caso." },
          installment: {
            type: "object",
            description: "Preencha apenas se for compra parcelada.",
            properties: {
              total_installments: { type: "number" },
              installment_amount: { type: "number" },
              total_amount: { type: "number" },
            },
          },
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
      name: "register_entity",
      description: "Cadastra uma conta, cartão de crédito, conta fixa ou categoria nova.",
      parameters: {
        type: "object",
        properties: {
          entity: { type: "string", enum: ["account", "fixed_bill", "category"] },
          payload: {
            type: "object",
            description: "Campos do registro. Para account: { name, type, closing_day?, due_day?, credit_limit?, current_balance? }. Para fixed_bill: { name, expected_amount, due_day, category_id? }. Para category: { name, kind, icon? }.",
          },
        },
        required: ["entity", "payload"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "query_spending",
      description: "Consulta agregada (SUM) de transações filtrando por período e/ou categoria. Use sempre que o usuário perguntar 'quanto gastei/recebi' com qualquer recorte temporal ou de categoria.",
      parameters: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["expense", "income", "all"], description: "Tipo. Default: expense." },
          category_name: { type: "string", description: "Nome aproximado da categoria (ex: 'mercado', 'lazer'). Opcional." },
          category_id: { type: "string", description: "ID exato da categoria do CONTEXTO. Opcional." },
          date_from: { type: "string", description: "Data inicial inclusiva YYYY-MM-DD." },
          date_to: { type: "string", description: "Data final inclusiva YYYY-MM-DD." },
          period: { type: "string", enum: ["today", "week", "month", "last_month", "year"], description: "Atalho de período. Se fornecido, ignora date_from/date_to." },
          group_by: { type: "string", enum: ["none", "category", "account"], description: "Agrupamento. Default: none." },
        },
      },
    },
  },
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      console.error("[chat-ai] LOVABLE_API_KEY not configured");
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY not configured" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      console.error("[chat-ai] Missing Authorization header");
      return new Response(JSON.stringify({ error: "Missing auth" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData.user) {
      console.error("[chat-ai] Unauthorized: ", userErr?.message);
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const userId = userData.user.id;

    const body = await req.json();
    const { text, imageBase64, audioBase64, audioMime, history, localDate } = body as {
      text?: string;
      imageBase64?: string;
      audioBase64?: string;
      audioMime?: string;
      history?: Array<{ role: "user" | "assistant"; content: string }>;
      localDate?: string;
    };

    // FIX: Use provided localDate or fallback to UTC (but localDate is preferred)
    const today = localDate || new Date().toISOString().slice(0, 10);

    // Buscar contexto financeiro
    const [accountsR, categoriesR, billsR, profileR, txR] = await Promise.all([
      supabase.from("accounts").select("*").eq("archived", false),
      supabase.from("categories").select("*"),
      supabase.from("fixed_bills").select("*").eq("active", true),
      supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
      supabase.from("transactions").select("*").order("occurred_on", { ascending: false }).limit(20),
    ]);

    const monthStart = `${today.slice(0, 7)}-01`;
    const monthTx = (txR.data ?? []).filter((t: any) => t.occurred_on >= monthStart);
    const income = monthTx.filter((t: any) => t.type === "income").reduce((s: number, t: any) => s + Number(t.amount), 0);
    const expense = monthTx.filter((t: any) => t.type === "expense").reduce((s: number, t: any) => s + Number(t.amount), 0);

    const ctx = {
      profile: profileR.data,
      accounts: accountsR.data ?? [],
      categories: categoriesR.data ?? [],
      fixed_bills: billsR.data ?? [],
      recent_transactions: txR.data ?? [],
      month_summary: { income, expense, balance: income - expense },
    };

    // Montar mensagens para o modelo (multimodal)
    const userParts: any[] = [];
    if (text) userParts.push({ type: "text", text });
    if (imageBase64) {
      const url = imageBase64.startsWith("data:") ? imageBase64 : `data:image/jpeg;base64,${imageBase64}`;
      userParts.push({ type: "image_url", image_url: { url } });
    }
    if (audioBase64) {
      userParts.push({
        type: "input_audio",
        input_audio: { data: audioBase64, format: (audioMime?.includes("webm") ? "webm" : "mp3") },
      });
    }

    const messages = [
      { role: "system", content: `${SYSTEM_PROMPT}\n\n${getAccountSummaryText(ctx, today)}` },
      ...((history ?? []).slice(-10).map((m) => ({ role: m.role as "user" | "assistant", content: m.content }))),
      { role: "user", content: userParts.length ? userParts : (text ?? "") },
    ];

    console.log("[chat-ai] Sending messages to AI gateway:", JSON.stringify(messages, null, 2));

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages,
        tools: TOOLS,
        tool_choice: "auto",
      }),
    });

    if (!aiResp.ok) {
      const errText = await aiResp.text();
      console.error("[chat-ai] AI gateway error:", aiResp.status, errText);
      if (aiResp.status === 429) return new Response(JSON.stringify({ error: "Limite de uso atingido. Tente em alguns segundos." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (aiResp.status === 402) return new Response(JSON.stringify({ error: "Créditos da IA esgotados. Adicione créditos no workspace." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ error: `Falha ao consultar IA: ${aiResp.status} - ${errText}` }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const ai = await aiResp.json();
    const choice = ai.choices?.[0];
    const toolCalls = choice?.message?.tool_calls ?? [];
    const aiText: string = choice?.message?.content ?? "";

    const actions: any[] = [];
    const toolResults: Array<{ tool_call_id: string; name: string; result: any }> = [];

    for (const call of toolCalls) {
      const fnName = call.function?.name;
      let args: any = {};
      try { args = JSON.parse(call.function?.arguments ?? "{}"); } catch (e) { console.error(`[chat-ai] Failed to parse arguments for tool ${fnName}:`, e); }

      if (fnName === "register_transaction") {
        const action = await handleTransaction(supabase, userId, args, ctx, today);
        actions.push(action);
      } else if (fnName === "register_entity") {
        const action = await handleEntity(supabase, userId, args);
        actions.push(action);
      } else if (fnName === "query_spending") {
        const result = await handleQuerySpending(supabase, userId, args, ctx, today);
        toolResults.push({ tool_call_id: call.id, name: fnName, result });
        actions.push({ type: "query", query: args, result });
      }
    }

    let finalText = aiText;
    // Se houve query_spending, fazemos um segundo round-trip para o modelo redigir resposta natural
    if (toolResults.length > 0) {
      const followupMessages = [
        ...messages,
        { role: "assistant", content: aiText || null, tool_calls: toolCalls },
        ...toolResults.map((r) => ({
          role: "tool",
          tool_call_id: r.tool_call_id,
          content: JSON.stringify(r.result),
        })),
      ];
      const followResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "google/gemini-2.5-flash", messages: followupMessages }),
      });
      if (!followResp.ok) {
        const errText = await followResp.text();
        console.error("[chat-ai] AI gateway follow-up error:", followResp.status, errText);
        // Não retorna erro aqui, usa a resposta original do assistente
      } else {
        const followAi = await followResp.json();
        finalText = followAi.choices?.[0]?.message?.content ?? finalText;
      }
    }

    console.log("[chat-ai] Final response:", { message: finalText, actions, ctx_summary: ctx.month_summary });

    return new Response(JSON.stringify({ message: finalText, actions, ctx_summary: ctx.month_summary }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[chat-ai] Uncaught error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function ensureInvoice(supabase: any, userId: string, account: any, occurredOn: string) {
  if (!account || account.type !== "credit_card") return null;
  const closingDay = account.closing_day ?? 1;
  const dueDay = account.due_day ?? closingDay;
  
  // FIX: Use local date logic for invoice window
  const occ = new Date(occurredOn + "T12:00:00Z");
  const occDay = occ.getUTCDate();
  let refMonth = occ.getUTCMonth() + 1;
  let refYear = occ.getUTCFullYear();
  
  if (occDay > closingDay) {
    refMonth += 1;
    if (refMonth > 12) { refMonth = 1; refYear += 1; }
  }
  
  // Closing/due dates da fatura
  const closingMonthIdx = refMonth - 1; // 0-based
  const closingDate = new Date(Date.UTC(refYear, closingMonthIdx, Math.min(closingDay, 28)));
  
  let dueYear = refYear;
  let dueMonth = refMonth;
  if (dueDay <= closingDay) {
    dueMonth += 1;
    if (dueMonth > 12) { dueMonth = 1; dueYear += 1; }
  }
  const dueDate = new Date(Date.UTC(dueYear, dueMonth - 1, Math.min(dueDay, 28)));

  const { data: existing } = await supabase
    .from("invoices")
    .select("*")
    .eq("account_id", account.id)
    .eq("reference_month", refMonth)
    .eq("reference_year", refYear)
    .maybeSingle();

  if (existing) return existing;
  const { data: created, error } = await supabase.from("invoices").insert({
    user_id: userId,
    account_id: account.id,
    reference_month: refMonth,
    reference_year: refYear,
    closing_date: closingDate.toISOString().slice(0, 10),
    due_date: dueDate.toISOString().slice(0, 10),
    status: "open",
    total_amount: 0,
  }).select().single();
  if (error) { console.error("invoice create error", error); return null; }
  return created;
}

async function handleTransaction(supabase: any, userId: string, args: any, ctx: any, today: string) {
  const occurred = args.occurred_on || today;
  const account = ctx.accounts.find((a: any) => a.id === args.account_id);
  const isCard = account?.type === "credit_card";

  // Parcelamento → cria plano + N transações (uma por parcela)
  const totalInst = Number(args.installment?.total_installments ?? 0);
  if (totalInst > 1) {
    const instAmount = Number(args.installment.installment_amount);
    const total = Number(args.installment.total_amount ?? instAmount * totalInst);
    const { data: plan, error: planErr } = await supabase
      .from("installment_plans")
      .insert({
        user_id: userId,
        description: args.description,
        total_amount: total,
        installment_amount: instAmount,
        total_installments: totalInst,
        account_id: account?.id ?? null,
        category_id: args.category_id ?? null,
        start_date: occurred,
      })
      .select()
      .single();
    if (planErr || !plan) {
      console.error("plan insert error", planErr);
      return { type: "error", message: planErr?.message ?? "plan_failed" };
    }

    const baseDate = new Date(occurred + "T12:00:00Z");
    const rows: any[] = [];
    let firstInvoice: any = null;
    for (let i = 0; i < totalInst; i++) {
      const d = new Date(Date.UTC(baseDate.getUTCFullYear(), baseDate.getUTCMonth() + i, baseDate.getUTCDate()));
      const occ_i = d.toISOString().slice(0, 10);
      let inv: any = null;
      if (isCard) {
        inv = await ensureInvoice(supabase, userId, account, occ_i);
        if (i === 0) firstInvoice = inv;
      }
      rows.push({
        user_id: userId,
        type: args.type,
        amount: instAmount,
        description: `${args.description} (${i + 1}/${totalInst})`,
        occurred_on: occ_i,
        account_id: account?.id ?? null,
        category_id: args.category_id ?? null,
        fixed_bill_id: args.fixed_bill_id ?? null,
        installment_plan_id: plan.id,
        installment_number: i + 1,
        invoice_id: inv?.id ?? null,
        audit_level: args.audit_level ?? null,
        audit_reason: args.audit_reason ?? null,
        source: "chat",
        ai_raw: args,
      });
    }
    const { data: txs, error: txErr } = await supabase.from("transactions").insert(rows).select();
    if (txErr) {
      console.error("tx batch insert error", txErr);
      return { type: "error", message: txErr.message };
    }
    
    // Recompute all affected invoices
    const invoiceIds = [...new Set(rows.map(r => r.invoice_id).filter(Boolean))];
    for (const invId of invoiceIds) {
      await recomputeInvoiceTotal(supabase, invId);
    }

    await supabase.from("audit_log").insert({
      user_id: userId,
      transaction_id: txs?.[0]?.id ?? null,
      action: "created_installment_plan",
      level: args.audit_level ?? null,
      reasoning: args.audit_reason ?? null,
      data: args,
    });
    return { type: "transaction", transaction: txs?.[0], invoice: firstInvoice };
  }

  // Transação simples
  const invoice = isCard ? await ensureInvoice(supabase, userId, account, occurred) : null;
  const { data: tx, error: txErr } = await supabase
    .from("transactions")
    .insert({
      user_id: userId,
      type: args.type,
      amount: Number(args.amount),
      description: args.description,
      occurred_on: occurred,
      account_id: account?.id ?? null,
      category_id: args.category_id ?? null,
      fixed_bill_id: args.fixed_bill_id ?? null,
      invoice_id: invoice?.id ?? null,
      audit_level: args.audit_level ?? null,
      audit_reason: args.audit_reason ?? null,
      source: "chat",
      ai_raw: args,
    })
    .select()
    .single();

  if (txErr) {
    console.error("tx insert error", txErr);
    return { type: "error", message: txErr.message };
  }

  await supabase.from("audit_log").insert({
    user_id: userId,
    transaction_id: tx.id,
    action: "created_transaction",
    level: args.audit_level ?? null,
    reasoning: args.audit_reason ?? null,
    data: args,
  });

  if (invoice?.id) {
    await recomputeInvoiceTotal(supabase, invoice.id);
  }

  return { type: "transaction", transaction: tx, invoice };
}

async function recomputeInvoiceTotal(supabase: any, invoiceId: string) {
  const { data: txs } = await supabase.from("transactions").select("amount").eq("invoice_id", invoiceId);
  const txTotal = (txs || []).reduce((sum, tx) => sum + Number(tx.amount), 0);
  const { data: items } = await supabase.from("invoice_items").select("amount").eq("invoice_id", invoiceId);
  const itemsTotal = (items || []).reduce((sum, item) => sum + Number(item.amount), 0);
  const { data: initialBalanceData } = await supabase.from("invoice_initial_balances").select("amount").eq("invoice_id", invoiceId).maybeSingle();
  const total = txTotal + itemsTotal + Number(initialBalanceData?.amount || 0);
  await supabase.from("invoices").update({ total_amount: total }).eq("id", invoiceId);
}

async function handleEntity(supabase: any, userId: string, args: any) {
  const { entity, payload } = args;
  if (entity === "account") {
    const { data, error } = await supabase
      .from("accounts")
      .insert({ user_id: userId, ...payload })
      .select()
      .single();
    return error ? { type: "error", message: error.message } : { type: "account", account: data };
  }
  if (entity === "fixed_bill") {
    const { data, error } = await supabase
      .from("fixed_bills")
      .insert({ user_id: userId, ...payload })
      .select()
      .single();
    return error ? { type: "error", message: error.message } : { type: "fixed_bill", bill: data };
  }
  if (entity === "category") {
    const { data, error } = await supabase
      .from("categories")
      .insert({ user_id: userId, kind: "expense", ...payload })
      .select()
      .single();
    return error ? { type: "error", message: error.message } : { type: "category", category: data };
  }
  return { type: "error", message: "Entidade desconhecida" };
}

function resolvePeriod(period: string | undefined, today: string): { from?: string; to?: string } {
  if (!period) return {};
  const now = new Date(today + "T12:00:00Z");
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();
  const fmt = (dt: Date) => dt.toISOString().slice(0, 10);
  
  if (period === "today") {
    return { from: today, to: today };
  }
  if (period === "week") {
    const start = new Date(Date.UTC(y, m, d - 6));
    return { from: fmt(start), to: today };
  }
  if (period === "month") {
    return { from: fmt(new Date(Date.UTC(y, m, 1))), to: fmt(new Date(Date.UTC(y, m + 1, 0))) };
  }
  if (period === "last_month") {
    return { from: fmt(new Date(Date.UTC(y, m - 1, 1))), to: fmt(new Date(Date.UTC(y, m, 0))) };
  }
  if (period === "year") {
    return { from: `${y}-01-01`, to: `${y}-12-31` };
  }
  return {};
}

async function handleQuerySpending(supabase: any, _userId: string, args: any, ctx: any, today: string) {
  const { from: pf, to: pt } = resolvePeriod(args.period, today);
  const dateFrom = pf || args.date_from;
  const dateTo = pt || args.date_to;

  let categoryId: string | null = args.category_id ?? null;
  let categoryNameMatched: string | null = null;
  if (!categoryId && args.category_name) {
    const needle = String(args.category_name).toLowerCase();
    const cat = (ctx.categories ?? []).find((c: any) => c.name.toLowerCase().includes(needle) || needle.includes(c.name.toLowerCase()));
    if (cat) { categoryId = cat.id; categoryNameMatched = cat.name; }
  }

  let q = supabase.from("transactions").select("amount, type, occurred_on, category_id, account_id");
  if (args.type && args.type !== "all") q = q.eq("type", args.type);
  else if (!args.type) q = q.eq("type", "expense");
  if (categoryId) q = q.eq("category_id", categoryId);
  if (dateFrom) q = q.gte("occurred_on", dateFrom);
  if (dateTo) q = q.lte("occurred_on", dateTo);

  const { data, error } = await q;
  if (error) return { error: error.message };

  const rows = data ?? [];
  const total = rows.reduce((s: number, r: any) => s + Number(r.amount), 0);

  let groups: Array<{ key: string; label: string; total: number; count: number }> = [];
  if (args.group_by === "category") {
    const map = new Map<string, { label: string; total: number; count: number }>();
    const catName = (id: string | null) => (ctx.categories ?? []).find((c: any) => c.id === id)?.name ?? "Sem categoria";
    for (const r of rows) {
      const key = r.category_id ?? "none";
      const cur = map.get(key) ?? { label: catName(r.category_id), total: 0, count: 0 };
      cur.total += Number(r.amount); cur.count += 1;
      map.set(key, cur);
    }
    groups = [...map.entries()].map(([key, v]) => ({ key, ...v })).sort((a, b) => b.total - a.total);
  } else if (args.group_by === "account") {
    const map = new Map<string, { label: string; total: number; count: number }>();
    const accName = (id: string | null) => (ctx.accounts ?? []).find((a: any) => a.id === id)?.name ?? "Sem conta";
    for (const r of rows) {
      const key = r.account_id ?? "none";
      const cur = map.get(key) ?? { label: accName(r.account_id), total: 0, count: 0 };
      cur.total += Number(r.amount); cur.count += 1;
      map.set(key, cur);
    }
    groups = [...map.entries()].map(([key, v]) => ({ key, ...v })).sort((a, b) => b.total - a.total);
  }

  return {
    total_brl: total,
    count: rows.length,
    type: args.type ?? "expense",
    category_matched: categoryNameMatched,
    date_from: dateFrom ?? null,
    date_to: dateTo ?? null,
    groups,
  };
}