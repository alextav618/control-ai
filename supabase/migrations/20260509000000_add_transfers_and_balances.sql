-- ======================================================
-- PASSO 1: DIAGNÓSTICO - Rode este bloco PRIMEIRO
-- para ver quantas transferências duplicadas existem
-- ======================================================
SELECT 
    t1.id as id_despesa,
    t2.id as id_receita,
    t1.description,
    t1.amount,
    t1.occurred_on
FROM public.transactions t1
JOIN public.transactions t2 ON 
    t1.user_id = t2.user_id AND
    t1.amount = t2.amount AND
    t1.occurred_on = t2.occurred_on
WHERE t1.type = 'expense' 
  AND t2.type = 'income'
  AND t1.id != t2.id
  AND (
    t1.payment_method = 'transferencia' OR 
    t2.payment_method = 'transferencia' OR
    t1.description ILIKE 'transfer%' OR
    t2.description ILIKE 'transfer%' OR
    t1.description = t2.description
  );

-- ======================================================
-- PASSO 2: SE O DIAGNÓSTICO MOSTRAR LINHAS, rode isto
-- ======================================================

-- Adicionar a coluna caso ainda não exista
ALTER TABLE public.transactions 
ADD COLUMN IF NOT EXISTS to_account_id UUID REFERENCES public.accounts(id) ON DELETE SET NULL;

-- Corrigir pares de transferência: 
-- transforma a despesa em 'transfer' e define a conta destino
WITH pairs AS (
    SELECT DISTINCT ON (t1.id)
        t1.id as expense_id,
        t2.id as income_id,
        t2.account_id as destination_id
    FROM public.transactions t1
    JOIN public.transactions t2 ON 
        t1.user_id = t2.user_id AND
        t1.amount = t2.amount AND
        t1.occurred_on = t2.occurred_on AND
        t1.id != t2.id
    WHERE t1.type = 'expense' 
      AND t2.type = 'income'
      AND (
        t1.payment_method = 'transferencia' OR 
        t2.payment_method = 'transferencia' OR
        t1.description = t2.description
      )
    ORDER BY t1.id
)
UPDATE public.transactions t
SET 
    type = 'transfer',
    to_account_id = p.destination_id
FROM pairs p
WHERE t.id = p.expense_id;

-- Agora apaga a receita duplicada (o outro lado do par)
DELETE FROM public.transactions del
WHERE del.id IN (
    SELECT DISTINCT t2.id
    FROM public.transactions t1
    JOIN public.transactions t2 ON 
        t1.user_id = t2.user_id AND
        t1.amount = t2.amount AND
        t1.occurred_on = t2.occurred_on AND
        t1.id != t2.id
    WHERE t1.type = 'transfer'  -- já foi convertida acima
      AND t2.type = 'income'
      AND (
        t1.payment_method = 'transferencia' OR 
        t2.payment_method = 'transferencia' OR
        t1.description = t2.description
      )
);

-- ======================================================
-- PASSO 3: Criar/substituir o trigger de saldo
-- ======================================================
CREATE OR REPLACE FUNCTION public.update_account_balance()
RETURNS TRIGGER AS $$
BEGIN
    -- Reverter efeito antigo (para UPDATE e DELETE)
    IF (TG_OP = 'DELETE' OR TG_OP = 'UPDATE') THEN
        IF (OLD.type = 'expense' OR OLD.type = 'transfer') AND OLD.account_id IS NOT NULL THEN
            UPDATE public.accounts SET current_balance = current_balance + OLD.amount WHERE id = OLD.account_id;
        END IF;
        IF (OLD.type = 'income') AND OLD.account_id IS NOT NULL THEN
            UPDATE public.accounts SET current_balance = current_balance - OLD.amount WHERE id = OLD.account_id;
        END IF;
        IF (OLD.type = 'transfer') AND OLD.to_account_id IS NOT NULL THEN
            UPDATE public.accounts SET current_balance = current_balance - OLD.amount WHERE id = OLD.to_account_id;
        END IF;
    END IF;

    -- Aplicar efeito novo (para INSERT e UPDATE)
    IF (TG_OP = 'INSERT' OR TG_OP = 'UPDATE') THEN
        IF (NEW.type = 'expense' OR NEW.type = 'transfer') AND NEW.account_id IS NOT NULL THEN
            UPDATE public.accounts SET current_balance = current_balance - NEW.amount WHERE id = NEW.account_id;
        END IF;
        IF (NEW.type = 'income') AND NEW.account_id IS NOT NULL THEN
            UPDATE public.accounts SET current_balance = current_balance + NEW.amount WHERE id = NEW.account_id;
        END IF;
        IF (NEW.type = 'transfer') AND NEW.to_account_id IS NOT NULL THEN
            UPDATE public.accounts SET current_balance = current_balance + NEW.amount WHERE id = NEW.to_account_id;
        END IF;
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_update_account_balance ON public.transactions;
CREATE TRIGGER trg_update_account_balance
AFTER INSERT OR UPDATE OR DELETE ON public.transactions
FOR EACH ROW EXECUTE FUNCTION public.update_account_balance();

-- ======================================================
-- VERIFICAÇÃO FINAL - Quantas transferências existem agora?
-- ======================================================
SELECT type, COUNT(*), SUM(amount) 
FROM public.transactions 
GROUP BY type;
