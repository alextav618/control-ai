import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

const { data, error } = await supabase.functions.invoke("chat-gemini", {
  body: { message: "sua pergunta aqui" },
});

console.log(data.reply);