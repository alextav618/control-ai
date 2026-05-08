import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Mic, Send, Image as ImageIcon, Loader2, X, Square } from "lucide-react";
import { toast } from "sonner";
import { formatBRL, localDateString } from "@/lib/format";
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

export function ChatPanel({ autoFocus = false }: { autoFocus?: boolean }) {
  const { user, session } = useAuth();
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [imageData, setImageData] = useState<{ base64: string; preview: string } | null>(null);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [recording, setRecording] = useState(false);
  const [sending, setSending] = useState(false);
  const recRef = useRef<MediaRecorder | null>(null);
  const recChunks = useRef<Blob[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const { data: messages = [] } = useQuery({
    queryKey: ["chat-messages", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("chat_messages")
        .select("*")
        .order("created_at", { ascending: true })
        .limit(200);
      if (error) throw error;
      return data as Msg[];
    },
    enabled: !!user,
  });

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  const handlePickImage = async (file: File) => {
    if (file.size > 10 * 1024 * 1024) {
      toast.error("Imagem muito grande (máx 10MB)");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setImageData({ base64: dataUrl, preview: dataUrl });
    };
    reader.readAsDataURL(file);
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/mp4" });
      recChunks.current = [];
      rec.ondataavailable = (e) => { if (e.data.size > 0) recChunks.current.push(e.data); };
      rec.onstop = () => {
        const blob = new Blob(recChunks.current, { type: rec.mimeType });
        setAudioBlob(blob);
        stream.getTracks().forEach((t) => t.stop());
      };
      rec.start();
      recRef.current = rec;
      setRecording(true);
    } catch (e) {
      toast.error("Não foi possível acessar o microfone");
    }
  };

  const stopRecording = () => {
    recRef.current?.stop();
    setRecording(false);
  };

  const blobToBase64 = (blob: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => {
        const s = r.result as string;
        resolve(s.split(",")[1] ?? s);
      };
      r.onerror = reject;
      r.readAsDataURL(blob);
    });

  const send = async () => {
    if (!user) return;
    if (!text.trim() && !imageData && !audioBlob) return;
    setSending(true);
    try {
      let attachmentUrl: string | null = null;
      let attachmentType: string | null = null;
      let imageBase64: string | undefined;
      let audioBase64: string | undefined;
      let audioMime: string | undefined;

      if (imageData) {
        const blob = await (await fetch(imageData.base64)).blob();
        const ext = blob.type.split("/")[1] ?? "jpg";
        const path = `${user.id}/${Date.now()}.${ext}`;
        const { error: upErr } = await supabase.storage.from("chat-attachments").upload(path, blob);
        if (!upErr) {
          const { data: signed } = await supabase.storage.from("chat-attachments").createSignedUrl(path, 60 * 60 * 24 * 365);
          attachmentUrl = signed?.signedUrl ?? null;
          attachmentType = "image";
        }
        imageBase64 = imageData.base64;
      }

      if (audioBlob) {
        const ext = audioBlob.type.includes("webm") ? "webm" : "mp4";
        const path = `${user.id}/${Date.now()}.${ext}`;
        const { error: upErr } = await supabase.storage.from("chat-attachments").upload(path, audioBlob);
        if (!upErr) {
          const { data: signed } = await supabase.storage.from("chat-attachments").createSignedUrl(path, 60 * 60 * 24 * 365);
          attachmentUrl = signed?.signedUrl ?? null;
          attachmentType = "audio";
        }
        audioBase64 = await blobToBase64(audioBlob);
        audioMime = audioBlob.type;
      }

      const { data: userMsg, error: insErr } = await supabase
        .from("chat_messages")
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

      const history = messages.slice(-10).map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
      qc.setQueryData(["chat-messages", user.id], (old: Msg[] = []) => [...old, userMsg as Msg]);

      // Usando a URL absoluta conforme diretrizes
      const functionUrl = "https://rfwialobgdafttpuqwfx.supabase.co/functions/v1/chat-ai";
      
      const response = await fetch(functionUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ 
          text: text.trim() || undefined, 
          imageBase64, 
          audioBase64, 
          audioMime, 
          history,
          localDate: localDateString()
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        console.error('Erro na Edge Function:', data);
        toast.error(data.error || "Erro na IA", { duration: 8000 });
        setSending(false);
        return;
      }

      const assistantText = data?.message || "Ok.";
      const { data: aMsg, error: aInsErr } = await supabase
        .from("chat_messages")
        .insert({
          user_id: user.id,
          role: "assistant",
          content: assistantText,
          metadata: { actions: data?.actions ?? [] },
        })
        .select()
        .single();

      if (!aInsErr) {
        qc.setQueryData(["chat-messages", user.id], (old: Msg[] = []) => [...old, aMsg as Msg]);
      }
      
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["invoices"] });

      setText("");
      setImageData(null);
      setAudioBlob(null);
    } catch (e: any) {
      console.error('Erro no envio:', e);
      toast.error(e.message || "Erro inesperado no chat");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 md:px-6 py-6">
        <div className="max-w-3xl mx-auto space-y-4">
          {messages.length === 0 && <EmptyState />}
          {messages.map((m) => <MessageBubble key={m.id} msg={m} />)}
          {sending && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground px-4">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> IControl IA está processando...
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-border bg-surface-1/80 backdrop-blur px-4 md:px-6 py-4">
        <div className="max-w-3xl mx-auto">
          {(imageData || audioBlob) && (
            <div className="mb-3 flex items-center gap-2">
              {imageData && (
                <div className="relative">
                  <img src={imageData.preview} alt="prévia" className="h-16 w-16 object-cover rounded-lg border border-border" />
                  <button onClick={() => setImageData(null)} className="absolute -top-1.5 -right-1.5 bg-background border border-border rounded-full p-0.5">
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )}
              {audioBlob && (
                <div className="flex items-center gap-2 px-3 py-2 bg-surface-2 rounded-lg border border-border text-sm">
                  <Mic className="h-4 w-4 text-primary" />
                  Áudio gravado ({Math.round(audioBlob.size / 1024)} KB)
                  <button onClick={() => setAudioBlob(null)}><X className="h-3 w-3" /></button>
                </div>
              )}
            </div>
          )}
          <div className="flex items-end gap-2">
            <label className="cursor-pointer p-2.5 rounded-lg hover:bg-surface-2 transition-colors text-muted-foreground hover:text-foreground">
              <ImageIcon className="h-5 w-5" />
              <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && handlePickImage(e.target.files[0])} />
            </label>
            <button
              onClick={recording ? stopRecording : startRecording}
              className={cn(
                "p-2.5 rounded-lg transition-colors",
                recording ? "bg-destructive text-destructive-foreground animate-pulse" : "hover:bg-surface-2 text-muted-foreground hover:text-foreground"
              )}
            >
              {recording ? <Square className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
            </button>
            <Textarea
              ref={inputRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (!sending) send();
                }
              }}
              placeholder="Peça ao Assistente"
              rows={1}
              className="min-h-[44px] max-h-32 resize-none"
            />
            <Button onClick={send} disabled={sending || (!text.trim() && !imageData && !audioBlob)} size="icon" className="h-11 w-11">
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="text-center py-10">
      <div className="inline-flex h-14 w-14 rounded-2xl bg-gradient-primary items-center justify-center text-primary-foreground font-display font-bold text-xl shadow-glow mb-4">
        I
      </div>
      <h2 className="font-display text-xl font-semibold">Bom te ver.</h2>
      <p className="text-muted-foreground mt-2 max-w-md mx-auto text-sm">
        Mande texto, foto ou áudio. A IControl IA estrutura tudo.
      </p>
    </div>
  );
}

