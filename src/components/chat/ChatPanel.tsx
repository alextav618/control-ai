import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Mic, Send, Image as ImageIcon, Loader2, X, Square } from "lucide-react";
import { toast } from "sonner";
import { formatBRL } from "@/lib/format";
import { cn } from "@/lib/utils";

type Msg = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  attachment_url?: string | null;
  attachment_type?: string | null;
  metadata?: any;
  created_at: string;
};

type ChatMessageRow = {
  id: string;
  user_id: string;
  role: string;
  content: string;
  attachment_url: string | null;
  attachment_type: string | null;
  metadata: any;
};

export function ChatPanel({ autoFocus = false }: { autoFocus?: boolean }) {
  // ... existing state and refs

  const send = async () => {
    if (!user) return;
    if (!text.trim() && !imageData && !audioBlob) return;
    setSending(true);
    try {
      // ... existing image/audio handling

      const { data: userMsg, error: insErr } = await supabase
        .from<ChatMessageRow>("chat_messages")
        .insert({
          user_id: user.id,
          role: "user",
          content: text.trim() || (imageData ? "[imagem]" : "[áudio]"),
          attachment_url: attachmentUrl,
          attachment_type: attachmentType,
        })
        .select()
        .single();
      if (insErr) throw insErr;

      // ... rest of AI call

      const { data: aMsg, error: aErr } = await supabase
        .from<ChatMessageRow>("chat_messages")
        .insert({
          user_id: user.id,
          role: "assistant",
          content: assistantText,
          metadata: { actions: data?.actions ?? [] },
        })
        .select()
        .single();
      if (aErr) throw aErr;

      qc.setQueryData(["chat-messages", user.id], (old: Msg[] = []) => [...old, aMsg as Msg]);
      // ... rest of existing code
    } catch (e) {
      console.error(e);
    } finally {
      setSending(false);
    }
  };

  // ... rest of existing component
}