-- Fix: SET search_path em todas as funções
ALTER FUNCTION public.touch_updated_at() SET search_path = public;
ALTER FUNCTION public.trg_invoice_recompute() SET search_path = public;

-- Revogar EXECUTE público das SECURITY DEFINER (são chamadas só por triggers)
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.recompute_invoice_total(UUID) FROM PUBLIC, anon, authenticated;