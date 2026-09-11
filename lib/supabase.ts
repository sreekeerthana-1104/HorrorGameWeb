"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

// A browser-side Supabase client using the public anon key only. Every write this app makes
// goes through Row Level Security as the signed-in (anonymous, by default) user -- the service
// role key stays server-side and isn't used by this app at all.
export function getSupabase(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  if (!client) client = createClient(url, anonKey);
  return client;
}

// Ensures a signed-in user exists before any write -- player_profiles rows only come into
// existence via the project's handle_new_user() trigger on auth.users, so a real auth user has
// to exist before we can attach a game_sessions/trigger_events row to them. Anonymous sign-in is
// the standard Supabase pattern for "no login screen, but still a real authenticated user."
export async function ensureSignedIn(): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data: existing } = await supabase.auth.getSession();
  if (existing.session?.user) return existing.session.user.id;
  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) {
    console.error("[supabase] Anonymous sign-in failed:", error.message);
    return null;
  }
  return data.user?.id ?? null;
}
