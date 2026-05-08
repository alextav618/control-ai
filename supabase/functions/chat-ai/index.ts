import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SYSTEM_PROMPT = `Atue como o motor de inteligência do IControl IA. Sua prioridade máxima é a precisão dos dados. Você é analítico, direto e pragmático.

DIRETRIZES:
1. Data de Referência: Hoje é 08/05/2026. Todos os cálculos e transações devem respeitar esta data e o fuso horário local.
2. Tratamento de Data: Use sempre o formato YYYY-MM-DD.
3. Feedback: Gere uma linha de feedback com emojis (🟢, 🟡, 🔴) para cada análise.
4. Tom de Voz: Profissional.

REGRAS DE NEGÓCIO:
- Analise gastos contra o orçamento mensal.
- Identifique padrões de consumo.`;

function getAccountSummaryText(ctx: any, localDate: string): string {
  if (!ctx) return "";
  const lines: string[] = ["=== CONTEXTO ATUAL ==="];
  lines.push(`Data de hoje: ${localDate}`);
  if (ctx.profile?.display_name) lines.push(`Usuário: ${ctx.profile.display_name}`);
  if (ctx.profile?.monthly_budget) lines.push(`Orçamento: R$ ${ctx.profile.monthly_budget}`);

  if (ctx.accounts?.length) {
    lines.push("\nContas/Cartões:");
    for (const a of ctx.accounts) {
      const extra = a.type === "credit_card" ? " (Cartão)" : ` (Saldo: R$ ${a.current_balance})`;
      lines.push(`- ${a.name}${extra}`);
    }
  }
  return lines.join("\n");
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) {
      return new Response(JSON.stringify({ error: "Chave API não configurada." }), { 
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
    // Forçando a data solicitada pelo usuário
    const today = "2026-05-08";

    const [accountsR, profileR] = await Promise.all([
      supabase.from("accounts").select("*").eq("archived", false),
      supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
    ]);

    const ctxText = getAccountSummaryText({ accounts: accountsR.data, profile: profileR.data }, today);
    
    const contents = [];
    
    // 1. Injetando o Prompt Mestre como a primeira mensagem do usuário (v1beta compatibilidade)
    contents.push({
      role: "user",
      parts: [{ text: `${SYSTEM_PROMPT}\n\n${ctxText}\n\nEntendido? Responda apenas confirmando que está pronto.` }]
    });

    // Resposta simulada do modelo para manter a alternância de roles
    contents.push({
      role: "model",
      parts: [{ text: "Entendido. Estou pronto para atuar como o motor de inteligência do IControl IA com a data de referência 08/05/2026. Como posso ajudar hoje?" }]
    });

    // 2. Adicionando o histórico
    for (const h of (history || [])) {
      const role = h.role === "assistant" ? "model" : "user";
      contents.push({ role, parts: [{ text: h.content }] });
    }

    // 3. Adicionando a mensagem atual
    const currentParts = [];
    if (text) currentParts.push({ text });
    if (imageBase64) {
      const base64Data = imageBase64.includes(",") ? imageBase64.split(",")[1] : imageBase64;
      currentParts.push({ inline_data: { mime_type: "image/jpeg", data: base64Data } });
    }
    if (audioBase64) {
      currentParts.push({ inline_data: { mime_type: audioMime || "audio/webm", data: audioBase64 } });
    }

    contents.push({ role: "user", parts: currentParts });

    // Usando v1beta com gemini-1.5-flash como fallback estável
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;

    const geminiResp = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents }),
    });

    if (!geminiResp.ok) {
      const errText = await geminiResp.text();
      return new Response(JSON.stringify({ error: `Erro Gemini: ${errText}` }), { 
        status: 500, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      });
    }

    const result = await geminiResp.json();
    const assistantMessage = result.candidates?.[0]?.content?.parts?.[0]?.text || "Não consegui processar sua mensagem.";

    return new Response(JSON.stringify({ message: assistantMessage, actions: [] }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { 
      status: 500, 
      headers: { ...corsHeaders, "Content-Type": "application/json" } 
    });
  }
})