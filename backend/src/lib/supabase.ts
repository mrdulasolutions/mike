import { createClient } from "@supabase/supabase-js";
import { isRegulatedMode } from "./regulated";

/**
 * Server-side data client.
 *
 * - Default: Supabase Cloud (service role, bypasses RLS).
 * - Regulated: PostgREST gateway that speaks the same REST API shape.
 *   Set SUPABASE_URL to the gateway base (includes /rest/v1) and
 *   SUPABASE_SECRET_KEY to a JWT accepted by PostgREST (role claim).
 */
export function createServerSupabase() {
  const url = process.env.SUPABASE_URL || "";
  const key = process.env.SUPABASE_SECRET_KEY || "";
  if (!url || !key) {
    throw new Error(
      isRegulatedMode()
        ? "SUPABASE_URL (PostgREST gateway) and SUPABASE_SECRET_KEY must be set in regulated mode"
        : "SUPABASE_URL and SUPABASE_SECRET_KEY must be set",
    );
  }
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
