-- 1) Criar tabela invoice_items
CREATE TABLE IF NOT EXISTS public.invoice_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  description text NOT NULL,
  quantity numeric NOT NULL DEFAULT 1,
  unit_price numeric NOT NULL DEFAULT 0,
  amount numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON public.invoice_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_user ON public.invoice_items(user_id);

ALTER TABLE public.invoice_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_select_own_invoice_items" ON public.invoice_items
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "users_insert_own_invoice_items" ON public.invoice_items
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "users_update_own_invoice_items" ON public.invoice_items
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "users_delete_own_invoice_items" ON public.invoice_items
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TRIGGER invoice_items_touch_updated_at
  BEFORE UPDATE ON public.invoice_items
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 2) Atualizar recompute_invoice_total para somar transactions + invoice_items
CREATE OR REPLACE FUNCTION public.recompute_invoice_total(p_invoice uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  UPDATE public.invoices
  SET total_amount = COALESCE((
    SELECT SUM(amount) FROM public.transactions WHERE invoice_id = p_invoice AND type = 'expense'
  ), 0) + COALESCE((
    SELECT SUM(amount) FROM public.invoice_items WHERE invoice_id = p_invoice
  ), 0)
  WHERE id = p_invoice;
END;
$function$;

-- 3) Trigger no invoice_items para recálculo
CREATE OR REPLACE FUNCTION public.trg_invoice_items_recompute()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.recompute_invoice_total(OLD.invoice_id);
    RETURN OLD;
  ELSE
    PERFORM public.recompute_invoice_total(NEW.invoice_id);
    IF TG_OP = 'UPDATE' AND OLD.invoice_id IS DISTINCT FROM NEW.invoice_id THEN
      PERFORM public.recompute_invoice_total(OLD.invoice_id);
    END IF;
    RETURN NEW;
  END IF;
END;
$function$;

CREATE TRIGGER invoice_items_recompute
  AFTER INSERT OR UPDATE OR DELETE ON public.invoice_items
  FOR EACH ROW EXECUTE FUNCTION public.trg_invoice_items_recompute();

-- 4) Garantir que o trigger de transactions exista (caso ainda não esteja anexado)
DROP TRIGGER IF EXISTS transactions_invoice_recompute ON public.transactions;
CREATE TRIGGER transactions_invoice_recompute
  AFTER INSERT OR UPDATE OR DELETE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.trg_invoice_recompute();

-- 5) Resolver warnings: revogar EXECUTE público das funções internas.
-- Triggers continuam funcionando porque rodam no contexto interno do Postgres,
-- não via PostgREST/role do usuário.
REVOKE EXECUTE ON FUNCTION public.recompute_invoice_total(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_invoice_recompute() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_invoice_items_recompute() FROM PUBLIC, anon, authenticated;