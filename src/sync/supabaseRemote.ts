/**
 * Adaptador remoto de Supabase para sincronización offline-first.
 *
 * Nunca expone claves administrativas; utiliza únicamente la sesión autenticada
 * del usuario (protegida por Row Level Security en PostgreSQL).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { OfflineError, type PullTable, type PushOp, type PushResult, type Remote } from './remote';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export function isSupabaseConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

let clientInstance: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient | null {
  if (!isSupabaseConfigured()) return null;
  if (!clientInstance) {
    clientInstance = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }
  return clientInstance;
}

export class SupabaseRemote implements Remote {
  constructor(private client: SupabaseClient) {}

  async push(ops: PushOp[]): Promise<PushResult[]> {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      throw new OfflineError('Sin conexión a internet');
    }
    const { data, error } = await this.client.rpc('sync_push', { ops });
    if (error) {
      throw new OfflineError(error.message);
    }
    return (data ?? []) as PushResult[];
  }

  async pull(table: PullTable, since: number, limit: number): Promise<Record<string, unknown>[]> {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      throw new OfflineError('Sin conexión a internet');
    }
    const { data, error } = await this.client
      .from(table)
      .select('*')
      .gt('server_seq', since)
      .order('server_seq', { ascending: true })
      .limit(limit);
    if (error) {
      throw new OfflineError(error.message);
    }
    return (data ?? []) as Record<string, unknown>[];
  }
}
