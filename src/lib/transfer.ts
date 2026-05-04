import { createClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

/**
 * Initiates a fund transfer between two banks.
 * @param fromBankId UUID of the source bank
 * @param toBankId   UUID of the destination bank
 * @param amount     Amount to transfer (positive number)
 * @param description  Optional description for the transfer
 * @returns Result from the stored procedure
 */
export async function transferFunds(
  fromBankId: string,
  toBankId: string,
  amount: number,
  description?: string
) {
  const { data, error } = await supabase.rpc("transfer_funds", {
    p_from_bank_id: fromBankId,
    p_to_bank_id: toBankId,
    p_amount: amount,
    p_description: description,
  });
  if (error) throw error;
  return data;
}