function MessageBubble({ msg }: { msg: Msg }) {
  const isUser = msg.role === "user";
  const actions = msg.metadata?.actions ?? [];
  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div className={cn("max-w-[85%] md:max-w-[70%] space-y-2")}>
        <div
          className={cn(
            "rounded-2xl px-4 py-2.5",
            isUser
              ? "bg-primary text-primary-foreground rounded-br-sm"
              : "bg-surface-2 text-foreground border border-border rounded-bl-sm"
          )}
        >
          {msg.attachment_url && msg.attachment_type === "image" && (
            <img src={msg.attachment_url} alt="anexo" className="rounded-lg mb-2 max-h-64" />
          )}
          {msg.attachment_url && msg.attachment_type === "audio" && (
            <audio controls src={msg.attachment_url} className="mb-2 w-full" />
          )}
          <div className="whitespace-pre-wrap text-sm">{msg.content}</div>
        </div>
        {!isUser && actions.length > 0 && actions.map((a: any, i: number) => (
          <ActionCard key={i} action={a} />
        ))}
      </div>
    </div>
  );
}

function ActionCard({ action }: { action: any }) {
  if (action.type === "transaction") {
    const t = action.transaction;
    const level = t.audit_level;
    const dot =
      level === "green" ? "bg-audit-green" :
      level === "yellow" ? "bg-audit-yellow" :
      level === "red" ? "bg-audit-red" : "bg-muted-foreground";
    return (
      <div className="rounded-xl bg-surface-1 border border-border px-4 py-3 text-sm">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <span className={cn("h-2 w-2 rounded-full shrink-0", dot)} />
            <span className="truncate">{t.description}</span>
          </div>
          <span className={cn("font-mono tabular font-semibold shrink-0", t.type === "income" ? "text-income" : "text-expense")}>
            {t.type === "income" ? "+" : "-"}{formatBRL(Number(t.amount))}
          </span>
        </div>
        {t.audit_reason && <p className="text-xs text-muted-foreground mt-1.5">{t.audit_reason}</p>}
      </div>
    );
  }
  if (action.type === "account") return <Tag>Conta criada: {action.account.name}</Tag>;
  if (action.type === "fixed_bill") return <Tag>Conta fixa: {action.bill.name}</Tag>;
  if (action.type === "category") return <Tag>Categoria: {action.category.name}</Tag>;
  if (action.type === "error") return <div className="text-xs text-destructive">⚠ {action.message}</div>;
  return null;
}

function Tag({ children }: { children: React.ReactNode }) {
  return <div className="inline-block text-xs px-2.5 py-1 rounded-md bg-surface-2 border border-border text-muted-foreground">{children}</div>;
}