-- Vincular ativos a contas
ALTER TABLE public.investment_assets
  ADD COLUMN IF NOT EXISTS account_id uuid;

-- Tabela de taxas de mercado (compartilhada entre todos os usuários)
CREATE TABLE IF NOT EXISTS public.index_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,        -- 'cdi' | 'selic' | 'ipca'
  annual_rate numeric NOT NULL,     -- taxa anual em % (ex: 11.75)
  reference_date date NOT NULL,
  source text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.index_rates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anyone_authenticated_can_read_rates" ON public.index_rates;
CREATE POLICY "anyone_authenticated_can_read_rates"
  ON public.index_rates FOR SELECT
  TO authenticated
  USING (true);

-- Insere placeholders pra evitar tela vazia antes do primeiro cron
INSERT INTO public.index_rates (code, annual_rate, reference_date, source)
VALUES
  ('cdi',   11.15, CURRENT_DATE, 'seed'),
  ('selic', 11.25, CURRENT_DATE, 'seed'),
  ('ipca',   4.50, CURRENT_DATE, 'seed')
ON CONFLICT (code) DO NOTHING;