"use client";

import React, {
    createContext,
    useContext,
    useEffect,
    useState,
    ReactNode,
} from "react";
import type { User as SupabaseUser } from "@supabase/supabase-js";
import { supabase } from "@/app/lib/supabase";
import { isRegulatedMode } from "@/app/lib/regulatedMode";
import {
    cognitoSignOut,
    getCognitoIdToken,
    getCognitoUserFromStorage,
    readStoredSession,
} from "@/app/lib/cognitoAuth";

interface User {
    id: string;
    email: string;
    pendingEmail?: string | null;
}

interface AuthContextType {
    user: User | null;
    isAuthenticated: boolean;
    authLoading: boolean;
    signOut: () => Promise<void>;
    updateEmail: (email: string) => Promise<User>;
    /** Call after Cognito login/signup to refresh context */
    refreshAuth: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function toUser(user: SupabaseUser): User {
    return {
        id: user.id,
        email: user.email || "",
        pendingEmail: user.new_email ?? null,
    };
}

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [authLoading, setAuthLoading] = useState(true);
    const regulated = isRegulatedMode();

    const refreshAuth = async () => {
        if (regulated) {
            const token = await getCognitoIdToken();
            const stored = getCognitoUserFromStorage();
            if (token && stored) {
                setUser({ id: stored.id, email: stored.email });
            } else if (readStoredSession() && !token) {
                setUser(null);
            } else if (stored) {
                setUser({ id: stored.id, email: stored.email });
            } else {
                setUser(null);
            }
            return;
        }

        const {
            data: { session },
        } = await supabase.auth.getSession();
        if (session?.user) {
            setUser(toUser(session.user));
        } else {
            setUser(null);
        }
    };

    useEffect(() => {
        let cancelled = false;

        const checkUser = async () => {
            await refreshAuth();
            if (!cancelled) setAuthLoading(false);
        };

        checkUser();

        if (regulated) {
            return () => {
                cancelled = true;
            };
        }

        const {
            data: { subscription },
        } = supabase.auth.onAuthStateChange(async (_event, session) => {
            if (session?.user) {
                setUser(toUser(session.user));
            } else {
                setUser(null);
            }
            setAuthLoading(false);
        });

        return () => {
            cancelled = true;
            subscription.unsubscribe();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- mount once
    }, [regulated]);

    const signOut = async () => {
        if (regulated) {
            cognitoSignOut();
            setUser(null);
            return;
        }
        await supabase.auth.signOut({ scope: "local" });
        setUser(null);
    };

    const updateEmail = async (email: string) => {
        if (regulated) {
            throw new Error(
                "Change email in your identity provider (Cognito) for regulated accounts.",
            );
        }
        const redirectTo =
            typeof window === "undefined"
                ? undefined
                : `${window.location.origin}/account`;
        const { data, error } = await supabase.auth.updateUser(
            { email },
            redirectTo ? { emailRedirectTo: redirectTo } : undefined,
        );

        if (error) throw error;
        if (!data.user) throw new Error("Unable to update email");

        const nextUser = toUser(data.user);
        setUser(nextUser);
        return nextUser;
    };

    return (
        <AuthContext.Provider
            value={{
                user,
                isAuthenticated: !!user,
                authLoading,
                signOut,
                updateEmail,
                refreshAuth,
            }}
        >
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error("useAuth must be used within an AuthProvider");
    }
    return context;
}
