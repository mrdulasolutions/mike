/**
 * Unified access token for Mike API calls.
 * Regulated builds use Cognito ID tokens; default builds use Supabase session.
 */

import { supabase } from "@/app/lib/supabase";
import { isRegulatedMode } from "@/app/lib/regulatedMode";
import { getCognitoIdToken } from "@/app/lib/cognitoAuth";

export async function getAccessToken(): Promise<string | null> {
    if (isRegulatedMode()) {
        return getCognitoIdToken();
    }
    const {
        data: { session },
    } = await supabase.auth.getSession();
    return session?.access_token ?? null;
}

export async function getAuthHeaders(): Promise<Record<string, string>> {
    const token = await getAccessToken();
    if (!token) return {};
    return { Authorization: `Bearer ${token}` };
}

/** API base URL for direct fetch() calls outside mikeApi. */
export function getApiBase(): string {
    if (isRegulatedMode()) {
        return process.env.NEXT_PUBLIC_API_BASE_URL || "/mike-api";
    }
    return process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";
}
