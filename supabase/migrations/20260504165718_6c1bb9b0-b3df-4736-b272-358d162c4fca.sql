-- Garantir que as funções rodem com privilégios do owner (SECURITY DEFINER)
ALTER FUNCTION public.recompute_invoice_total(uuid) SECURITY DEFINER SET search_path = public;
ALTER FUNCTION public.trg_invoice_recompute() SECURITY DEFINER SET search_path = public;

-- Conceder execução aos roles usados pelo PostgREST
GRANT EXECUTE ON FUNCTION public.recompute_invoice_total(uuid) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.trg_invoice_recompute() TO authenticated, anon, service_role;