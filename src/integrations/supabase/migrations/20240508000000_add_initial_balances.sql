-- Create table for invoice initial balances
CREATE TABLE public.invoice_initial_balances (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  invoice_id UUID REFERENCES public.invoices(id) ON DELETE CASCADE,
  initial_balance DECIMAL(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS (REQUIRED for security)
ALTER TABLE public.invoice_initial_balances ENABLE ROW LEVEL SECURITY;

-- Create secure policies for each operation
CREATE POLICY "initial_balances_select_policy" ON public.invoice_initial_balances
FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "initial_balances_insert_policy" ON public.invoice_initial_balances
FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "initial_balances_update_policy" ON public.invoice_initial_balances
FOR UPDATE TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "initial_balances_delete_policy" ON public.invoice_initial_balances
FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Create unique constraint to ensure only one initial balance per invoice
CREATE UNIQUE INDEX idx_invoice_initial_balances_invoice_id ON public.invoice_initial_balances(invoice_id);