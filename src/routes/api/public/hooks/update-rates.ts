import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// BCB SGS series:
// 4389 = CDI anualizado (% a.a.)
// 1178 = SELIC anualizada (% a.a.)
// 13522 = IPCA acumulado em 12 meses (%)
const SERIES: Record<string, number> = {
  cdi: 4389,
  selic: 1178,
  ipca: 13522,
};

async function fetchBcb(serie: number): Promise<{ value: number; date: string } | null> {
  try {
    const url = `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${serie}/dados/ultimos/1?formato=json`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    const arr = (await res.json()) as Array<{ data: string; valor: string }>;
    if (!arr?.length) return null;
    const last = arr[arr.length - 1];
    const [d, m, y] = last.data.split("/");
    return { value: Number(last.valor), date: `${y}-${m}-${d}` };
  } catch {
    return null;
  }
}

export const Route = createFileRoute("/api/public/hooks/update-rates")({
  server: {
    handlers: {
      POST: async () => {
        const results: Record<string, unknown> = {};
        for (const [code, serie] of Object.entries(SERIES)) {
          const r = await fetchBcb(serie);
          if (!r) {
            results[code] = "fetch_failed";
            continue;
          }
          const { error } = await supabaseAdmin.from("index_rates").upsert(
            {
              code,
              annual_rate: r.value,
              reference_date: r.date,
              source: "bcb",
              updated_at: new Date().toISOString(),
            },
            { onConflict: "code" },
          );
          results[code] = error ? `error: ${error.message}` : { rate: r.value, date: r.date };
        }
        return new Response(JSON.stringify({ ok: true, results }), {
          headers: { "Content-Type": "application/json" },
        });
      },
      GET: async () => {
        // permite trigger manual via browser
        const results: Record<string, unknown> = {};
        for (const [code, serie] of Object.entries(SERIES)) {
          const r = await fetchBcb(serie);
          if (!r) {
            results[code] = "fetch_failed";
            continue;
          }
          await supabaseAdmin.from("index_rates").upsert(
            {
              code,
              annual_rate: r.value,
              reference_date: r.date,
              source: "bcb",
              updated_at: new Date().toISOString(),
            },
            { onConflict: "code" },
          );
          results[code] = { rate: r.value, date: r.date };
        }
        return new Response(JSON.stringify({ ok: true, results }), {
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
