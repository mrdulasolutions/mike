/** Flags and helpers for the AWS regulated deploy. */

export function isRegulatedMode(): boolean {
  const v = (process.env.REGULATED_MODE ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

export function cognitoConfigured(): boolean {
  return !!(
    process.env.COGNITO_USER_POOL_ID?.trim() &&
    process.env.COGNITO_CLIENT_ID?.trim()
  );
}

export function cognitoIssuer(): string {
  const region =
    process.env.COGNITO_REGION?.trim() ||
    process.env.AWS_REGION?.trim() ||
    "us-east-1";
  const pool = process.env.COGNITO_USER_POOL_ID!.trim();
  return `https://cognito-idp.${region}.amazonaws.com/${pool}`;
}

export function cognitoJwksUrl(): string {
  return `${cognitoIssuer()}/.well-known/jwks.json`;
}
