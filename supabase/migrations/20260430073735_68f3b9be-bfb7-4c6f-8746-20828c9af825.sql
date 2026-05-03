
-- Cria trigger que mantém o total da fatura sincronizado com as transações
DROP TRIGGER IF EXISTS transactions_invoice_recompute ON public.transactions;
CREATE TRIGGER transactions_invoice_recompute
AFTER INSERT OR UPDATE OR DELETE ON public.transactions
FOR EACH ROW
EXECUTE FUNCTION public.trg_invoice_recompute();

-- Backfill: vincula transações de cartão de crédito que ainda não têm fatura associada
-- Para cada transaction de despesa em conta credit_card sem invoice_id, criar/encontrar a invoice e vincular.
DO $$
DECLARE
  t RECORD;
  acc RECORD;
  ref_m INT;
  ref_y INT;
  occ_day INT;
  inv_id UUID;
  cd INT;
  dd INT;
  closing_d DATE;
  due_d DATE;
BEGIN
  FOR t IN
    SELECT tx.* FROM public.transactions tx
    JOIN public.accounts a ON a.id = tx.account_id
    WHERE tx.invoice_id IS NULL
      AND tx.type = 'expense'
      AND a.type = 'credit_card'
  LOOP
    SELECT * INTO acc FROM public.accounts WHERE id = t.account_id;
    cd := COALESCE(acc.closing_day, 1);
    dd := COALESCE(acc.due_day, 10);
    occ_day := EXTRACT(DAY FROM t.occurred_on)::INT;
    ref_m := EXTRACT(MONTH FROM t.occurred_on)::INT;
    ref_y := EXTRACT(YEAR FROM t.occurred_on)::INT;
    IF occ_day > cd THEN
      ref_m := ref_m + 1;
      IF ref_m > 12 THEN ref_m := 1; ref_y := ref_y + 1; END IF;
    END IF;
    closing_d := make_date(ref_y, ref_m, LEAST(cd, 28));
    due_d := make_date(ref_y, ref_m, LEAST(dd, 28));
    IF dd <= cd THEN
      due_d := due_d + INTERVAL '1 month';
    END IF;

    SELECT id INTO inv_id FROM public.invoices
      WHERE account_id = acc.id AND reference_month = ref_m AND reference_year = ref_y;

    IF inv_id IS NULL THEN
      INSERT INTO public.invoices (user_id, account_id, reference_month, reference_year, closing_date, due_date, status)
      VALUES (t.user_id, acc.id, ref_m, ref_y, closing_d, due_d, 'open')
      RETURNING id INTO inv_id;
    END IF;

    UPDATE public.transactions SET invoice_id = inv_id WHERE id = t.id;
  END LOOP;
END $$;

-- Recompute todos os totais das faturas existentes
UPDATE public.invoices i
SET total_amount = COALESCE((
  SELECT SUM(amount) FROM public.transactions WHERE invoice_id = i.id AND type = 'expense'
), 0);

-- Remove invoices "fantasmas" sem nenhuma transação E de contas arquivadas
DELETE FROM public.invoices i
WHERE i.total_amount = 0
  AND NOT EXISTS (SELECT 1 FROM public.transactions WHERE invoice_id = i.id)
  AND EXISTS (SELECT 1 FROM public.accounts a WHERE a.id = i.account_id AND a.archived = true);
