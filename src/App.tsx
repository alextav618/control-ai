"use client";

import React, { useEffect, useState } from 'react';
import { Link, Outlet, useRouter } from '@tanstack/react-router';
import { supabase } from './integrations/supabase/client';

function App() {
  const [session, setSession] = useState(null);
    const router = useRouter();

    useEffect(() => {
        supabase.auth.getSession().then(({ data: { session } }) => {
            setSession(session)
        })

        supabase.auth.onAuthStateChange((_event, session) => {
            setSession(session)
        })
    }, [])

    useEffect(() => {
        if (session) {
            if (location.pathname === '/login') {
                router.push({ to: '/app' })
            }
        } else {
            router.push({ to: '/login' })
        }
    }, [session])

  return (
    
      
        <Outlet />
      
    
  );
}

export default App;