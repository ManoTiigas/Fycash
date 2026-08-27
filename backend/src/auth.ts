import type { NextFunction, Request, Response } from 'express';
import { supabase } from './supabase.js';

declare global { namespace Express { interface Request { profileId?: string; userEmail?: string; } } }

export async function requireAuth(request: Request, response: Response, next: NextFunction) {
  const token = request.header('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return response.status(401).json({ error: 'Autenticação obrigatória.' });
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return response.status(401).json({ error: 'Sessão inválida ou expirada.' });
  let { data: profile, error: profileError } = await supabase.from('profiles').select('id').eq('user_id', user.id).maybeSingle();
  if (!profile && !profileError) ({ data: profile, error: profileError } = await supabase.from('profiles').insert({ user_id: user.id, display_name: user.user_metadata.full_name || user.email?.split('@')[0] || 'Usuário', open_finance_paused: true, open_finance_paused_at: new Date().toISOString() }).select('id').single());
  if (profileError || !profile) return response.status(500).json({ error: 'Não foi possível carregar o perfil.' });
  request.profileId = profile.id;
  request.userEmail = user.email ?? undefined;
  next();
}
