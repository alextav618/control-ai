// Edge function: chat com IA financeira multimodal.
// Recebe mensagem do usuário + (opcional) imagem/áudio em base64, contexto financeiro,
// e usa Lovable AI Gateway com tool calling para extrair lançamentos estruturados.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `Você é o "Ledger", um assistente financeiro pessoal de auditoria E também um assistente geral estilo Gemini. Fala português do Brasil, tom direto, profissional, sem emoji em excesso.

REGRAS DE OPERAÇÃO (OBRIGATÓRIO):
1. Sempre que o usuário relatar um GASTO, RECEITA, COMPRA ou TRANSFERÊNCIA — mesmo em frases curtas como "comprei X por Y", "gastei Z no cartão", "paguei a conta de luz" — você DEVE chamar a ferramenta \`register_transaction\`. NUNCA responda apenas "Ok." sem registrar quando há um lançamento implícito.
2. Quando o usuário pedir para criar uma conta nova, cartão, conta fixa ou categoria, use \`register_entity\`.
3. Quando o usuário PERGUNTAR "quanto gastei", "qual o total em X", "quanto foi com mercado em outubro", "gastos da semana", etc., você DEVE chamar \`query_spending\` para obter o SUM real do banco — NUNCA invente números. Após receber o resultado, responda em texto natural com o valor formatado em R$.
4. Para outras perguntas sobre finanças do usuário (saldo atual, fatura aberta, últimas transações), use o CONTEXTO já fornecido.
5. Para perguntas GERAIS (clima, conhecimento, dúvidas, conversa, dicas, explicações, "o que é X", "me ajuda com Y"), responda livremente usando seu conhecimento geral, como o Gemini faria. Você não é restrito a finanças.

VINCULAÇÃO DE CONTAS/CARTÕES:
- Se o usuário disser "no Nubank crédito", "no cartão X", procure no CONTEXTO um account com nome parecido e type='credit_card'. Use o ID dele em account_id.
- Se disser "débito", "conta", "Pix" e houver UMA conta corrente no contexto, use ela. Se houver várias, escolha a mais provável e mencione no audit_reason.
- Se NÃO houver match, deixe account_id null e avise no audit_reason ("conta não identificada — vincule depois").

AUDITORIA (campo audit_level):
- "green": gasto previsto / dentro do orçamento / receita esperada.
- "yellow": atenção (categoria recorrente acima da média, ou valor incomum).
- "red": gasto fora do radar / impulso / acima do limite saudável.
Sempre justifique em audit_reason em 1 frase curta.

REGRAS DE NEGÓCIO:
- Cartão de crédito (type='credit_card'): a fatura é definida pela DATA DE OCORRÊNCIA vs DATA DE CORTE da conta. Se occurred_on > closing_day do mês, a despesa entra na fatura do mês SEGUINTE.
- Você NÃO precisa calcular invoice_id — o backend faz isso. Apenas indique account_id.
- Para parcelamentos (ex: "comprei TV em 12x de 200"), preencha installment.total_installments e installment.installment_amount; o backend cria o plano e o primeiro lançamento.
- Datas: hoje é a data padrão se o usuário não disser outra. Use formato YYYY-MM-DD.

Após qualquer ação via ferramenta, responda em texto curto confirmando o que foi feito (ex: "Registrado: Mercado R$150 no Nubank crédito (fatura de Nov). 🟡 acima da média da categoria.").
Use 🟢 🟡 🔴 apenas no texto de confirmação, conforme o audit_level retornado.`;

