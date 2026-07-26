/**
 * Cognito auth helpers for the regulated deploy.
 * Tokens are stored in localStorage and used as Bearer tokens for the Mike API.
 */

import {
    AuthenticationDetails,
    CognitoUser,
    CognitoUserAttribute,
    CognitoUserPool,
    CognitoUserSession,
} from "amazon-cognito-identity-js";
import { cognitoConfig, isRegulatedMode } from "./regulatedMode";

const STORAGE_KEY = "mike.cognito.session";

type StoredSession = {
    idToken: string;
    accessToken: string;
    refreshToken: string;
    email: string;
    sub: string;
    expiresAt: number; // epoch ms
};

function getPool(): CognitoUserPool {
    const { userPoolId, clientId } = cognitoConfig();
    if (!userPoolId || !clientId) {
        throw new Error("Cognito is not configured for this build");
    }
    return new CognitoUserPool({
        UserPoolId: userPoolId,
        ClientId: clientId,
    });
}

function saveSession(session: CognitoUserSession, email: string): StoredSession {
    const id = session.getIdToken();
    const access = session.getAccessToken();
    const refresh = session.getRefreshToken();
    const payload = id.decodePayload() as { sub?: string; email?: string };
    const stored: StoredSession = {
        idToken: id.getJwtToken(),
        accessToken: access.getJwtToken(),
        refreshToken: refresh.getToken(),
        email: (payload.email || email).toLowerCase(),
        sub: payload.sub || "",
        expiresAt: id.getExpiration() * 1000,
    };
    if (typeof window !== "undefined") {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    }
    return stored;
}

export function clearCognitoSession() {
    if (typeof window !== "undefined") {
        window.localStorage.removeItem(STORAGE_KEY);
    }
}

export function readStoredSession(): StoredSession | null {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    try {
        return JSON.parse(raw) as StoredSession;
    } catch {
        return null;
    }
}

export async function getCognitoIdToken(): Promise<string | null> {
    if (!isRegulatedMode()) return null;
    const stored = readStoredSession();
    if (!stored) return null;
    // Refresh if expiring within 2 minutes
    if (stored.expiresAt > Date.now() + 120_000) {
        return stored.idToken;
    }
    try {
        return await refreshSession(stored);
    } catch {
        clearCognitoSession();
        return null;
    }
}

function refreshSession(stored: StoredSession): Promise<string> {
    return new Promise((resolve, reject) => {
        const pool = getPool();
        const user = new CognitoUser({
            Username: stored.email,
            Pool: pool,
        });
        const token = {
            getToken: () => stored.refreshToken,
        };
        user.refreshSession(token as never, (err, session) => {
            if (err || !session) {
                reject(err || new Error("Session refresh failed"));
                return;
            }
            const next = saveSession(session, stored.email);
            resolve(next.idToken);
        });
    });
}

export function cognitoSignUp(args: {
    email: string;
    password: string;
    name?: string;
}): Promise<{ userConfirmed: boolean }> {
    return new Promise((resolve, reject) => {
        const pool = getPool();
        const attrs = [
            new CognitoUserAttribute({ Name: "email", Value: args.email }),
        ];
        if (args.name?.trim()) {
            attrs.push(
                new CognitoUserAttribute({
                    Name: "name",
                    Value: args.name.trim(),
                }),
            );
        }
        pool.signUp(args.email, args.password, attrs, [], (err, result) => {
            if (err) {
                reject(err);
                return;
            }
            resolve({ userConfirmed: !!result?.userConfirmed });
        });
    });
}

export function cognitoConfirmSignUp(
    email: string,
    code: string,
): Promise<void> {
    return new Promise((resolve, reject) => {
        const user = new CognitoUser({
            Username: email,
            Pool: getPool(),
        });
        user.confirmRegistration(code, true, (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

export function cognitoSignIn(
    email: string,
    password: string,
): Promise<StoredSession> {
    return new Promise((resolve, reject) => {
        const user = new CognitoUser({
            Username: email,
            Pool: getPool(),
        });
        const auth = new AuthenticationDetails({
            Username: email,
            Password: password,
        });
        user.authenticateUser(auth, {
            onSuccess: (session) => {
                resolve(saveSession(session, email));
            },
            onFailure: (err) => reject(err),
            newPasswordRequired: () => {
                reject(
                    new Error(
                        "A new password is required. Contact an administrator.",
                    ),
                );
            },
            mfaRequired: () => {
                reject(
                    new Error(
                        "MFA is required for this account. Use an authenticator app code flow (not yet enabled in UI).",
                    ),
                );
            },
            totpRequired: () => {
                reject(
                    new Error(
                        "Authenticator MFA is required. MFA challenge UI is not enabled yet — disable MFA on the user or contact admin.",
                    ),
                );
            },
        });
    });
}

export function cognitoSignOut() {
    clearCognitoSession();
    try {
        const stored = readStoredSession();
        if (stored?.email) {
            const user = new CognitoUser({
                Username: stored.email,
                Pool: getPool(),
            });
            user.signOut();
        }
    } catch {
        // ignore
    }
}

export function getCognitoUserFromStorage(): {
    id: string;
    email: string;
} | null {
    const s = readStoredSession();
    if (!s?.sub || !s.email) return null;
    if (s.expiresAt <= Date.now()) {
        // may still refresh later; keep user visible
    }
    return { id: s.sub, email: s.email };
}
