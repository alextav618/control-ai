"use client";
import { Auth } from '@supabase/auth-ui-react';
import { ThemeSupa } from '@supabase/auth-ui-shared';
import { supabase } from '@/integrations/supabase/client';
import { useRouter } from '@tanstack/react-router';
import { useEffect } from 'react';

function Login() {
  const router = useRouter();

  useEffect(() => {
    const { data: { authState } } = supabase.auth.onAuthStateChange((event, session) => {
      if (session) {
        router.push({ to: '/app' });
      }
    });

    return () => {
      authState?.unsubscribe();
    };
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <Auth
        supabaseClient={supabase}
        providers={[]}
        appearance={{ theme: ThemeSupa }}
        theme="light"
      />
    </div>
  );
}

export default Login;