import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { formatBRL, monthNames } from "@/lib/format";
import { Sparkles, AlertTriangle, ThumbsUp, Lightbulb, TrendingDown, TrendingUp, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type Profile = {
  monthly_budget: number | null;
};

export const Route = createFileRoute("/app/insights")({
  component: InsightsPage,
});

function InsightsPage() {
  const { user } = useAuth();
  const [aiText, setAiText] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["insights-data", user?.id],
    queryFn: async () => {
      if (!user) return null;
      const now = new Date();
      const m = now.getMonth() + 1;
      const y = now.getFullYear();
      const monthStart = `${y}-${String(m).padStart(2, "0")}-01`;
      const lastMonthDate = new Date(y, now.getMonth() - 1, 1);
      const lmStart = `${lastMonthDate.getFullYear()}-${String(lastMonthDate.getMonth() + 1).padStart(2, "0")}-01`;

      const [txR, lmR, billsR, invR, profR, accR, itemsR] = await Promise.all([
        supabase.from("transactions").select("*, categories(name, icon)").gte("occurred_on", monthStart),
        supabase.from("transactions").select("amount, type, category_id, occurred_on, categories(name)").gte("occurred_on", lmStart).lt("occurred_on", monthStart),
        supabase.from("fixed_bills").select("*").eq("active", true),
        supabase.from("invoices").select("*, accounts!inner(name, archived)").eq("accounts.archived", false).in("status", ["open", "closed"]),
        supabase.from<Profile>("profiles").select("monthly_budget").eq("id", user.id).maybeSingle(),
        supabase.from("accounts").select("*").eq("archived", false),
        supabase.from("invoice_items").select("*"),
      ]);

      return {
        tx: txR.data ?? [],
        lastTx: lmR.data ?? [],
        bills: billsR.data ?? [],
        invoices: invR.data ?? [],
        profile: profR.data ?? null,
        accounts: accR.data ?? [],
        invoiceItems: itemsR.data ?? [],
      };
    },
    enabled: !!user,
  });

  // ... rest of component, fix profile.monthly_budget references:
  // Change data.profile?.monthly_budget to data?.profile?.monthly_budget
  // And in the insight generation:
  if (data?.profile?.monthly_budget && expense > Number(data.profile.monthly_budget)) {
    out.push({
      level: "alert",
      title: "Orçamento mensal estourado",
      body: `Você definiu ${formatBRL(Number(data.profile.monthly_budget))} e já gastou ${formatBRL(expense)}.`,
    });
  }

  // ... rest of existing code
}