function getAccountSummaryText(ctx: any): string {
  if (!ctx) return "";
  const lines: string[] = [];
  lines.push("=== CONTEXTO DO USUÁRIO ===");
  lines.push(`Data de hoje: ${new Date().toISOString().slice(0, 10)}`);
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
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY not configured" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing auth" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const userId = userData.user.id;

    const body = await req.json();
    const { text, imageBase64, audioBase64, audioMime, history } = body as {
      text?: string;
      imageBase64?: string; // data URL ou base64 puro
      audioBase64?: string;
      audioMime?: string;
      history?: Array<{ role: "user" | "assistant"; content: string }>;
    };

    // Buscar contexto financeiro
    const [accountsR, categoriesR, billsR, profileR, txR] = await Promise.all([
      supabase.from("accounts").select("*").eq("archived", false),
      supabase.from("categories").select("*"),
      supabase.from("fixed_bills").select("*").eq("active", true),
      supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
      supabase.from("transactions").select("*").order("occurred_on", { ascending: false }).limit(20),
    ]);

    const now = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
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
      // Gemini accepts audio via input_audio
      userParts.push({
        type: "input_audio",
        input_audio: { data: audioBase64, format: (audioMime?.includes("wav") ? "wav" : "mp3") },
      });
    }

    const messages = [
      { role: "system", content: `${SYSTEM_PROMPT}\n\n${getAccountSummaryText(ctx)}` },
      ...((history ?? []).slice(-10).map((m) => ({ role: m.role, content: m.content }))),
      { role: "user", content: userParts.length ? userParts : (text ?? "") },
    ];

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
      console.error("AI gateway error", aiResp.status, errText);
      if (aiResp.status === 429) return new Response(JSON.stringify({ error: "Limite de uso atingido. Tente em alguns segundos." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (aiResp.status === 402) return new Response(JSON.stringify({ error: "Créditos da IA esgotados. Adicione créditos no workspace." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ error: "Falha ao consultar IA" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const ai = await aiResp.json();
    const choice = ai.choices?.[0];
    const toolCalls = choice?.message?.tool_calls ?? [];
    const aiText: string = choice?.message?.content ?? "";

    const actions: any[] = [];

    for (const call of toolCalls) {
      const fnName = call.function?.name;
      let args: any = {};
      try { args = JSON.parse(call.function?.arguments ?? "{}"); } catch { /* ignore */ }

      if (fnName === "register_transaction") {
        const action = await handleTransaction(supabase, userId, args, ctx);
        actions.push(action);
      } else if (fnName === "register_entity") {
        const action = await handleEntity(supabase, userId, args);
        actions.push(action);
      }
    }

    return new Response(JSON.stringify({ message: aiText, actions, ctx_summary: ctx.month_summary }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("chat-ai error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "unknown" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function ensureInvoice(supabase: any, userId: string, account: any, occurredOn: string) {
  if (!account || account.type !== "credit_card") return null;
  const closingDay = account.closing_day ?? 1;
  const dueDay = account.due_day ?? closingDay;
  const occ = new Date(occurredOn + "T12:00:00Z");
  // Se occurred_on > closing_day → fatura do mês seguinte
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
  const dueDate = new Date(Date.UTC(refYear, closingMonthIdx, Math.min(dueDay, 28)));
  if (dueDay < closingDay) dueDate.setUTCMonth(dueDate.getUTCMonth() + 1);

  const { data: existing } = await supabase
    .from("invoices")
    .select("*")
    .eq("account_id", account.id)
    .eq("reference_year", refYear)
    .eq("reference_month", refMonth)
    .maybeSingle();

  if (existing) return existing;

  const { data: created, error } = await supabase
    .from("invoices")
    .insert({
      user_id: userId,
      account_id: account.id,
      reference_month: refMonth,
      reference_year: refYear,
      closing_date: closingDate.toISOString().slice(0, 10),
      due_date: dueDate.toISOString().slice(0, 10),
      status: "open",
    })
    .select()
    .single();
  if (error) { console.error("invoice create error", error); return null; }
  return created;
}

async function handleTransaction(supabase: any, userId: string, args: any, ctx: any) {
  const occurred = args.occurred_on || new Date().toISOString().slice(0, 10);
  const account = ctx.accounts.find((a: any) => a.id === args.account_id);
  let invoice = null;
  if (account?.type === "credit_card" && args.type === "expense") {
    invoice = await ensureInvoice(supabase, userId, account, occurred);
  }

  // Parcelamento
  let installmentPlanId: string | null = null;
  let installmentNumber: number | null = null;
  if (args.installment?.total_installments && args.installment.total_installments > 1) {
    const total = args.installment.total_amount ?? args.installment.installment_amount * args.installment.total_installments;
    const { data: plan, error: planErr } = await supabase
      .from("installment_plans")
      .insert({
        user_id: userId,
        description: args.description,
        total_amount: total,
        installment_amount: args.installment.installment_amount,
        total_installments: args.installment.total_installments,
        account_id: account?.id ?? null,
        category_id: args.category_id ?? null,
        start_date: occurred,
      })
      .select()
      .single();
    if (!planErr && plan) {
      installmentPlanId = plan.id;
      installmentNumber = 1;
    }
  }

  const insertAmount = installmentPlanId ? Number(args.installment.installment_amount) : Number(args.amount);

  const { data: tx, error: txErr } = await supabase
    .from("transactions")
    .insert({
      user_id: userId,
      type: args.type,
      amount: insertAmount,
      description: args.description,
      occurred_on: occurred,
      account_id: account?.id ?? null,
      category_id: args.category_id ?? null,
      fixed_bill_id: args.fixed_bill_id ?? null,
      installment_plan_id: installmentPlanId,
      installment_number: installmentNumber,
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

  return { type: "transaction", transaction: tx, invoice };
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
