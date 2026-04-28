import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Sparkles, Mic, Camera, MessageSquare, ShieldCheck, BarChart3 } from "lucide-react";

export const Route = createFileRoute("/")({
  component: Landing,
});

function Landing() {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen bg-background" />;
  if (user) return <Navigate to="/app" />;

  return (
    <div className="min-h-screen bg-background">
      {/* NAV */}
      <header className="border-b border-border/50 backdrop-blur-sm sticky top-0 z-10 bg-background/80">
        <div className="mx-auto max-w-6xl px-6 py-4 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 font-display font-bold text-lg">
            <span className="h-8 w-8 rounded-lg bg-gradient-primary flex items-center justify-center text-primary-foreground">L</span>
            Ledger
          </Link>
          <div className="flex items-center gap-3">
            <Link to="/auth" search={{ mode: "login" }}><Button variant="ghost">Entrar</Button></Link>
            <Link to="/auth" search={{ mode: "signup" }}><Button>Criar conta</Button></Link>
          </div>
        </div>
      </header>

      {/* HERO */}
      <section className="mx-auto max-w-6xl px-6 pt-24 pb-20 text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-border bg-surface-1 px-4 py-1.5 text-xs text-muted-foreground mb-8">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          Powered by IA multimodal
        </div>
        <h1 className="font-display text-5xl md:text-7xl font-bold tracking-tight">
          Suas finanças,
          <br />
          <span className="bg-gradient-primary bg-clip-text text-transparent">auditadas em tempo real.</span>
        </h1>
        <p className="mt-6 text-lg text-muted-foreground max-w-2xl mx-auto">
          Mande um texto, uma foto do cupom ou um áudio. A IA estrutura, classifica,
          vincula à fatura certa e te avisa se algo fugiu do orçamento. Zero planilha.
        </p>
        <div className="mt-10 flex items-center justify-center gap-3">
          <Link to="/auth" search={{ mode: "signup" }}>
            <Button size="lg" className="text-base px-8 shadow-glow">Começar agora</Button>
          </Link>
          <Link to="/auth" search={{ mode: "login" }}><Button size="lg" variant="outline" className="text-base px-8">Já tenho conta</Button></Link>
        </div>
      </section>

      {/* FEATURES */}
      <section className="mx-auto max-w-6xl px-6 py-16">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            { icon: MessageSquare, title: "Chat natural", desc: "“Paguei R$150 no mercado, crédito Nubank”. Pronto." },
            { icon: Camera, title: "Foto do cupom", desc: "A IA lê o comprovante, valor, estabelecimento e data." },
            { icon: Mic, title: "Áudio rápido", desc: "Grave em segundos enquanto sai do mercado." },
            { icon: ShieldCheck, title: "Auditoria 🟢🟡🔴", desc: "Cada gasto é avaliado contra suas regras e orçamento." },
            { icon: BarChart3, title: "Faturas automáticas", desc: "Cartão de crédito agrupado por data de corte." },
            { icon: Sparkles, title: "Pergunte qualquer coisa", desc: "“Quanto gastei com mercado em outubro?” — resposta exata." },
          ].map(({ icon: Icon, title, desc }) => (
            <div key={title} className="rounded-2xl border border-border bg-surface-1 p-6 hover:bg-surface-2 transition-colors">
              <Icon className="h-6 w-6 text-primary mb-4" />
              <h3 className="font-display font-semibold text-lg">{title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-border/50 mt-20">
        <div className="mx-auto max-w-6xl px-6 py-8 text-center text-sm text-muted-foreground">
          © {new Date().getFullYear()} Ledger
        </div>
      </footer>
    </div>
  );
}
