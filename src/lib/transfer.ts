export async function transferFunds(fromBankId: string, toBankId: string, amount: number, description?: string) {
  // Implementação da função de transferência
  const { data, error } = await supabase.rpc("transfer_funds", {
    p_from_bank_id: fromBankId,
    p_to_bank_id: toBankId,
    p_amount: amount,
    p_description: description,
  });

  if (error) {
    throw new Error(error.message);
  }

  return data;
}