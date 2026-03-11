import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl) {
  throw new Error("SUPABASE_URL is required");
}

if (!supabaseAnonKey) {
  throw new Error("SUPABASE_ANON_KEY is required");
}

const resolvedSupabaseAnonKey = supabaseAnonKey;
const resolvedSupabaseUrl = supabaseUrl;

export const supabaseService = supabaseServiceRoleKey
  ? createClient(resolvedSupabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    })
  : null;

export function supabaseAnon(authToken?: string) {
  return createClient(resolvedSupabaseUrl, resolvedSupabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: authToken ? { headers: { Authorization: `Bearer ${authToken}` } } : undefined
  });
}
