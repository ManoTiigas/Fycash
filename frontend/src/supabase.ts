import { createClient } from '@supabase/supabase-js';
const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
if (!url || !anonKey) throw new Error('Configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY.');
// Browser sessions are deliberately persistent. Supabase stores the refresh
// token in localStorage and refreshes short-lived access tokens in the background.
// The only normal local logout path is supabase.auth.signOut().
export const supabase = createClient(url, anonKey, {
  auth: {
    storageKey: 'fycash.auth.session',
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});
