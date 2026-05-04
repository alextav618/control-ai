-- 1. Drop triggers and function de invoice_items (não usaremos mais)
DROP TRIGGER IF EXISTS trg_invoice_items_recompute_ins ON public.invoice_items;
DROP TRIGGER IF EXISTS trg_invoice_items_recompute_upd ON public.invoice_items;
DROP TRIGGER IF EXISTS trg_invoice_items_recompute_del ON public.invoice_items;
DROP TRIGGER IF EXISTS trg_invoice_items_recompute ON public.invoice_items;
DROP FUNCTION IF EXISTS public.trg_invoice_items_recompute() CASCADE;

-- 2. Recriar recompute_invoice_total - somente da tabela transactions
CREATE OR REPLACE FUNCTION public.recompute_invoice_total(p_invoice uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.invoices
  SET total_amount = COALESCE((
    SELECT SUM(amount)
    FROM public.transactions
    WHERE invoice_id = p_invoice AND type = 'expense'
  ), 0)
  WHERE id = p_invoice;
END;
$$;

-- 3. Recriar trigger function para transactions
CREATE OR REPLACE FUNCTION public.trg_invoice_recompute()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.invoice_id IS NOT NULL THEN
      PERFORM public.recompute_invoice_total(OLD.invoice_id);
    END IF;
    RETURN OLD;
  ELSE
    IF NEW.invoice_id IS NOT NULL THEN
      PERFORM public.recompute_invoice_total(NEW.invoice_id);
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.invoice_id IS NOT NULL AND OLD.invoice_id IS DISTINCT FROM NEW.invoice_id THEN
      PERFORM public.recompute_invoice_total(OLD.invoice_id);
    END IF;
    RETURN NEW;
  END IF;
END;
$$;

-- 4. Reaplicar trigger em transactions
DROP TRIGGER IF EXISTS trg_transactions_invoice_recompute ON public.transactions;
CREATE TRIGGER trg_transactions_invoice_recompute
AFTER INSERT OR UPDATE OR DELETE ON public.transactions
FOR EACH ROW
EXECUTE FUNCTION public.trg_invoice_recompute();

-- 5. Permissões
GRANT EXECUTE ON FUNCTION public.recompute_invoice_total(uuid) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.trg_invoice_recompute() TO authenticated, anon, service_role;