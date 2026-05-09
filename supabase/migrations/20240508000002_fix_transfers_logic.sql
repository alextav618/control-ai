-- Adiciona a coluna de conta de destino
ALTER TABLE public.transactions ADD COLUMN to_account_id UUID REFERENCES public.accounts(id);

-- Atualiza o gatilho de saldo para lidar com o tipo 'transfer'
CREATE OR REPLACE FUNCTION public.handle_transaction_balance()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_from_account_id uuid;
    v_to_account_id uuid;
    v_linked_id uuid;
    v_payment_method text;
BEGIN
    -- Identifica as contas envolvidas
    v_from_account_id := (CASE WHEN TG_OP = 'INSERT' THEN NEW.account_id ELSE OLD.account_id END);
    v_to_account_id := (CASE WHEN TG_OP = 'INSERT' THEN NEW.to_account_id ELSE OLD.to_account_id END);

    -- Lógica de conta vinculada (ex: cartão de débito que desconta da conta corrente)
    v_payment_method := LOWER(CASE WHEN TG_OP = 'INSERT' THEN NEW.payment_method ELSE OLD.payment_method END);
    SELECT linked_account_id INTO v_linked_id FROM public.accounts WHERE id = v_from_account_id;
    
    IF v_linked_id IS NOT NULL AND v_payment_method IN ('pix', 'transferencia', 'boleto', 'saque', 'deposito', 'debito') THEN
        v_from_account_id := v_linked_id;
    END IF;

    IF (TG_OP = 'INSERT') THEN
        IF (NEW.type = 'income') THEN
            UPDATE public.accounts SET current_balance = current_balance + NEW.amount WHERE id = v_from_account_id;
        ELSIF (NEW.type = 'expense') THEN
            UPDATE public.accounts SET current_balance = current_balance - NEW.amount WHERE id = v_from_account_id;
        ELSIF (NEW.type = 'transfer') THEN
            -- Subtrai da origem
            UPDATE public.accounts SET current_balance = current_balance - NEW.amount WHERE id = v_from_account_id;
            -- Soma no destino
            IF v_to_account_id IS NOT NULL THEN
                UPDATE public.accounts SET current_balance = current_balance + NEW.amount WHERE id = v_to_account_id;
            END IF;
        END IF;
    ELSIF (TG_OP = 'DELETE') THEN
        IF (OLD.type = 'income') THEN
            UPDATE public.accounts SET current_balance = current_balance - OLD.amount WHERE id = v_from_account_id;
        ELSIF (OLD.type = 'expense') THEN
            UPDATE public.accounts SET current_balance = current_balance + OLD.amount WHERE id = v_from_account_id;
        ELSIF (OLD.type = 'transfer') THEN
            -- Reverte origem
            UPDATE public.accounts SET current_balance = current_balance + OLD.amount WHERE id = v_from_account_id;
            -- Reverte destino
            IF v_to_account_id IS NOT NULL THEN
                UPDATE public.accounts SET current_balance = current_balance - OLD.amount WHERE id = v_to_account_id;
            END IF;
        END IF;
    END IF;
    RETURN NULL;
END;
$function$;