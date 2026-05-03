-- 1) Renomear conceito: fixed_bills passa a aceitar variáveis também
ALTER TABLE public.fixed_bills
  ADD COLUMN IF NOT EXISTS amount_kind text NOT NULL DEFAULT 'fixed' CHECK (amount_kind IN ('fixed','variable'));

-- 2) Tabela de ocorrências mensais (uma linha por mês por recorrente)
CREATE TABLE IF NOT EXISTS public.recurring_occurrences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  fixed_bill_id uuid NOT NULL REFERENCES public.fixed_bills(id) ON DELETE CASCADE,
  reference_month integer NOT NULL,
  reference_year integer NOT NULL,
  amount numeric,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','skipped')),
  transaction_id uuid REFERENCES public.transactions(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (fixed_bill_id, reference_month, reference_year)
);

ALTER TABLE public.recurring_occurrences ENABLE ROW LEVEL SECURITY;

CREATE POLICY users_select_own_occ ON public.recurring_occurrences FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY users_insert_own_occ ON public.recurring_occurrences FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY users_update_own_occ ON public.recurring_occurrences FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY users_delete_own_occ ON public.recurring_occurrences FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER trg_occ_updated BEFORE UPDATE ON public.recurring_occurrences
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
