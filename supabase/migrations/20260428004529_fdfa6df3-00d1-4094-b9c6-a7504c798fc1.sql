-- Tipos
CREATE TYPE public.asset_type AS ENUM ('fixed_income', 'stock', 'reit', 'crypto', 'fund', 'treasury', 'other');
CREATE TYPE public.asset_indexer AS ENUM ('cdi', 'ipca', 'selic', 'prefixed', 'none');
CREATE TYPE public.movement_type AS ENUM ('deposit', 'withdrawal', 'interest', 'dividend', 'fee', 'tax');

-- Ativos
CREATE TABLE public.investment_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  type public.asset_type NOT NULL DEFAULT 'fixed_income',
  indexer public.asset_indexer NOT NULL DEFAULT 'none',
  rate numeric, -- ex: 110 (110% do CDI) ou 12.5 (12.5% a.a. prefixado)
  institution text,
  ticker text,
  maturity_date date,
  notes text,
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.investment_assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_select_own_assets" ON public.investment_assets FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "users_insert_own_assets" ON public.investment_assets FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "users_update_own_assets" ON public.investment_assets FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "users_delete_own_assets" ON public.investment_assets FOR DELETE USING (auth.uid() = user_id);
CREATE TRIGGER trg_assets_touch BEFORE UPDATE ON public.investment_assets FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE INDEX idx_assets_user ON public.investment_assets(user_id) WHERE archived = false;

-- Movimentações
CREATE TABLE public.investment_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  asset_id uuid NOT NULL REFERENCES public.investment_assets(id) ON DELETE CASCADE,
  type public.movement_type NOT NULL,
  occurred_on date NOT NULL DEFAULT CURRENT_DATE,
  amount numeric NOT NULL, -- sempre positivo
  quantity numeric, -- opcional (cotas/qtd)
  unit_price numeric, -- opcional
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.investment_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_select_own_mov" ON public.investment_movements FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "users_insert_own_mov" ON public.investment_movements FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "users_update_own_mov" ON public.investment_movements FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "users_delete_own_mov" ON public.investment_movements FOR DELETE USING (auth.uid() = user_id);
CREATE INDEX idx_mov_asset ON public.investment_movements(asset_id, occurred_on);
CREATE INDEX idx_mov_user_date ON public.investment_movements(user_id, occurred_on);

-- Snapshots de valor
CREATE TABLE public.investment_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  asset_id uuid NOT NULL REFERENCES public.investment_assets(id) ON DELETE CASCADE,
  snapshot_date date NOT NULL DEFAULT CURRENT_DATE,
  market_value numeric NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(asset_id, snapshot_date)
);
ALTER TABLE public.investment_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_select_own_snap" ON public.investment_snapshots FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "users_insert_own_snap" ON public.investment_snapshots FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "users_update_own_snap" ON public.investment_snapshots FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "users_delete_own_snap" ON public.investment_snapshots FOR DELETE USING (auth.uid() = user_id);
CREATE INDEX idx_snap_asset_date ON public.investment_snapshots(asset_id, snapshot_date DESC);