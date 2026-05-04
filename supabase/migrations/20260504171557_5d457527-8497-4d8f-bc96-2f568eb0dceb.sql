-- Revogar EXECUTE de roles expostas; triggers continuam funcionando via contexto interno
REVOKE EXECUTE ON FUNCTION public.recompute_invoice_total(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_invoice_recompute() FROM PUBLIC, anon, authenticated;