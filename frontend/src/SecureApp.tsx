import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import App from './App';
import { Login } from './Login';
import { supabase } from './supabase';
export default function SecureApp() { const [session, setSession] = useState<Session | null>(); useEffect(() => { void supabase.auth.getSession().then(({ data }) => setSession(data.session)); const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession)); return () => subscription.unsubscribe(); }, []); if (session === undefined) return null; return session ? <App accessToken={session.access_token} onSignOut={() => void supabase.auth.signOut()} /> : <Login />; }
