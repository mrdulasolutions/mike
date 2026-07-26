/** True when this build targets the AWS regulated Cognito stack. */
export function isRegulatedMode(): boolean {
    return (
        process.env.NEXT_PUBLIC_REGULATED_MODE === "true" ||
        process.env.NEXT_PUBLIC_REGULATED_MODE === "1"
    );
}

export function cognitoConfig() {
    return {
        userPoolId: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID || "",
        clientId: process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID || "",
        region: process.env.NEXT_PUBLIC_COGNITO_REGION || "us-east-1",
    };
}
