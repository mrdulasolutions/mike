# Mike Regulated Workspace — Compliance Boundary

**Project:** `mike-regulated`  
**AWS account:** `547519647117`  
**Region:** `us-east-1` (app/data); Bedrock Mantle API `us-east-2`  
**Classification:** HIPAA-eligible commercial MVP + ITAR-**conscious** (not GovCloud)

This document is operational guidance for engineers. It is **not** legal advice.

## What this environment is

| Control | Status |
|---------|--------|
| AWS HIPAA BAA | Active on this account |
| Isolated VPC | Dedicated `mike-regulated` VPC (not Open WebUI default VPC) |
| Private access | Tailscale-only; no public application listeners |
| Data plane | RDS Postgres + S3 + KMS under AWS |
| Auth | Amazon Cognito (MFA required) |
| Models | Bedrock Mantle OpenAI-compatible endpoint only |

## What this environment is **not**

- **Not AWS GovCloud.** Real ITAR technical data typically requires GovCloud and legal sign-off.
- **Not “HIPAA certified.”** BAA + eligible services + your controls; compliance is shared responsibility.
- **Not multi-provider.** No Anthropic/Gemini/OpenAI.com/Cerebras/Supabase/R2/Resend/CourtListener in the regulated path.
- **Not for production PHI/ITAR data during build/smoke.** Use synthetic data until counsel approves.

## Allowed data (until counsel expands)

| Allowed | Not allowed (v1) |
|---------|------------------|
| Synthetic / dummy documents | Real ITAR technical data |
| Internal non-sensitive legal drafting tests | PHI without completed risk analysis + policies |
| Configuration and infrastructure logs (no payload secrets) | User-supplied third-party API keys to foreign SaaS |

## Service boundary

```
Users (U.S. persons per your policy)
  → Tailscale → EC2 Mike (frontend + backend)
       → RDS (metadata, chats)
       → S3 (documents) [SSE-KMS]
       → Secrets Manager
       → Bedrock Mantle (us-east-2) model inference only
```

Outbound model traffic to `bedrock-mantle.us-east-2.api.aws` is intentional and documented.

## Operator checklist before enabling sensitive data

1. Confirm BAA still ACTIVE in AWS Artifact.  
2. Confirm only HIPAA-eligible services are used for regulated data.  
3. Cognito MFA on; Tailscale ACL limited to approved users.  
4. No public S3/RDS; CloudTrail on.  
5. Written risk analysis / policies (HIPAA Security Rule).  
6. Counsel sign-off before ITAR technical data.  
7. Backup + restore drill completed.

## Incident contacts

- AWS account owner: Privus AI (billing contact on account)  
- Update this section with on-call / legal contacts before go-live.
