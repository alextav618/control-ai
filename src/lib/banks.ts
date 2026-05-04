import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/** Retrieves all banks ordered by name */
export function useBanks() {
  return useQuery({
    queryKey: ["banks"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("banks")
        .select("id, name")
        .order("name", { ascending: true });
      if (error) throw error;
      return data as Array<{ id: string; name: string }>;
    },
    staleTime: 60 * 60 * 1000, // 1 hour
  });
}