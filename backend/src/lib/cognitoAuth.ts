import * as jose from "jose";
import { cognitoConfigured, cognitoIssuer, cognitoJwksUrl } from "./regulated";

let jwks: ReturnType<typeof jose.createRemoteJWKSet> | null = null;

function getJwks() {
  if (!jwks) {
    jwks = jose.createRemoteJWKSet(new URL(cognitoJwksUrl()));
  }
  return jwks;
}

export type CognitoUser = {
  id: string;
  email: string;
};

/**
 * Verify a Cognito ID or access token and return the subject + email.
 */
export async function verifyCognitoToken(token: string): Promise<CognitoUser> {
  if (!cognitoConfigured()) {
    throw new Error("Cognito is not configured");
  }

  const issuer = cognitoIssuer();
  const clientId = process.env.COGNITO_CLIENT_ID?.trim() || "";
  const { payload } = await jose.jwtVerify(token, getJwks(), {
    issuer,
  });

  const tokenUse = String(payload.token_use ?? "");
  if (tokenUse === "id") {
    const aud = payload.aud;
    const audOk =
      aud === clientId || (Array.isArray(aud) && aud.includes(clientId));
    if (!audOk) {
      throw new Error("Invalid Cognito token audience");
    }
  } else if (tokenUse === "access") {
    if (payload.client_id !== clientId) {
      throw new Error("Invalid Cognito access token client_id");
    }
  } else {
    throw new Error("Unsupported Cognito token_use");
  }

  const sub = payload.sub;
  if (!sub || typeof sub !== "string") {
    throw new Error("Cognito token missing sub");
  }

  const emailRaw =
    (typeof payload.email === "string" && payload.email) ||
    (typeof payload.username === "string" && payload.username.includes("@")
      ? payload.username
      : "") ||
    "";

  return {
    id: sub,
    email: emailRaw.toLowerCase(),
  };
}
