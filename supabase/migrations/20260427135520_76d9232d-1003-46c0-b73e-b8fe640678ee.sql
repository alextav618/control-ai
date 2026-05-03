-- =========================================================
-- ENUMS
-- =========================================================
CREATE TYPE public.account_type AS ENUM ('cash', 'checking', 'savings', 'credit_card', 'other');
CREATE TYPE public.transaction_type AS ENUM ('expense', 'income', 'transfer');
CREATE TYPE public.transaction_status AS ENUM ('pending', 'paid', 'received', 'scheduled');
CREATE TYPE public.audit_level AS ENUM ('green', 'yellow', 'red');
CREATE TYPE public.message_role AS ENUM ('user', 'assistant', 'system');
CREATE TYPE public.invoice_status AS ENUM ('open', 'closed', 'paid');

-- =========================================================
-- PROFILES
-- =========================================================
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  monthly_budget NUMERIC(14,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_view_own_profile" ON public.profiles
  FOR SELECT USING (auth.uid() = id);
CREATE POLICY "users_update_own_profile" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "users_insert_own_profile" ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

-- =========================================================
-- ACCOUNTS (contas bancárias e cartões)
-- =========================================================
CREATE TABLE public.accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type public.account_type NOT NULL,
  -- Para cartão de crédito:
  closing_day INT,            -- dia de fechamento da fatura (1-31)
  due_day INT,                -- dia de vencimento (1-31)
  credit_limit NUMERIC(14,2), -- limite do cartão
  current_balance NUMERIC(14,2) NOT NULL DEFAULT 0,
  color TEXT,
  icon TEXT,
  archived BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_accounts_user ON public.accounts(user_id);

CREATE POLICY "users_select_own_accounts" ON public.accounts
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "users_insert_own_accounts" ON public.accounts
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "users_update_own_accounts" ON public.accounts
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "users_delete_own_accounts" ON public.accounts
  FOR DELETE USING (auth.uid() = user_id);

-- =========================================================
-- CATEGORIES
-- =========================================================
CREATE TABLE public.categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind public.transaction_type NOT NULL DEFAULT 'expense',
  color TEXT,
  icon TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, name, kind)
);
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_categories_user ON public.categories(user_id);

CREATE POLICY "users_select_own_categories" ON public.categories
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "users_insert_own_categories" ON public.categories
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "users_update_own_categories" ON public.categories
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "users_delete_own_categories" ON public.categories
  FOR DELETE USING (auth.uid() = user_id);

-- =========================================================
-- FIXED BILLS (contas fixas mensais)
-- =========================================================
CREATE TABLE public.fixed_bills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  expected_amount NUMERIC(14,2) NOT NULL,
  due_day INT NOT NULL,
  category_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
  default_account_id UUID REFERENCES public.accounts(id) ON DELETE SET NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.fixed_bills ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_fixed_bills_user ON public.fixed_bills(user_id);

CREATE POLICY "users_select_own_fixed_bills" ON public.fixed_bills
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "users_insert_own_fixed_bills" ON public.fixed_bills
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "users_update_own_fixed_bills" ON public.fixed_bills
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "users_delete_own_fixed_bills" ON public.fixed_bills
  FOR DELETE USING (auth.uid() = user_id);

-- =========================================================
-- INSTALLMENT PLANS (parcelamentos)
-- =========================================================
CREATE TABLE public.installment_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  total_amount NUMERIC(14,2) NOT NULL,
  installment_amount NUMERIC(14,2) NOT NULL,
  total_installments INT NOT NULL,
  account_id UUID REFERENCES public.accounts(id) ON DELETE SET NULL,
  category_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
  start_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.installment_plans ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_installment_plans_user ON public.installment_plans(user_id);

CREATE POLICY "users_select_own_installments" ON public.installment_plans
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "users_insert_own_installments" ON public.installment_plans
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "users_update_own_installments" ON public.installment_plans
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "users_delete_own_installments" ON public.installment_plans
  FOR DELETE USING (auth.uid() = user_id);

-- =========================================================
-- INVOICES (faturas de cartão)
-- =========================================================
CREATE TABLE public.invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  reference_month INT NOT NULL, -- 1-12
  reference_year INT NOT NULL,
  closing_date DATE NOT NULL,
  due_date DATE NOT NULL,
  total_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  status public.invoice_status NOT NULL DEFAULT 'open',
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(account_id, reference_year, reference_month)
);
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_invoices_user ON public.invoices(user_id);
CREATE INDEX idx_invoices_account ON public.invoices(account_id);

CREATE POLICY "users_select_own_invoices" ON public.invoices
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "users_insert_own_invoices" ON public.invoices
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "users_update_own_invoices" ON public.invoices
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "users_delete_own_invoices" ON public.invoices
  FOR DELETE USING (auth.uid() = user_id);

