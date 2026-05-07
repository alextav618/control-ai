-- Ensure invoice_initial_balances has the correct structure
ALTER TABLE public.invoice_initial_balances ADD COLUMN IF NOT EXISTS invoice_id UUID REFERENCES public.invoices(id) ON DELETE CASCADE;
ALTER TABLE public.invoice_initial_balances DROP CONSTRAINT IF EXISTS invoice_initial_balances_invoice_id_key;
ALTER TABLE public.invoice_initial_balances ADD CONSTRAINT invoice_initial_balances_invoice_id_key UNIQUE (invoice_id);

-- Update the recompute function to be comprehensive
CREATE OR REPLACE FUNCTION public.recompute_invoice_total(p_invoice_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_tx_total DECIMAL(12,2);
    v_items_total DECIMAL(12,2);
    v_initial_balance DECIMAL(12,2);
BEGIN
    -- Sum transactions
    SELECT COALESCE(SUM(amount), 0) INTO v_tx_total
    FROM public.transactions WHERE invoice_id = p_invoice_id;

    -- Sum invoice items
    SELECT COALESCE(SUM(amount), 0) INTO v_items_total
    FROM public.invoice_items WHERE invoice_id = p_invoice_id;

    -- Get initial balance (adjustment)
    SELECT COALESCE(amount, 0) INTO v_initial_balance
    FROM public.invoice_initial_balances WHERE invoice_id = p_invoice_id;

    -- Update invoice total_amount
    UPDATE public.invoices
    SET total_amount = v_tx_total + v_items_total + v_initial_balance
    WHERE id = p_invoice_id;
END;
$$;