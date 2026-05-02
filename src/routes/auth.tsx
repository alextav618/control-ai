import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/auth")({
  validateSearch: (search: Record<string, unknown>): { mode?: "login" | "signup" } => ({
    mode: (search.mode as string) === "signup" ? "signup" : "login",
  }),
  component: AuthPage,
});

function AuthPage() {
  const { mode } = Route.useSearch();
  const { signIn, signUp, user } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(false);
  const isSignup = mode === "signup";

  useEffect(() => {
    if (user) navigate({ to: "/app" });
  }, [user, navigate]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (isSignup) {
        const { error } = await signUp(email, password, displayName);
        if (error) {
          toast.error(error);
        } else {
          toast.success("Conta criada! Verifique seu email para confirmar.");
        }
      } else {
        const { error } = await signIn(email, password);
        if (error) toast.error(error);
        else navigate({ to: "/app" });
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-background">
      <div className="w-full max-w-md">
        <Link to="/" className="flex items-center gap-2 font-display font-bold text-lg justify-center mb-8">
          <span className="h-8 w-8 rounded-lg bg-gradient-primary flex items-center justify-center text-primary-foreground">I</span>
          Ledger
        </Link>
        <div className="rounded-2xl border border-border bg-surface-1 p-8 shadow-elegant">
          <h1 className="font-display text-2xl font-bold text-center">
            {isSignup ? "Criar sua conta" : "Bem-vindo de volta"}
          </h1>
          <p className="text-sm text-muted-foreground text-center mt-2">
            {isSignup ? "Comece a auditar suas finanças hoje" : "Entre para continuar"}
          </p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            {isSignup && (
              <div>
                <Label htmlFor="name">Nome</Label>
                <Input id="name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required className="mt-1.5" />
              </div>
            )}
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="mt-1.5" />
            </div>
            <div>
              <Label htmlFor="password">Senha</Label>
              <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} className="mt-1.5" />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isSignup ? "Criar conta" : "Entrar"}
            </Button>
          </form>

          <div className="mt-6 text-center text-sm text-muted-foreground">
            {isSignup ? (
              <>Já tem conta? <Link to="/auth" search={{ mode: "login" }} className="text-primary hover:underline">Entrar</Link></>
            ) : (
              <>Novo aqui? <Link to="/auth" search={{ mode: "signup" }} className="text-primary hover:underline">Criar conta</Link></>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