-- =========================================================
-- TRANSACTIONS
-- =========================================================
CREATE TABLE public.transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type public.transaction_type NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  description TEXT NOT NULL,
  occurred_on DATE NOT NULL DEFAULT CURRENT_DATE,
  account_id UUID REFERENCES public.accounts(id) ON DELETE SET NULL,
  category_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
  fixed_bill_id UUID REFERENCES public.fixed_bills(id) ON DELETE SET NULL,
  installment_plan_id UUID REFERENCES public.installment_plans(id) ON DELETE SET NULL,
  installment_number INT, -- ex: 3 (de 12)
  invoice_id UUID REFERENCES public.invoices(id) ON DELETE SET NULL,
  status public.transaction_status NOT NULL DEFAULT 'paid',
  audit_level public.audit_level,
  audit_reason TEXT,
  source TEXT NOT NULL DEFAULT 'manual', -- manual | chat_text | chat_image | chat_audio
  attachment_url TEXT,
  ai_raw JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_transactions_user_date ON public.transactions(user_id, occurred_on DESC);
CREATE INDEX idx_transactions_account ON public.transactions(account_id);
CREATE INDEX idx_transactions_invoice ON public.transactions(invoice_id);

CREATE POLICY "users_select_own_transactions" ON public.transactions
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "users_insert_own_transactions" ON public.transactions
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "users_update_own_transactions" ON public.transactions
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "users_delete_own_transactions" ON public.transactions
  FOR DELETE USING (auth.uid() = user_id);

-- =========================================================
-- CHAT MESSAGES
-- =========================================================
CREATE TABLE public.chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.message_role NOT NULL,
  content TEXT NOT NULL,
  attachment_url TEXT,
  attachment_type TEXT, -- image | audio
  related_transaction_id UUID REFERENCES public.transactions(id) ON DELETE SET NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_chat_messages_user ON public.chat_messages(user_id, created_at);

CREATE POLICY "users_select_own_messages" ON public.chat_messages
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "users_insert_own_messages" ON public.chat_messages
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "users_delete_own_messages" ON public.chat_messages
  FOR DELETE USING (auth.uid() = user_id);

-- =========================================================
-- AUDIT LOG (rastreio das decisões da IA)
-- =========================================================
CREATE TABLE public.audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  transaction_id UUID REFERENCES public.transactions(id) ON DELETE CASCADE,
  action TEXT NOT NULL, -- created_transaction | updated_account | flagged | etc.
  level public.audit_level,
  reasoning TEXT,
  data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_audit_user ON public.audit_log(user_id, created_at DESC);

CREATE POLICY "users_select_own_audit" ON public.audit_log
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "users_insert_own_audit" ON public.audit_log
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- =========================================================
-- TRIGGERS: updated_at
-- =========================================================
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_accounts_updated BEFORE UPDATE ON public.accounts
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_fixed_bills_updated BEFORE UPDATE ON public.fixed_bills
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_invoices_updated BEFORE UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_transactions_updated BEFORE UPDATE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- =========================================================
-- TRIGGER: auto-criar profile + categorias padrão no signup
-- =========================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)));

  INSERT INTO public.categories (user_id, name, kind, icon, color) VALUES
    (NEW.id, 'Mercado',        'expense', '🛒', '#22c55e'),
    (NEW.id, 'Alimentação',    'expense', '🍔', '#f97316'),
    (NEW.id, 'Transporte',     'expense', '🚗', '#3b82f6'),
    (NEW.id, 'Moradia',        'expense', '🏠', '#8b5cf6'),
    (NEW.id, 'Lazer',          'expense', '🎮', '#ec4899'),
    (NEW.id, 'Saúde',          'expense', '💊', '#ef4444'),
    (NEW.id, 'Educação',       'expense', '📚', '#06b6d4'),
    (NEW.id, 'Contas Fixas',   'expense', '📄', '#64748b'),
    (NEW.id, 'Outros',         'expense', '📦', '#94a3b8'),
    (NEW.id, 'Salário',        'income',  '💰', '#10b981'),
    (NEW.id, 'Freelance',      'income',  '💼', '#14b8a6'),
    (NEW.id, 'Outros',         'income',  '✨', '#a3e635');

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =========================================================
-- FUNCTION: recompute invoice totals when transactions change
-- =========================================================
CREATE OR REPLACE FUNCTION public.recompute_invoice_total(p_invoice UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.invoices
  SET total_amount = COALESCE((
    SELECT SUM(amount) FROM public.transactions WHERE invoice_id = p_invoice AND type = 'expense'
  ), 0)
  WHERE id = p_invoice;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_invoice_recompute()
RETURNS TRIGGER
LANGUAGE plpgsql
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

CREATE TRIGGER trg_transactions_invoice
  AFTER INSERT OR UPDATE OR DELETE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.trg_invoice_recompute();

-- =========================================================
-- STORAGE BUCKET para anexos do chat (privado)
-- =========================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('chat-attachments', 'chat-attachments', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "users_read_own_attachments" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'chat-attachments'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );
CREATE POLICY "users_upload_own_attachments" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'chat-attachments'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );
CREATE POLICY "users_delete_own_attachments" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'chat-attachments'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );