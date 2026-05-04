export async function recompute_invoice_total(p_invoice: string) {
  const { data, error } = await supabase.rpc("recompute_invoice_total", { p_invoice });
  if (error) throw error;
  return data;
}